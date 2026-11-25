import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** B-23's slice (the owner, 2026-10-23): every log line carries the time it was written —
 * an ISO 8601 instant, one timezone-free spelling on every machine. */
export const stampLine = (line: string): string => `${new Date().toISOString()} ${line}`;

/** B-108: a path's newest write — itself, or the newest file under it, the walk bounded (a
 *  store a live session grows without end is walked no further). A path that does not exist
 *  answers 0: a signal that was never live. */
export function newestWrite(path: string, depth = 0): number {
  let st: { mtimeMs: number; isDirectory(): boolean } | null = null;
  try {
    st = statSync(path);
  } catch {
    return 0;
  }
  let best = st.mtimeMs;
  if (!st.isDirectory() || depth >= 5) return best;
  let names: string[] = [];
  try {
    names = readdirSync(path);
  } catch {
    return best;
  }
  for (let i = 0; i < names.length && i < 512; i++) best = Math.max(best, newestWrite(join(path, names[i]), depth + 1));
  return best;
}

/** B-108: the leg in flight's disk activity signals — the wrapper's log (B-95's example path
 *  under the home checkout) and the harness stores keyed by the home checkout, the same paths
 *  the stub's idle bound reads. Which harnesses' stores are looked at is not narrowed by the
 *  agent command here (the runner does not resolve it — the stub does, at its snapshot): every
 *  path that does not exist answers 0 and never reads as live, so watching all of them is only
 *  ever the safe direction for the line that reads them. */
export function legActivity(home: string, ticket: string, leg: string): { name: string; at: number }[] {
  const dashed = home.split('/').join('-');
  const dataHome = process.env.XDG_DATA_HOME && process.env.XDG_DATA_HOME !== '' ? process.env.XDG_DATA_HOME : join(homedir(), '.local', 'share');
  const opencode = join(dataHome, 'opencode');
  const store = [join(opencode, 'opencode.db'), join(opencode, 'opencode.db-wal'), join(opencode, 'opencode.db-shm'), join(opencode, 'project', dashed)];
  const key = createHash('sha1').update(home).digest('hex');
  const snapshots = join(opencode, 'snapshot');
  let instances: string[] = [];
  try {
    instances = readdirSync(snapshots);
  } catch {
    // No snapshots directory: no instances to walk.
  }
  for (const i of instances) store.push(join(snapshots, i, key));
  const claude = process.env.CLAUDE_CONFIG_DIR && process.env.CLAUDE_CONFIG_DIR !== '' ? process.env.CLAUDE_CONFIG_DIR : join(homedir(), '.claude');
  store.push(join(claude, 'projects', dashed));
  return [
    { name: 'wrapper-log', at: newestWrite(join(home, '.baton', 'logs', `${ticket}-${leg}.log`)) },
    { name: 'harness-store', at: store.reduce((best, p) => Math.max(best, newestWrite(p)), 0) },
  ];
}

/** B-108: an age in the beat's liveness line — seconds under 90, minutes above; a negative age
 *  (a clock the runner does not own) reads as zero. */
export const ageWords = (ms: number): string => {
  const age = Math.max(0, ms);
  return age < 90_000 ? `${Math.round(age / 1000)}s` : `${Math.round(age / 60_000)}m`;
};

/** B-108's streaming half (2026-10-24): drain a leg child's stream line by line into the log —
 * chunks are not line-aligned and a stamp per chunk would land mid-prose, so a buffer holds the
 * partial tail until its newline arrives (the stream's end flushes it; empty lines are dropped,
 * keeping the log tight). */
export const drainLines = (stream: NodeJS.ReadableStream, emit: (line: string) => void): void => {
  let tail = '';
  stream.on('data', (c) => {
    tail += String(c);
    let at: number;
    while ((at = tail.indexOf('\n')) >= 0) {
      const line = tail.slice(0, at);
      tail = tail.slice(at + 1);
      if (line.trim() !== '') emit(line);
    }
  });
  stream.on('end', () => { if (tail.trim() !== '') emit(tail); });
};
export const withTimestamps = (log: (line: string) => void): ((line: string) => void) =>
  (line) => log(stampLine(line));

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
