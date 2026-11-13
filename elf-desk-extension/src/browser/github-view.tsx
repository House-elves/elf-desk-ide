import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { codicon, open, OpenerService } from '@theia/core/lib/browser/index.js';
import { DiffUris } from '@theia/core/lib/browser/diff-uris.js';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget.js';
import { InMemoryResources } from '@theia/core/lib/common/resource.js';
import URI from '@theia/core/lib/common/uri.js';
import { ElfDeskMain } from '../common/elf-desk-protocol.js';
import { ElvesModel } from './elves-model.js';
import { FileDiff, parseDiff } from './pr-diff.js';

const ELF = 'github';
const ITEM_KEY = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+#\d+$/;

interface Item {
    key: string;
    repo: string;
    number: number;
    kind: 'PR' | 'ISSUE';
    title: string;
    url: string;
    author?: string;
    draft?: boolean;
    ci?: string | null;
    approved?: boolean;
    reviewDecision?: string | null;
    mergeState?: string | null;
}
interface Lane { id: string; title: string; items: Item[] }
interface Flow { say?: string; waiting?: string }
interface Board { lanes: Lane[]; flows?: Record<string, Flow>; fetchedAt?: string }

/** A PR's files, once read: 'loading', what went wrong, or the files. */
type Files = 'loading' | { error: string } | { files: FileDiff[]; cut: boolean };

/**
 * The GitHub elf's board as a tree in the side bar: its lanes, each PR and issue with its CI, approval and the agent's
 * one line about it, and a PR's changed files, each opening in the diff editor. What posts to GitHub stays on the
 * GitHub tab, where the desk asks you first.
 */
@injectable()
export class GitHubViewWidget extends ReactWidget {

    static readonly ID = 'elves-github';
    static readonly LABEL = 'GitHub';

    @inject(ElvesModel) protected readonly model: ElvesModel;
    @inject(ElfDeskMain) protected readonly main: ElfDeskMain;
    @inject(InMemoryResources) protected readonly memory: InMemoryResources;
    @inject(OpenerService) protected readonly openers: OpenerService;

    protected board: Board | null | undefined;
    protected error = '';
    protected readVersion = -1;
    protected readonly open = new Set<string>(['review', 'mine']);
    protected readonly files = new Map<string, Files>();
    protected readonly expanded = new Set<string>();

    @postConstruct()
    protected init(): void {
        this.id = GitHubViewWidget.ID;
        this.title.label = GitHubViewWidget.LABEL;
        this.title.caption = 'GitHub: your board';
        this.title.iconClass = codicon('github');
        this.title.closable = true;
        this.addClass('elves-view');
        this.addClass('elves-github');
        this.toDispose.push(this.model.onDidChange(() => this.load()));
        this.load();
    }

    /** Reads the board again when the elf's data changed since the last read. */
    protected async load(force = false): Promise<void> {
        const s = this.model.state;
        if (s.connection !== 'open' || !s.tabs.some(t => t.elf === ELF)) {
            this.update();
            return;
        }
        const version = s.changes[ELF] ?? 0;
        if (!force && version === this.readVersion) return;
        this.readVersion = version;
        try {
            const text = (await this.main.elfRead(ELF, 'board', ['board.json']))['board.json'];
            this.board = text ? JSON.parse(text) as Board : null;
            this.error = '';
        } catch (e) {
            this.error = e instanceof Error ? e.message : String(e);
        }
        this.update();
    }

    protected render(): React.ReactNode {
        const s = this.model.state;
        if (!s.tabs.some(t => t.elf === ELF)) {
            return <div className='elves-note'>{s.connection === 'open' ? 'The GitHub elf isn\'t installed.' : 'Connecting to the desk…'}</div>;
        }
        if (this.error) return <div className='elves-note'>Couldn't read the board: {this.error}</div>;
        if (this.board === undefined) return <div className='elves-note'>Reading the board…</div>;
        if (!this.board) return <div className='elves-note'>The board fills after the GitHub elf's first refresh.</div>;
        return <div className='elves-list'>
            {(this.board.lanes ?? []).map(l => this.lane(l))}
        </div>;
    }

