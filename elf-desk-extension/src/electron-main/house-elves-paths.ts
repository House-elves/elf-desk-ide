import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// The same places the house-elves CLI uses (house-elves/HouseElves.java).
const HOME = os.homedir();
export const DATA = process.env.HOUSE_ELVES_DATA ?? path.join(HOME, '.local', 'share', 'house-elves');
export const CONFIG = process.env.HOUSE_ELVES_CONFIG ?? path.join(HOME, '.config', 'house-elves');
export const PORT = Number(process.env.HOUSE_ELVES_PORT ?? '7777');
export const SESSIONS = path.join(HOME, '.config', 'sessions');

function props(file: string): Record<string, string> {
    try {
        const out: Record<string, string> = {};
        for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
            const m = /^\s*([^#!=:\s][^=:]*?)\s*[=:]\s*(.*)$/.exec(line);
            if (m) out[m[1]] = m[2].trim();
        }
        return out;
    } catch {
        return {};
    }
}

export function deskUrl(): string {
    const host = props(path.join(CONFIG, 'desk.properties'))['elfdesk.host'] ?? 'elf-desk.localhost';
    return `http://${host}:${PORT}`;
}

/** The desk's one-time sign-in code (it writes a new one each time one is used), or undefined before it first started. */
export function openCode(): string | undefined {
    try {
        return fs.readFileSync(path.join(DATA, 'open-code'), 'utf8').trim() || undefined;
    } catch {
        return undefined;
    }
}

export function runnerWorkDir(): string {
    const work = /^WORK_DIR=(.*)$/m.exec((() => {
        try { return fs.readFileSync(path.join(CONFIG, 'runner.config'), 'utf8'); } catch { return ''; }
    })());
    return work ? work[1].trim() : path.join(DATA, 'runner');
}

const REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
const ID = /^s[0-9]{10,16}$/;

/** Where the runner keeps a session's clone, as house-elves resume finds it. */
export function clonePath(repo: string, id: string): string | undefined {
    if (!REPO.test(repo) || !ID.test(id)) return undefined;
    return path.join(runnerWorkDir(), 'worktrees', 'slots', repo.replace('/', '_'), `sessions_${id}`);
}
