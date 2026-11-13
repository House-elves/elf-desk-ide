import { inject, injectable } from '@theia/core/shared/inversify';
import { ApplicationShell, FrontendApplicationContribution, KeybindingContribution, KeybindingRegistry, QuickInputService, QuickPickItem } from '@theia/core/lib/browser/index.js';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common/index.js';
import { MessageService } from '@theia/core/lib/common/message-service.js';
import URI from '@theia/core/lib/common/uri.js';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service.js';
import { DeskSession, ElfDeskMain } from '../common/elf-desk-protocol.js';
import { DeskPageWidget } from './desk-widget.js';
import { ElvesContribution } from './elves-contribution.js';

export namespace ElfDeskCommands {
    const category = 'Elf Desk';
    export const DASHBOARD: Command = { id: 'elfDesk.toggle', category, label: 'Show the Dashboard' };
    export const OPEN_SESSION: Command = { id: 'elfDesk.openSession', category, label: 'Open a Session as the Workspace…' };
    export const RELOAD: Command = { id: 'elfDesk.reload', category, label: 'Reload This Desk Tab' };
}

@injectable()
export class DeskContribution implements CommandContribution, KeybindingContribution, FrontendApplicationContribution {

    @inject(ElfDeskMain) protected readonly main: ElfDeskMain;
    @inject(QuickInputService) protected readonly quickInput: QuickInputService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(ApplicationShell) protected readonly shell: ApplicationShell;
    @inject(ElvesContribution) protected readonly elves: ElvesContribution;

    /** The dashboard is the home page: it opens when nothing else is open. */
    async onDidInitializeLayout(): Promise<void> {
        if (!this.shell.getWidgets('main').length) await this.elves.openPage('desk');
    }

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(ElfDeskCommands.DASHBOARD, { execute: () => this.elves.openPage('desk') });
        commands.registerCommand(ElfDeskCommands.OPEN_SESSION, { execute: () => this.pickSession() });
        commands.registerCommand(ElfDeskCommands.RELOAD, {
            execute: () => (this.shell.currentWidget as DeskPageWidget).reload(),
            isEnabled: () => this.shell.currentWidget instanceof DeskPageWidget
        });
    }

    registerKeybindings(keybindings: KeybindingRegistry): void {
        keybindings.registerKeybinding({ command: ElfDeskCommands.DASHBOARD.id, keybinding: 'ctrlcmd+shift+d' });
    }

    protected async pickSession(): Promise<void> {
        const sessions = await this.main.sessions();
        if (!sessions.length) {
            this.messages.info('No session has a clone on this machine yet. Start one on the desk\'s Sessions tab.');
            return;
        }
        type Item = QuickPickItem & { session: DeskSession };
        const items: Item[] = sessions.map(s => ({
            label: s.name,
            description: s.repo,
            detail: s.branch ? `${s.id} · ${s.branch}` : s.id,
            session: s
        }));
        const picked = await this.quickInput.showQuickPick(items, { placeholder: 'The session whose clone to open' });
        if (!picked) return;
        // Its clone is the agent's: you see its files and changes, and a terminal there, next to the chat.
        this.workspace.open(URI.fromFilePath(picked.session.clone), { preserveWindow: true });
    }
}