    protected lane(l: Lane): React.ReactNode {
        const isOpen = this.open.has(l.id);
        const yours = l.items.filter(i => this.flow(i)?.waiting === 'you').length;
        return <div key={l.id} className='gh-lane'>
            <div className='elves-group gh-lane-head' role='button' tabIndex={0} aria-expanded={isOpen}
                onClick={() => this.toggle(this.open, l.id)} onKeyDown={e => this.key(e, () => this.toggle(this.open, l.id))}>
                <span className={codicon(isOpen ? 'chevron-down' : 'chevron-right')} />
                <span className='gh-lane-title'>{l.title}</span>
                <span className='gh-count' title={yours ? `${yours} waiting on you` : undefined}>{yours ? `${yours} / ` : ''}{l.items.length}</span>
            </div>
            {isOpen && l.items.map(i => this.item(i))}
        </div>;
    }

    protected flow(i: Item): Flow | undefined {
        return this.board?.flows?.[i.key];
    }

    protected item(i: Item): React.ReactNode {
        const f = this.flow(i);
        const pr = i.kind === 'PR';
        const isOpen = this.expanded.has(i.key);
        const openThread = () => this.openThread(i);
        return <div key={i.key} className='gh-item-wrap'>
            <div className={'elves-row gh-item' + (f?.waiting === 'you' ? ' needs-you' : '')} tabIndex={0} role='button'
                title={`${i.title}\n${i.key}${i.author ? ` by ${i.author}` : ''}${f?.say ? `\n${f.say}` : ''}`}
                onClick={openThread} onKeyDown={e => this.key(e, openThread)}>
                {pr
                    ? <span className={codicon(isOpen ? 'chevron-down' : 'chevron-right') + ' gh-twisty'} role='button'
                        title={isOpen ? 'Hide its files' : 'Show its changed files'}
                        onClick={e => { e.stopPropagation(); this.toggleFiles(i); }} />
                    : <span className='gh-twisty' />}
                <span className={codicon(pr ? (i.draft ? 'git-pull-request-draft' : 'git-pull-request') : 'issues') + ' gh-kind'} />
                <span className='elves-text'>
                    <span className='elves-label'>{i.title}</span>
                    <span className='elves-why'>{i.repo.split('/')[1]} #{i.number}{f?.say ? ` · ${f.say}` : ''}</span>
                </span>
                {pr && this.ci(i)}
                {pr && i.approved && <span className={codicon('pass') + ' gh-ok'} title='Approved' />}
                <span className={codicon('link-external') + ' action-label elves-act'} role='button' title='Open on GitHub'
                    onClick={e => { e.stopPropagation(); open(this.openers, new URI(safeUrl(i.url))); }} />
            </div>
            {pr && isOpen && this.fileRows(i)}
        </div>;
    }

    protected ci(i: Item): React.ReactNode {
        switch (i.ci) {
            case 'SUCCESS': return <span className={codicon('check') + ' gh-ok'} title='CI passed' />;
            case 'FAILURE': case 'ERROR': return <span className={codicon('error') + ' gh-bad'} title='CI failed' />;
            case 'PENDING': case 'EXPECTED': return <span className={codicon('loading') + ' codicon-modifier-spin gh-wait'} title='CI running' />;
            case null: case undefined: return undefined;
            default: return <span className={codicon('watch') + ' gh-wait'} title={`CI: ${i.ci.toLowerCase().replace(/_/g, ' ')}`} />;
        }
    }

