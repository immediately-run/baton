import { spawn } from 'node:child_process';
import { mkdirSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

/** The watcher a held lock runs: prints one line the moment the lock is its own, then polls the
 *  runner's pid and exits when it is gone — the lock dies with the runner within a second, even
 *  a SIGKILL (round 1, finding 3; the test guards exactly this contract). */
export const LOCK_WATCHER = 'echo baton:held; while kill -0 "$1" 2>/dev/null; do sleep 1; done';
/** The watcher's argv tail as `MachineLocks` spawns it (the name the watcher runs under, and the
 *  runner's pid it watches). */
export const lockWatcherArgv = (pid: number): string[] => ['sh', '-c', LOCK_WATCHER, 'baton-lock-watch', String(pid)];

/** B-106 (R-BTN-178): one machine's singleton is the runner's own business, never Baton's. A
 *  configured capability is declared only while this process holds an exclusive lock on its file:
 *  util-linux `flock --nonblock` over a watcher this process keeps alive. The watcher prints one
 *  line once the lock is held — a take is settled fact, not a spawn that may still fail — and
 *  polls this process's pid every second, exiting when it is gone: the lock dies with the runner
 *  within a second, SIGKILL included (review round 1, finding 3), and at once on `release`, which
 *  kills the watcher's process group. `flock` exit 1 is another process on this machine holding
 *  the lock. */
export class MachineLocks {
  private readonly held = new Map<string, { child: ReturnType<typeof spawn>; path: string }>();
  private readonly busy = new Set<string>();
  constructor(private readonly paths: Record<string, string>, private readonly log: (line: string) => void) {}

  /** Whether `capability` is one this runner was given a lock file for. */
  manages(capability: string): boolean {
    return Object.hasOwn(this.paths, capability);
  }

  /** Whether the lock is held now. */
  holds(capability: string): boolean {
    return this.held.has(capability);
  }

  /** Try to take the lock without waiting. False when another process on this machine holds it,
   *  or no `flock` could run (said as such: a missing `flock` is not a busy lock); the line is
   *  said once per capability per stretch. */
  take(capability: string): Promise<boolean> {
    if (this.holds(capability)) return Promise.resolve(true);
    const path = this.paths[capability];
    if (path == null) return Promise.resolve(false);
    return new Promise((resolve) => {
      let settled = false;
      let buf = '';
      try {
        mkdirSync(dirname(path), { recursive: true });
      } catch { /* an unwritable directory: the spawn below says it */ }
      const child = spawn('flock', ['--exclusive', '--nonblock', path, ...lockWatcherArgv(process.pid)],
        { stdio: ['ignore', 'pipe', 'ignore'], detached: true });
      const done = (ok: boolean, missing = false) => {
        if (settled) return;
        settled = true;
        if (ok) {
          this.held.set(capability, { child, path });
          this.busy.delete(capability);
          this.log(`baton: took the lock of ${capability} (${path}) — held until its claim ends or a leg not requiring it starts (R-BTN-178)`);
        } else {
          try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* already gone */ }
          if (!this.busy.has(capability)) {
            this.busy.add(capability);
            this.log(missing
              ? `baton: no \`flock\` on this machine to take ${capability}'s lock (${path}) — not declaring it, so no leg requiring it is offered here; install util-linux flock (macOS: \`brew install flock\`) (R-BTN-178)`
              : `baton: ${capability}'s lock (${path}) is held by another process on this machine — not declaring it, so no leg requiring it is offered here (R-BTN-178)`);
          }
        }
        resolve(ok);
      };
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (d: string) => {
        buf += d;
        if (buf.includes('baton:held')) done(true);
      });
      child.on('error', (e: NodeJS.ErrnoException) => done(false, e.code === 'ENOENT'));
      child.on('close', () => done(false));
    });
  }

  /** Release one capability's lock. */
  release(capability: string): void {
    const h = this.held.get(capability);
    if (!h) return;
    this.held.delete(capability);
    try { process.kill(-h.child.pid!, 'SIGKILL'); } catch { /* already gone: the lock died with it */ }
  }

  /** Release every lock, or all but those `keep` names — the claim's end, or its next leg's set. */
  releaseAll(keep?: (capability: string) => boolean): void {
    for (const capability of [...this.held.keys()]) {
      if (!keep || !keep(capability)) this.release(capability);
    }
  }

  /** Take every configured lock not held (the idle maintenance of a beat): a lock free again is
   *  taken and declared, one still held elsewhere stays quiet. */
  async takeAll(): Promise<void> {
    await Promise.all(Object.keys(this.paths).map((c) => this.take(c)));
  }
}
