import { injectable } from '@theia/core/shared/inversify';
import { Emitter } from '@theia/core/lib/common/event.js';
import { DeskState, ElfDeskClient, ElfTab, PageKey } from '../common/elf-desk-protocol.js';

/** The desk's state as the main process passes it on: the elves, which need you, what's running. */
@injectable()
export class ElvesModel implements ElfDeskClient {

    protected current: DeskState = DeskState.EMPTY;
    protected readonly onDidChangeEmitter = new Emitter<DeskState>();
    readonly onDidChange = this.onDidChangeEmitter.event;
    protected readonly onOpenPageEmitter = new Emitter<PageKey>();
    readonly onOpenPageRequest = this.onOpenPageEmitter.event;

    get state(): DeskState {
        return this.current;
    }

    tab(id: string): ElfTab | undefined {
        return this.current.tabs.find(t => t.id === id);
    }

    needsYou(t: ElfTab): string | undefined {
        return this.current.attention[t.elf];
    }

    isRunning(t: ElfTab): boolean {
        return this.current.running.some(r => r.startsWith(`${t.elf}:`));
    }

    onStateChanged(state: DeskState): void {
        this.current = state;
        this.onDidChangeEmitter.fire(state);
    }

    onOpenPage(key: PageKey): void {
        this.onOpenPageEmitter.fire(key);
    }
}