    protected fileRows(i: Item): React.ReactNode {
        const f = this.files.get(i.key);
        if (!f || f === 'loading') return <div className='elves-note gh-files'>Reading its diff…</div>;
        if ('error' in f) return <div className='elves-note gh-files'>{f.error}</div>;
        return <div className='gh-files'>
            {f.files.map(d => <div key={d.path} className='elves-row gh-file' tabIndex={0} role='button'
                title={d.status === 'renamed' ? `${d.oldPath} → ${d.path}` : d.path}
                onClick={() => this.openFile(i, d)} onKeyDown={e => this.key(e, () => this.openFile(i, d))}>
                <span className={codicon(d.status === 'added' ? 'diff-added' : d.status === 'deleted' ? 'diff-removed'
                    : d.status === 'renamed' ? 'diff-renamed' : 'diff-modified') + ' gh-kind'} />
                <span className='elves-text'>
                    <span className='elves-label'>{d.path.split('/').pop()}</span>
                    <span className='elves-why'>{d.path.split('/').slice(0, -1).join('/')}</span>
                </span>
                <span className='gh-stat'><span className='gh-add'>+{d.added}</span> <span className='gh-del'>−{d.removed}</span></span>
            </div>)}
            {f.cut && <div className='elves-note'>The diff was cut short: the rest is on GitHub.</div>}
        </div>;
    }

    protected async toggleFiles(i: Item): Promise<void> {
        if (this.expanded.has(i.key)) {
            this.expanded.delete(i.key);
            this.update();
            return;
        }
        this.expanded.add(i.key);
        if (this.files.has(i.key) && this.files.get(i.key) !== 'loading' && !('error' in (this.files.get(i.key) as object))) {
            this.update();
            return;
        }
        this.files.set(i.key, 'loading');
        this.update();
        try {
            if (!ITEM_KEY.test(i.key)) throw new Error('Not an item');
            let r = await this.main.elfAct(ELF, 'pr-diff', { itemKey: i.key }) as { text?: string; cut?: boolean; file?: string } | null;
            // Big answers come as a file in its cache folder.
            if (r && typeof r.file === 'string' && Object.keys(r).length === 1) {
                const text = (await this.main.elfRead(ELF, 'cache', [r.file]))[r.file];
                r = text ? JSON.parse(text) : null;
            }
            if (!r || typeof r.text !== 'string') throw new Error('GitHub didn\'t give the diff (it may be too big).');
            this.files.set(i.key, { files: parseDiff(r.text), cut: !!r.cut });
        } catch (e) {
            this.files.set(i.key, { error: e instanceof Error ? e.message : String(e) });
        }
        this.update();
    }

    /** The file's changed parts, before and after, in the diff editor. */
    protected async openFile(i: Item, d: FileDiff): Promise<void> {
        const base = `elf-pr:/${i.repo}/${i.number}`;
        const left = new URI(`${base}/before/${d.oldPath || d.path}`);
        const right = new URI(`${base}/after/${d.path}`);
        this.put(left, d.before);
        this.put(right, d.after);
        const label = `${d.path.split('/').pop()} (#${i.number}, changed parts)`;
        await open(this.openers, DiffUris.encode(left, right, label), { mode: 'activate' });
    }

    /** An in-memory file with this text: a new one, or the one an earlier open made, brought up to date. */
    protected put(uri: URI, text: string): void {
        try {
            this.memory.update(uri, text);
        } catch {
            this.memory.add(uri, text);
        }
    }

    /** The item's page on the GitHub tab: its thread, the agent, and what posts (the desk asks you there). */
    protected async openThread(i: Item): Promise<void> {
        if (!ITEM_KEY.test(i.key)) return;
        await this.main.navigate(ELF, `thread/${i.repo}/${i.number}`);
        this.onOpenThread?.(i.key);
    }

    /** Set by the contribution: shows the GitHub tab. */
    onOpenThread: ((itemKey: string) => void) | undefined;

    protected toggle(set: Set<string>, id: string): void {
        if (set.has(id)) set.delete(id); else set.add(id);
        this.update();
    }

    protected key(e: React.KeyboardEvent, act: () => void): void {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            act();
        }
    }

    refresh(): void {
        this.load(true);
    }
}

/** Only GitHub's own pages open from here. */
function safeUrl(url: string): string {
    return /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/(pull|issues)\/\d+$/.test(url) ? url : 'https://github.com';
}
