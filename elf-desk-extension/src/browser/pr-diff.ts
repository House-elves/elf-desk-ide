/** One file of a unified diff (GitHub's application/vnd.github.diff). */
export interface FileDiff {
    path: string;
    oldPath: string;
    status: 'added' | 'deleted' | 'renamed' | 'modified';
    binary: boolean;
    added: number;
    removed: number;
    /** What the diff shows of it before and after: its changed parts with their context, the rest left out. */
    before: string;
    after: string;
}

const GAP = (from: number, to: number) => `... lines ${from} to ${to} aren't in the diff`;

/** Splits a unified diff into its files. */
export function parseDiff(text: string): FileDiff[] {
    const out: FileDiff[] = [];
    const chunks = text.split(/^diff --git /m).slice(1);
    for (const chunk of chunks) {
        const lines = chunk.split('\n');
        const head = /^a\/(.+?) b\/(.+)$/.exec(lines[0]) ?? [];
        let oldPath = head[1] ?? '', path = head[2] ?? '';
        let status: FileDiff['status'] = 'modified';
        let binary = false;
        let i = 1;
        for (; i < lines.length && !lines[i].startsWith('@@'); i++) {
            const l = lines[i];
            if (l.startsWith('new file')) status = 'added';
            else if (l.startsWith('deleted file')) status = 'deleted';
            else if (l.startsWith('rename from ')) { status = 'renamed'; oldPath = l.slice(12); }
            else if (l.startsWith('rename to ')) path = l.slice(10);
            else if (l.startsWith('Binary files')) binary = true;
            else if (l.startsWith('--- a/')) oldPath = l.slice(6);
            else if (l.startsWith('+++ b/')) path = l.slice(6);
        }
        const before: string[] = [], after: string[] = [];
        let added = 0, removed = 0, lastOld = 0, lastNew = 0;
        for (; i < lines.length; i++) {
            const l = lines[i];
            const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l);
            if (h) {
                const o = Number(h[1]), n = Number(h[3]);
                // What lies between two hunks: one line each side, so the two still line up.
                if (o > lastOld + 1 || n > lastNew + 1) {
                    before.push(GAP(lastOld + 1, Math.max(lastOld + 1, o - 1)));
                    after.push(GAP(lastNew + 1, Math.max(lastNew + 1, n - 1)));
                }
                lastOld = o - 1;
                lastNew = n - 1;
                continue;
            }
            if (l.startsWith('\\')) continue; // \ No newline at end of file
            if (l.startsWith('-')) { before.push(l.slice(1)); removed++; lastOld++; }
            else if (l.startsWith('+')) { after.push(l.slice(1)); added++; lastNew++; }
            else if (l.startsWith(' ') || (l === '' && i < lines.length - 1)) {
                before.push(l.slice(1)); after.push(l.slice(1)); lastOld++; lastNew++;
            }
        }
        out.push({ path, oldPath, status, binary, added, removed, before: before.join('\n'), after: after.join('\n') });
    }
    return out;
}
