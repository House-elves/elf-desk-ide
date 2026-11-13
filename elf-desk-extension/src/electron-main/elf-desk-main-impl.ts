import * as fs from 'fs';
import * as path from 'path';
import { injectable } from '@theia/core/shared/inversify';
import { BrowserWindow, WebContentsView, shell, session as electronSession } from '@theia/electron/shared/electron';
import { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application.js';
import { Bounds, DeskSession, ElfDeskMain } from '../common/elf-desk-protocol.js';
import { SESSIONS, clonePath, deskUrl, openCode } from './house-elves-paths.js';

/**
 * The desk in its own Electron view, laid over the Desk panel. The desk is the page itself there, not framed in
 * Theia's page: it keeps refusing frames (X-Frame-Options, frame-ancestors) and its SameSite=Strict cookie works.
 * It has its own persistent cookie jar, and signs in with the one-time code as `house-elves open` does.
 */
@injectable()
export class ElfDeskMainImpl implements ElfDeskMain, ElectronMainApplicationContribution {

    static readonly PARTITION = 'persist:elf-desk';

    protected view: WebContentsView | undefined;
    protected window: BrowserWindow | undefined;
    protected signingIn = false;
    protected lastSignIn = 0;

    onStart(_app: ElectronMainApplication): void {
        const desk = new URL(deskUrl());
        // The 🎤 and notifications: for the desk only.
        electronSession.fromPartition(ElfDeskMainImpl.PARTITION).setPermissionRequestHandler((wc, permission, callback, details) => {
            const from = safeOrigin(details.requestingUrl ?? wc.getURL());
            callback(from === desk.origin && ['media', 'notifications', 'clipboard-sanitized-write'].includes(permission));
        });
    }

    async deskUrl(): Promise<string> {
        return deskUrl();
    }

    async show(bounds: Bounds): Promise<void> {
        const win = this.targetWindow();
        if (!win) return;
        const view = this.ensureView(win);
        const zoom = win.webContents.getZoomFactor();
        view.setBounds({
            x: Math.round(bounds.x * zoom), y: Math.round(bounds.y * zoom),
            width: Math.max(0, Math.round(bounds.width * zoom)), height: Math.max(0, Math.round(bounds.height * zoom))
        });
        view.setVisible(true);
    }

    async hide(): Promise<void> {
        this.view?.setVisible(false);
    }

    async reload(): Promise<void> {
        this.view?.webContents.reload();
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

    /** The window the panel is in: one Theia window in this first version, so the focused one, else the first. */
    protected targetWindow(): BrowserWindow | undefined {
        if (this.window && !this.window.isDestroyed()) return this.window;
        return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find(w => !w.isDestroyed());
    }

    protected ensureView(win: BrowserWindow): WebContentsView {
        if (this.view && this.window === win && !this.view.webContents.isDestroyed()) return this.view;
        if (this.view && this.window && !this.window.isDestroyed()) this.window.contentView.removeChildView(this.view);
        const view = new WebContentsView({
            webPreferences: { partition: ElfDeskMainImpl.PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false }
        });
        this.view = view;
        this.window = win;
        win.contentView.addChildView(view);
        win.once('closed', () => {
            if (this.window === win) {
                this.view = undefined;
                this.window = undefined;
            }
        });
        const desk = new URL(deskUrl());
        const wc = view.webContents;
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
        // Not signed in (first time, or the session ended): sign in again with a new one-time code.
        wc.on('did-navigate', (_e, url) => {
            if (safeOrigin(url) === desk.origin && new URL(url).pathname === '/welcome') this.signIn(wc);
        });
        wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
            if (isMainFrame && code !== -3) this.showDown(wc, url, description);
        });
        wc.loadURL(desk.origin + '/');
        return view;
    }

    /** At most once every 10 seconds, so a desk that keeps refusing the code doesn't loop. */
    protected signIn(wc: Electron.WebContents): void {
        if (this.signingIn || Date.now() - this.lastSignIn < 10_000) return;
        const code = openCode();
        if (!code) return;
        this.signingIn = true;
        this.lastSignIn = Date.now();
        wc.loadURL(`${deskUrl()}/open?code=${encodeURIComponent(code)}`).finally(() => { this.signingIn = false; });
    }

    protected showDown(wc: Electron.WebContents, url: string, why: string): void {
        const page = `<!doctype html><meta charset="utf-8"><title>Elf Desk</title>
            <body style="font:15px system-ui;padding:32px;color:#444">
            <h2>The desk isn't answering</h2>
            <p>${escape(url)}: ${escape(why)}.</p>
            <p>Start it with <code>house-elves start</code>, then reload this panel.</p></body>`;
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
