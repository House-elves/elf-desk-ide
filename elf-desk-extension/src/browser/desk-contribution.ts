import { inject, injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution, FrontendApplication, FrontendApplicationContribution, QuickInputService, QuickPickItem } from '@theia/core/lib/browser/index.js';
import { Command, CommandRegistry } from '@theia/core/lib/common/index.js';
import { MessageService } from '@theia/core/lib/common/message-service.js';
import URI from '@theia/core/lib/common/uri.js';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service.js';
import { DeskSession, ElfDeskMain } from '../common/elf-desk-protocol.js';
import { DeskWidget } from './desk-widget.js';

export namespace ElfDeskCommands {
    const category = 'Elf Desk';
    export const OPEN_SESSION: Command = { id: 'elfDesk.openSession', category, label: 'Open a Session as the Workspace…' };
    export const RELOAD: Command = { id: 'elfDesk.reload', category, label: 'Reload the Desk' };
}

@injectable()
export class DeskContribution extends AbstractViewContribution<DeskWidget> implements FrontendApplicationContribution {

    @inject(ElfDeskMain) protected readonly main: ElfDeskMain;
    @inject(QuickInputService) protected readonly quickInput: QuickInputService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(MessageService) protected readonly messages: MessageService;

    constructor() {
        super({
            widgetId: DeskWidget.ID,
            widgetName: DeskWidget.LABEL,
            defaultWidgetOptions: { area: 'main', rank: -1000 },
            toggleCommandId: 'elfDesk.toggle',
            toggleKeybinding: 'ctrlcmd+shift+d'
        });
    }

    /** The desk is the home page: open it when nothing else is. */
    async onDidInitializeLayout(app: FrontendApplication): Promise<void> {
        await this.openView({ activate: true, reveal: true });
    }

    override registerCommands(commands: CommandRegistry): void {
        super.registerCommands(commands);
        commands.registerCommand(ElfDeskCommands.OPEN_SESSION, { execute: () => this.pickSession() });
        commands.registerCommand(ElfDeskCommands.RELOAD, { execute: () => this.main.reload() });
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
