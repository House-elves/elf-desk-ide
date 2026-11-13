import { inject, injectable } from '@theia/core/shared/inversify';
import {
    AbstractViewContribution, ApplicationShell, FrontendApplication, FrontendApplicationContribution, StatusBar, StatusBarAlignment,
    WidgetManager
} from '@theia/core/lib/browser/index.js';
import { BadgeService } from '@theia/core/lib/browser/badges/badge-service.js';
import { CommandRegistry, MAIN_MENU_BAR, MenuModelRegistry } from '@theia/core/lib/common/index.js';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable.js';
import { MessageService } from '@theia/core/lib/common/message-service.js';
import { DeskState, ElfDeskMain, PageKey } from '../common/elf-desk-protocol.js';
import { DeskPageOptions, DeskPageWidget } from './desk-widget.js';
import { ElvesModel } from './elves-model.js';
import { ElvesCommandIds, ElvesViewWidget } from './elves-view.js';

export const ELVES_MENU = [...MAIN_MENU_BAR, '5_elves'];
const ELVES_TOP = [...ELVES_MENU, '1_desk'];
const ELVES_EACH = [...ELVES_MENU, '2_each'];
const ELVES_ALL = [...ELVES_MENU, '3_all'];
const STATUS = 'elves-status';

/**
 * The elves in the IDE's own places: an Elves menu with a submenu per elf, the Elves side bar with a badge for the
 * ones that need you, a status bar item, a notification when one starts to need you, and each elf as a tab.
 */
@injectable()
export class ElvesContribution extends AbstractViewContribution<ElvesViewWidget> implements FrontendApplicationContribution {

    @inject(ElvesModel) protected readonly model: ElvesModel;
    @inject(ElfDeskMain) protected readonly main: ElfDeskMain;
    @inject(MenuModelRegistry) protected readonly menus: MenuModelRegistry;
    @inject(CommandRegistry) protected readonly commandRegistry: CommandRegistry;
    @inject(StatusBar) protected readonly statusBar: StatusBar;
    @inject(BadgeService) protected readonly badges: BadgeService;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(WidgetManager) protected readonly widgets: WidgetManager;
    @inject(ApplicationShell) protected readonly appShell: ApplicationShell;

    protected readonly perElf = new DisposableCollection();
    protected menuKey = '';
    protected known: Record<string, string> | undefined;

    constructor() {
        super({
            widgetId: ElvesViewWidget.ID,
            widgetName: ElvesViewWidget.LABEL,
            defaultWidgetOptions: { area: 'left', rank: 50 },
            toggleCommandId: 'elves.toggleView',
            toggleKeybinding: 'ctrlcmd+shift+e'
        });
    }

    async onStart(_app: FrontendApplication): Promise<void> {
        this.model.onDidChange(s => this.changed(s));
        this.model.onOpenPageRequest(key => this.openPage(key));
        this.changed(this.model.state);
        // The state may have come before this listened.
        this.model.onStateChanged(await this.main.state());
    }

    async onDidInitializeLayout(): Promise<void> {
        await this.openView({ activate: false, reveal: true });
    }

    override registerCommands(commands: CommandRegistry): void {
        super.registerCommands(commands);
        commands.registerCommand({ id: ElvesCommandIds.OPEN, label: 'Open an Elf' }, {
            execute: (id?: string) => id ? this.openPage(id) : undefined
        });
        commands.registerCommand({ id: ElvesCommandIds.REFRESH, label: 'Refresh an Elf' }, {
            execute: (id?: string) => id ? this.refresh(id) : undefined
        });
        commands.registerCommand({ id: ElvesCommandIds.REFRESH_ALL, category: 'Elves', label: 'Refresh Everything' }, {
            execute: () => this.refreshAll()
        });
        commands.registerCommand({ id: ElvesCommandIds.ADD, category: 'Elves', label: 'Add an Elf…' }, {
            execute: () => this.openPage('elves')
        });
        commands.registerCommand({ id: 'elves.dashboard', category: 'Elves', label: 'Dashboard' }, {
            execute: () => this.openPage('desk')
        });
    }

    override registerMenus(menus: MenuModelRegistry): void {
        super.registerMenus(menus);
        menus.registerSubmenu(ELVES_MENU, 'Elves');
        menus.registerMenuAction(ELVES_TOP, { commandId: 'elves.dashboard', label: 'Dashboard', order: '1' });
        menus.registerMenuAction(ELVES_TOP, { commandId: 'elves.toggleView', label: 'Elves Side Bar', order: '2' });
        menus.registerMenuAction(ELVES_ALL, { commandId: ElvesCommandIds.REFRESH_ALL, label: 'Refresh Everything', order: '1' });
        menus.registerMenuAction(ELVES_ALL, { commandId: ElvesCommandIds.ADD, label: 'Add an Elf…', order: '2' });
        menus.registerMenuAction(ELVES_ALL, { commandId: 'elfDesk.openSession', label: 'Open a Session as the Workspace…', order: '3' });
    }

    /** Opens the dashboard or an elf's tab, or shows it if it's open. */
    async openPage(key: PageKey): Promise<void> {
        const t = this.model.tab(key);
        const label = key === 'desk' ? 'Desk' : key === 'elves' ? 'Add an Elf' : t?.label ?? key;
        const options: DeskPageOptions = { key, label };
        const widget = await this.widgets.getOrCreateWidget<DeskPageWidget>(DeskPageWidget.FACTORY, options);
        if (!widget.isAttached) this.appShell.addWidget(widget, { area: 'main' });
        widget.setNeedsYou(t ? this.model.needsYou(t) : undefined);
        await this.appShell.activateWidget(widget.id);
    }

