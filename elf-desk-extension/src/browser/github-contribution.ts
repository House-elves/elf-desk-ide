import { inject, injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution, FrontendApplicationContribution } from '@theia/core/lib/browser/index.js';
import { TabBarToolbarContribution, TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar/index.js';
import { CommandRegistry, MenuModelRegistry } from '@theia/core/lib/common/index.js';
import { codicon } from '@theia/core/lib/browser/widgets/widget.js';
import { ElfDeskMain } from '../common/elf-desk-protocol.js';
import { ElvesContribution, ELVES_MENU } from './elves-contribution.js';
import { GitHubViewWidget } from './github-view.js';

const REFRESH = { id: 'elves.github.refresh', category: 'GitHub', label: 'Refresh the Board', iconClass: codicon('refresh') };

/** The GitHub side bar, next to the Elves one. */
@injectable()
export class GitHubContribution extends AbstractViewContribution<GitHubViewWidget>
    implements FrontendApplicationContribution, TabBarToolbarContribution {

    @inject(ElvesContribution) protected readonly elves: ElvesContribution;
    @inject(ElfDeskMain) protected readonly main: ElfDeskMain;

    constructor() {
        super({
            widgetId: GitHubViewWidget.ID,
            widgetName: GitHubViewWidget.LABEL,
            defaultWidgetOptions: { area: 'left', rank: 60 },
            toggleCommandId: 'elves.github.toggleView'
        });
    }

    async onDidInitializeLayout(): Promise<void> {
        const view = await this.openView({ activate: false, reveal: false });
        view.onOpenThread = () => this.elves.openPage('github');
    }

    async initializeLayout(): Promise<void> {
        await this.openView({ activate: false, reveal: false });
    }

    override registerCommands(commands: CommandRegistry): void {
        super.registerCommands(commands);
        commands.registerCommand(REFRESH, {
            execute: () => this.main.refresh('github'),
            isVisible: w => w instanceof GitHubViewWidget
        });
    }

    override registerMenus(menus: MenuModelRegistry): void {
        super.registerMenus(menus);
        menus.registerMenuAction([...ELVES_MENU, '1_desk'], { commandId: 'elves.github.toggleView', label: 'GitHub Side Bar', order: '3' });
    }

    registerToolbarItems(toolbar: TabBarToolbarRegistry): void {
        toolbar.registerItem({ id: REFRESH.id, command: REFRESH.id, tooltip: 'Refresh the board: GitHub fetched again' });
    }
}
