/** Between the Desk panel (in Theia's window) and the Electron main process, which holds the desk's own view. */
export const elfDeskMainPath = '/services/elf-desk';
export const ElfDeskMain = Symbol('ElfDeskMain');

/** Where the panel is in the window, in CSS pixels. */
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

export interface ElfDeskMain {
    /** Shows the desk over the panel's bounds, signing in the first time. */
    show(bounds: Bounds): Promise<void>;
    hide(): Promise<void>;
    reload(): Promise<void>;
    /** The desk's address, e.g. http://elf-desk.localhost:7777. */
    deskUrl(): Promise<string>;
    /** Sessions whose clone is on this machine, the latest first; archived ones left out. */
    sessions(): Promise<DeskSession[]>;
}
