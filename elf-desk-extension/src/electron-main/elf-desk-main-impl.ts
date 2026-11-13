import * as fs from 'fs';
import * as path from 'path';
import { injectable } from '@theia/core/shared/inversify';
import { BrowserWindow, WebContents, WebContentsView, shell, session as electronSession } from '@theia/electron/shared/electron';
import { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application.js';
import { Bounds, DeskSession, DeskState, ElfDeskClient, ElfDeskMain, PageKey } from '../common/elf-desk-protocol.js';
import { SESSIONS, clonePath, deskUrl, openCode } from './house-elves-paths.js';

const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/;
/** Each page's last place in its own tab, to go back to after a link to another tab. */
const own = new Map<number, string>();

/**
 * The desk's pages, each a web view of its own laid over its panel. The desk is the page itself there, not framed in
 * Theia's page: it keeps refusing frames, and its SameSite=Strict cookie works. They share one cookie jar, and sign
 * in with the one-time code as `house-elves open` does.
 *
 * One more page, never shown, is opened with ?host: the desk's state (its elves, which need you, what runs) comes
 * from it, for the IDE's own menus and views. It's the desk's page doing it, so the IDE holds no key of its own.
 */
@injectable()
export class ElfDeskMainImpl implements ElfDeskMain, ElectronMainApplicationContribution {

    static readonly PARTITION = 'persist:elf-desk';

    protected readonly pages = new Map<PageKey, WebContentsView>();
    protected window: BrowserWindow | undefined;
    protected host: WebContentsView | undefined;
    protected current: DeskState = DeskState.EMPTY;
    protected readonly clients = new Set<ElfDeskClient>();
    protected signingIn = false;
    protected lastSignIn = 0;
    protected watching = 0;

    onStart(_app: ElectronMainApplication): void {
        const desk = new URL(deskUrl());
        // The 🎤 and notifications: for the desk only.
        electronSession.fromPartition(ElfDeskMainImpl.PARTITION).setPermissionRequestHandler((wc, permission, callback, details) => {
            const from = safeOrigin(details.requestingUrl ?? wc.getURL());
            callback(from === desk.origin && ['media', 'notifications', 'clipboard-sanitized-write'].includes(permission));
        });
    }

    addClient(client: ElfDeskClient): void {
        this.clients.add(client);
        this.startHost();
        client.onStateChanged(this.current);
    }

    removeClient(client: ElfDeskClient): void {
        this.clients.delete(client);
    }

    async deskUrl(): Promise<string> {
        return deskUrl();
    }

    async state(): Promise<DeskState> {
        this.startHost();
        return this.current;
    }

    async refresh(elf: string): Promise<void> {
        if (!KEY.test(elf)) return;
        await this.hostCall(`window.elfDeskHost.refresh(${JSON.stringify(elf)})`);
    }

    async refreshAll(): Promise<string[]> {
        return (await this.hostCall('window.elfDeskHost.refreshAll()')) ?? [];
    }

    async show(key: PageKey, bounds: Bounds): Promise<void> {
        if (!KEY.test(key)) return;
        const win = this.targetWindow();
        if (!win) return;
        const view = this.page(win, key);
        const zoom = win.webContents.getZoomFactor();
        view.setBounds({
            x: Math.round(bounds.x * zoom), y: Math.round(bounds.y * zoom),
            width: Math.max(0, Math.round(bounds.width * zoom)), height: Math.max(0, Math.round(bounds.height * zoom))
        });
        view.setVisible(true);
    }

    async hide(key: PageKey): Promise<void> {
        this.pages.get(key)?.setVisible(false);
    }

    async close(key: PageKey): Promise<void> {
        const view = this.pages.get(key);
        if (!view) return;
        this.pages.delete(key);
        if (this.window && !this.window.isDestroyed()) this.window.contentView.removeChildView(view);
        view.webContents.close();
    }

    async reload(key: PageKey): Promise<void> {
        this.pages.get(key)?.webContents.reload();
    }

    async sessions(): Promise<DeskSession[]> {
        const dir = path.join(SESSIONS, 'sessions');
        let names: string[];
        try {
            names = await fs.promises.readdir(dir);
        } catch {
            return [];
        }
        const out: DeskSession[] = [];
        for (const name of names) {
            if (!/^s[0-9]{10,16}\.json$/.test(name)) continue;
            try {
                const s = JSON.parse(await fs.promises.readFile(path.join(dir, name), 'utf8'));
                if (s.archived) continue;
                const clone = clonePath(String(s.repo ?? ''), String(s.id ?? ''));
                if (!clone || !fs.existsSync(path.join(clone, '.git'))) continue;
                out.push({ id: s.id, name: s.name ?? s.id, repo: s.repo, branch: s.branch, clone, updated: s.updated });
            } catch {
                // Being written, or not a session: skip it.
            }
        }
        return out.sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? ''));
    }

    // ---- the host page: the desk's state ----

    protected startHost(): void {
        if (this.host && !this.host.webContents.isDestroyed()) return;
        const view = new WebContentsView({ webPreferences: this.webPreferences() });
        this.host = view;
        this.guard(view.webContents, 'host');
        view.webContents.on('did-finish-load', () => this.watch());
        view.webContents.loadURL(`${deskUrl()}/?host`);
    }

    /** Waits for the page's next change (or 30 seconds), and passes the state on; again, while the page is up. */
    protected async watch(): Promise<void> {
        const run = ++this.watching;
        while (run === this.watching && this.host && !this.host.webContents.isDestroyed()) {
            const wc = this.host.webContents;
            if (new URL(wc.getURL()).searchParams.get('host') === null) return; // signing in: it comes back to ?host
            let next: DeskState | null;
            try {
                next = await wc.executeJavaScript(`new Promise(resolve => {
                    const h = window.elfDeskHost;
                    if (!h) { setTimeout(() => resolve(null), 1000); return; }
                    if (!window.__elfDeskIdeSeen) { window.__elfDeskIdeSeen = true; resolve(h.state()); return; }
                    const done = () => resolve(h.state());
                    window.addEventListener(h.event, done, { once: true });
                    setTimeout(done, 30000);
                })`);
            } catch {
                return; // the page went (it navigated, or reloads): did-finish-load starts again
            }
            if (next) this.publish(next);
            else if (run === this.watching) this.publish({ ...this.current, connection: 'connecting' });
        }
    }

    protected publish(state: DeskState): void {
        this.current = state;
        for (const c of this.clients) {
            try {
                c.onStateChanged(state);
            } catch {
                this.clients.delete(c);
            }
        }
    }

    protected async hostCall<T>(js: string): Promise<T | undefined> {
        this.startHost();
        const wc = this.host?.webContents;
        if (!wc || wc.isDestroyed()) return undefined;
        return wc.executeJavaScript(`(async () => { if (!window.elfDeskHost) throw new Error("The desk isn't connected yet"); return ${js}; })()`);
    }

    // ---- the shown pages ----

    /** The window the panels are in: one Theia window in this version, so the focused one, else the first. */
    protected targetWindow(): BrowserWindow | undefined {
        if (this.window && !this.window.isDestroyed()) return this.window;
        this.window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find(w => !w.isDestroyed());
        this.window?.once('closed', () => {
            this.pages.clear();
            this.window = undefined;
        });
        return this.window;
    }

    protected page(win: BrowserWindow, key: PageKey): WebContentsView {
        const had = this.pages.get(key);
        if (had && !had.webContents.isDestroyed()) return had;
        const view = new WebContentsView({ webPreferences: this.webPreferences() });
        this.pages.set(key, view);
        win.contentView.addChildView(view);
        this.guard(view.webContents, key);
        view.webContents.loadURL(this.pageUrl(key));
        return view;
    }

    /** The dashboard, or one elf's tab, without the desk's own bar of tabs: the IDE's tabs are those. */
    protected pageUrl(key: PageKey): string {
        return key === 'desk' ? `${deskUrl()}/?embed` : `${deskUrl()}/?embed#${encodeURIComponent(key)}`;
    }

    protected webPreferences(): Electron.WebPreferences {
        return { partition: ElfDeskMainImpl.PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false };
    }

    protected guard(wc: WebContents, key: PageKey): void {
        const desk = new URL(deskUrl());
        // Links elsewhere (GitHub, Zulip, ...) open in your browser; the desk stays in its view.
        wc.setWindowOpenHandler(({ url }) => {
            if (safeOrigin(url) !== desk.origin && /^https?:/.test(url)) shell.openExternal(url);
            return { action: 'deny' };
        });
        wc.on('will-navigate', (e, url) => {
            if (safeOrigin(url) !== desk.origin) {
                e.preventDefault();
                if (/^https?:/.test(url)) shell.openExternal(url);
            }
        });
        // A link to another tab (the dashboard's cards, a "see GitHub"): that tab opens in the IDE, and this page
        // stays where it was.
        wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
            if (!isMainFrame || key === 'host' || safeOrigin(url) !== desk.origin) return;
            const tab = decodeURIComponent(new URL(url).hash.slice(1)).split('/')[0] || 'desk';
            const another = tab !== key && KEY.test(tab) && (tab === 'desk' || tab === 'elves' || this.current.tabs.some(t => t.id === tab));
            if (!another) {
                own.set(wc.id, url); // somewhere inside this tab (#github/pr/...)
                return;
            }
            const back = own.get(wc.id) ?? this.pageUrl(key);
            wc.executeJavaScript(`location.replace(${JSON.stringify(back)})`).catch(() => undefined);
            for (const c of this.clients) c.onOpenPage(tab);
        });
        // Not signed in (first time, or the session ended): sign in again with a new one-time code, then come back.
        wc.on('did-navigate', (_e, url) => {
            if (safeOrigin(url) !== desk.origin) return;
            const u = new URL(url);
            if (u.searchParams.has('embed')) own.set(wc.id, url);
            if (u.pathname === '/welcome') this.signIn(wc, key);
            else if (u.pathname === '/' && !u.search) wc.loadURL(key === 'host' ? `${deskUrl()}/?host` : this.pageUrl(key));
        });
        wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
            if (!isMainFrame || code === -3) return;
            if (key === 'host') {
                this.publish({ ...this.current, connection: 'down' });
                setTimeout(() => { if (!wc.isDestroyed()) wc.loadURL(`${deskUrl()}/?host`); }, 10_000);
            } else {
                this.showDown(wc, url, description);
            }
        });
    }

    /** At most once every 10 seconds, so a desk that keeps refusing the code doesn't loop. */
    protected signIn(wc: WebContents, key: PageKey): void {
        if (this.signingIn || Date.now() - this.lastSignIn < 10_000) {
            if (key === 'host') this.publish({ ...this.current, connection: 'signed-out' });
            return;
        }
        const code = openCode();
        if (!code) return;
        this.signingIn = true;
        this.lastSignIn = Date.now();
        // /open sends the page to / once it's signed in, and did-navigate brings it back to its own page.
        wc.loadURL(`${deskUrl()}/open?code=${encodeURIComponent(code)}`).catch(() => undefined).finally(() => { this.signingIn = false; });
    }

    protected showDown(wc: WebContents, url: string, why: string): void {
        const page = `<!doctype html><meta charset="utf-8"><title>Elf Desk</title>
            <body style="font:15px system-ui;padding:32px;color:#888;background:#1e1e1e">
            <h2>The desk isn't answering</h2>
            <p>${escape(url)}: ${escape(why)}.</p>
            <p>Start it with <code>house-elves start</code>, then reload this tab.</p></body>`;
        wc.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page));
    }
}

function safeOrigin(url: string): string | undefined {
    try {
        return new URL(url).origin;
    } catch {
        return undefined;
    }
}

function escape(s: string): string {
    return s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
}
