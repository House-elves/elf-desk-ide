import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { codicon } from '@theia/core/lib/browser/index.js';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget.js';
import { CommandService } from '@theia/core/lib/common/command.js';
import { ElfTab } from '../common/elf-desk-protocol.js';
import { ElvesModel } from './elves-model.js';

export const ElvesCommandIds = {
    OPEN: 'elves.open',
    REFRESH: 'elves.refresh',
    REFRESH_ALL: 'elves.refreshAll',
    ADD: 'elves.add',
};

/** The Elves side bar: each elf, whether it needs you and why, and whether it's running, with its Refresh. */
@injectable()
export class ElvesViewWidget extends ReactWidget {

    static readonly ID = 'elves-view';
    static readonly LABEL = 'Elves';

    @inject(ElvesModel) protected readonly model: ElvesModel;
    @inject(CommandService) protected readonly commands: CommandService;

    @postConstruct()
    protected init(): void {
        this.id = ElvesViewWidget.ID;
        this.title.label = ElvesViewWidget.LABEL;
        this.title.caption = 'Elves';
        this.title.iconClass = codicon('organization');
        this.title.closable = true;
        this.addClass('elves-view');
        this.toDispose.push(this.model.onDidChange(() => this.update()));
        this.update();
    }

    protected render(): React.ReactNode {
        const s = this.model.state;
        if (s.connection === 'down') return this.say('The desk isn\'t answering. Start it with house-elves start.');
        if (s.connection === 'signed-out') return this.say('The desk didn\'t take the sign-in code. Run house-elves open once, then reload.');
        if (!s.tabs.length) return this.say(s.connection === 'open' ? 'No elves installed yet.' : 'Connecting to the desk…');
        const needs = s.tabs.filter(t => this.model.needsYou(t));
        const rest = s.tabs.filter(t => !this.model.needsYou(t));
        return <div className='elves-list'>
            {needs.length > 0 && <div className='elves-group'>Needs you</div>}
            {needs.map(t => this.row(t))}
            {needs.length > 0 && rest.length > 0 && <div className='elves-group'>Elves</div>}
            {rest.map(t => this.row(t))}
            {s.connection === 'lost' && <div className='elves-note'>Lost the connection to the desk; it comes back on its own.</div>}
        </div>;
    }

    protected say(text: string): React.ReactNode {
        return <div className='theia-widget-noInfo elves-note'>{text}</div>;
    }

    protected row(t: ElfTab): React.ReactNode {
        const why = this.model.needsYou(t);
        const running = this.model.isRunning(t);
        const setup = t.missing.length > 0;
        const open = () => this.commands.executeCommand(ElvesCommandIds.OPEN, t.id);
        return <div key={t.id} className={'elves-row' + (why ? ' needs-you' : '')} tabIndex={0} role='button'
            title={why ? `${t.label}: ${why}` : setup ? `${t.label} needs a few settings first` : `Open ${t.label}`}
            onClick={open} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}>
            <span className={codicon(why ? 'circle-filled' : 'circle-outline') + ' elves-dot'} />
            <span className='elves-text'>
                <span className='elves-label'>{t.label}</span>
                {why && <span className='elves-why'>{why}</span>}
                {!why && setup && <span className='elves-why'>Needs setting up</span>}
            </span>
            {running
                ? <span className={codicon('sync') + ' codicon-modifier-spin elves-act'} title='Running' />
                : t.refresh && !setup && <span className={codicon('refresh') + ' action-label elves-act'} role='button' tabIndex={0}
                    title={`Refresh ${t.label}`}
                    onClick={e => { e.stopPropagation(); this.commands.executeCommand(ElvesCommandIds.REFRESH, t.id); }} />}
        </div>;
    }
}
