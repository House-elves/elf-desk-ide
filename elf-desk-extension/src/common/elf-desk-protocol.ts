/** Between the IDE's window and the Electron main process, which holds the desk's pages. */
export const elfDeskMainPath = '/services/elf-desk';
export const ElfDeskMain = Symbol('ElfDeskMain');

/** Where a panel is in the window, in CSS pixels. */
export interface Bounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** A Sessions chat whose clone is on this machine. */
export interface DeskSession {
    id: string;
    name: string;
    repo: string;
    branch?: string;
    clone: string;
    updated?: string;
}

/** One of the desk's tabs: an installed elf's. */
export interface ElfTab {
    id: string;
    label: string;
    elf: string;
    card: boolean;
    /** The command its Refresh runs, if it has one. */
    refresh: string | null;
    /** Settings it needs before its first run. */
    missing: string[];
}

/** What the desk page says (its window.elfDeskHost), for the menus, the Elves view and the status bar. */
export interface DeskState {
    connection: 'connecting' | 'open' | 'lost' | 'signed-out' | 'down';
    tabs: ElfTab[];
    /** {elf: why it needs you} */
    attention: Record<string, string>;
    /** "elf:command" of the runs going now */
    running: string[];
    failed: string[];
    /** {elf: n}: goes up each time that elf's data changes. */
    changes: Record<string, number>;
}

export namespace DeskState {
    export const EMPTY: DeskState = { connection: 'connecting', tabs: [], attention: {}, running: [], failed: [], changes: {} };
}

/** The desk's pages: 'desk' is the dashboard, any other key an elf's tab (its id). */
export type PageKey = string;

export interface ElfDeskClient {
    onStateChanged(state: DeskState): void;
    /** A link on a desk page went to an elf's tab, or the dashboard ('desk'): the IDE opens it as its own tab. */
    onOpenPage(key: PageKey): void;
}

export interface ElfDeskMain {
    /** Shows a desk page over a panel's bounds, opening it the first time. */
    show(key: PageKey, bounds: Bounds): Promise<void>;
    hide(key: PageKey): Promise<void>;
    /** The panel closed: its page goes. */
    close(key: PageKey): Promise<void>;
    reload(key: PageKey): Promise<void>;
    state(): Promise<DeskState>;
    refresh(elf: string): Promise<void>;
    /** What didn't refresh, and why. */
    refreshAll(): Promise<string[]>;
    /** Shows a page of a desk tab: the part of its address after #<key>/ (thread/owner/repo/123 on GitHub's). */
    navigate(key: PageKey, route: string): Promise<void>;
    /** Files from an elf's data folder, {name: text}, as its tab may read them. What's in them is the elf's: untrusted. */
    elfRead(elf: string, folder: string, files: string[]): Promise<Record<string, string | null>>;
    /** One of an elf's actions that its elf.yaml says needn't ask; the desk refuses the others. */
    elfAct(elf: string, action: string, params: Record<string, string | number | boolean>): Promise<unknown>;
    deskUrl(): Promise<string>;
    /** Sessions whose clone is on this machine, the latest first; archived ones left out. */
    sessions(): Promise<DeskSession[]>;
}