    protected async refresh(id: string): Promise<void> {
        const t = this.model.tab(id);
        try {
            await this.main.refresh(t?.elf ?? id);
        } catch (e) {
            this.messages.error(plain(`${t?.label ?? id} didn't refresh: ${message(e)}`));
        }
    }

    protected async refreshAll(): Promise<void> {
        try {
            const problems = await this.main.refreshAll();
            if (problems.length) this.messages.warn(plain(`Not everything refreshed. ${problems.join(' ')}`));
        } catch (e) {
            this.messages.error(plain(`Couldn't refresh: ${message(e)}`));
        }
    }

    protected changed(s: DeskState): void {
        this.updateMenus(s);
        this.updateBadge(s);
        this.updateTabs(s);
        this.notify(s);
    }

    /** A submenu per elf, named with a ● while it needs you: Open, and Refresh if it has one. */
    protected updateMenus(s: DeskState): void {
        const key = JSON.stringify(s.tabs.map(t => [t.id, t.label, t.refresh, t.missing.length, !!s.attention[t.elf]]));
        if (key === this.menuKey) return;
        this.menuKey = key;
        this.perElf.dispose();
        s.tabs.forEach((t, i) => {
            const path = [...ELVES_EACH, `${String(i).padStart(3, '0')}_${t.id}`];
            const why = s.attention[t.elf];
            const open = { id: `elves.open.${t.id}`, category: 'Elves', label: `Open ${t.label}` };
            this.perElf.push(this.commandRegistry.registerCommand(open, { execute: () => this.openPage(t.id) }));
            this.perElf.push(this.menus.registerSubmenu(path, why ? `${t.label} ●` : t.label));
            this.perElf.push(this.menus.registerMenuAction([...path, '1'], {
                commandId: open.id, label: t.missing.length ? `Set Up ${t.label}` : `Open ${t.label}`, order: '1'
            }));
            if (t.refresh && !t.missing.length) {
                const refresh = { id: `elves.refresh.${t.id}`, category: 'Elves', label: `Refresh ${t.label}` };
                this.perElf.push(this.commandRegistry.registerCommand(refresh, {
                    execute: () => this.refresh(t.id),
                    isEnabled: () => !this.model.isRunning(t)
                }));
                this.perElf.push(this.menus.registerMenuAction([...path, '1'], { commandId: refresh.id, label: `Refresh ${t.label}`, order: '2' }));
            }
        });
    }

    /** The side bar's badge and the status bar: how many elves need you. */
    protected updateBadge(s: DeskState): void {
        const needs = s.tabs.filter(t => s.attention[t.elf]);
        const tooltip = needs.map(t => `${t.label}: ${s.attention[t.elf]}`).join('\n');
        const view = this.tryGetWidget();
        if (view) this.badges.showBadge(view, needs.length ? { value: needs.length, tooltip } : undefined);
        const running = s.tabs.filter(t => this.model.isRunning(t)).length;
        if (s.connection === 'down' || s.connection === 'signed-out') {
            this.statusBar.setElement(STATUS, {
                text: '$(warning) Desk', alignment: StatusBarAlignment.LEFT, priority: 100,
                tooltip: s.connection === 'down' ? 'The desk isn\'t answering: house-elves start' : 'Not signed in to the desk',
                command: 'elves.toggleView'
            });
        } else if (needs.length || running) {
            const parts = [needs.length ? `$(bell-dot) ${needs.length}` : '', running ? `$(sync~spin) ${running}` : ''].filter(Boolean);
            this.statusBar.setElement(STATUS, {
                text: parts.join('  '), alignment: StatusBarAlignment.LEFT, priority: 100,
                tooltip: [tooltip, running ? `${running} running` : ''].filter(Boolean).join('\n') || 'Elves',
                command: 'elves.toggleView'
            });
        } else {
            this.statusBar.setElement(STATUS, {
                text: '$(organization) Elves', alignment: StatusBarAlignment.LEFT, priority: 100,
                tooltip: 'No elf needs you', command: 'elves.toggleView'
            });
        }
    }

    /** Each open elf tab says whether it needs you. */
    protected updateTabs(s: DeskState): void {
        for (const w of this.widgets.getWidgets(DeskPageWidget.FACTORY)) {
            if (!(w instanceof DeskPageWidget)) continue;
            const t = s.tabs.find(x => x.id === w.key);
            w.setNeedsYou(t ? s.attention[t.elf] : undefined);
        }
    }

    /** A notification when an elf starts needing you (not for the ones that already did when the IDE opened). */
    protected notify(s: DeskState): void {
        if (s.connection !== 'open' || !s.tabs.length) return;
        const before = this.known;
        this.known = { ...s.attention };
        if (!before) return;
        for (const t of s.tabs) {
            const why = s.attention[t.elf];
            if (!why || before[t.elf] === why) continue;
            this.messages.info(plain(`${t.label}: ${why}`), `Open ${t.label}`).then(a => { if (a) this.openPage(t.id); });
        }
    }
}

export const noop = Disposable.NULL;

/**
 * Notifications render Markdown, and what an elf says it needs you for can come from a mail or a chat message: it's
 * shown as text, so a link in it (a command: one included) is never a link.
 */
export function plain(text: string): string {
    return text.replace(/[\\`*_{}\[\]()<>#+!|~-]/g, c => `\\${c}`).slice(0, 500);
}

function message(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
