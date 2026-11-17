// cliPin.ts — the CLI's own pinning (B-253, BATON_SPEC §8.3 R-BTN-72): a runner says what its
// code is, in a line at start and in every heartbeat's `profile`. The checkout the CLI runs
// from is found with the same walk B-138's guard uses (`workingTreeOf`): a branch tip is not a
// pinned commit — a push moves the code — while a tagged release and a detached commit are; a
// released copy (no working tree) names the commit its `dist/build.json` was built from, and is
// unpinned only when that build was dirty, for no commit holds its files. Reported, never
// refused: nothing gates on it, and a state that cannot be read is said so, never guessed.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { workingTreeOf } from '../../cli/baton.mjs';
import { git } from './home';

/** What the runner reports about its own CLI — the heartbeat `profile`'s `cli` key and the
 *  start line's subject. `kind` says how the pinning was read; it stays here, for the line's
 *  word for it never rides the heartbeat. */
export interface CliPin {
  /** The code the CLI is: the checkout's HEAD, or the commit the package was built from;
   *  null when neither reads. */
  commit: string | null;
  /** What names the commit: a branch, a tag, the commit itself when detached, a release's
   *  version; null when unreadable. */
  ref: string | null;
  /** False exactly where the code is not a fixed commit: a branch tip, or a build from a
   *  modified tree. Unknown reads as false — the statement never claims more than it read. */
  pinned: boolean;
  kind: 'branch' | 'tag' | 'commit' | 'release' | 'unknown';
}

/** The profile a heartbeat carries (B-253): `cli: {commit, ref, pinned}` — the three fields
 *  the owner's screen reads, `kind` left behind as the start line's own word. */
export function cliProfile(p: CliPin): { cli: { commit: string | null; ref: string | null; pinned: boolean } } {
  return { cli: { commit: p.commit, ref: p.ref, pinned: p.pinned } };
}

/** Read the CLI's pinning from where its own module sits (`cliFile`): the working tree that
 *  owns it, else the released copy's `dist/build.json`. Never throws — a checkout whose git
 *  cannot answer is reported unknown, and the runner starts anyway. */
export function readCliPin(cliFile: string): CliPin {
  const tree = workingTreeOf(cliFile);
  if (tree == null) return released(dirname(cliFile));
  try {
    const commit = git(tree, ['rev-parse', 'HEAD']).trim();
    try {
      // A branch tip: `symbolic-ref` names it — the state the owner's warning is for.
      return { commit, ref: git(tree, ['symbolic-ref', '--short', '-q', 'HEAD']).trim(), pinned: false, kind: 'branch' };
    } catch {
      // Detached: a tag names a release; the commit naming itself is a fixed commit either way.
      try {
        return { commit, ref: git(tree, ['describe', '--tags', '--exact-match', 'HEAD']).trim(), pinned: true, kind: 'tag' };
      } catch {
        return { commit, ref: commit, pinned: true, kind: 'commit' };
      }
    }
  } catch {
    return { commit: null, ref: null, pinned: false, kind: 'unknown' };
  }
}

/** A released copy (B-138's tree-less CLI): the commit `dist/build.json` was built from — the
 *  package's flat `dist/`, the module beside it — with the package's `version` as its ref. A
 *  build from a modified tree pins nothing: `dirty` is the build's own word that no commit
 *  holds its files. */
function released(dir: string): CliPin {
  const readJson = (p: string): Record<string, unknown> | null => {
    try { return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>; } catch { return null; }
  };
  const b = readJson(join(dir, 'build.json'));
  const version = readJson(join(dir, '..', 'package.json'))?.version;
  const commit = typeof b?.commit === 'string' ? b.commit : null;
  return { commit, ref: typeof version === 'string' ? version : null, pinned: commit != null && b?.dirty !== true, kind: 'release' };
}

/** The lines a runner's start prints (B-253): one naming the CLI's commit and what names it,
 *  and — only where the code is not pinned — the warning, in the owner's words, naming the
 *  branch (or the modified build) that moves it. */
export function cliPinLines(p: CliPin): string[] {
  if (p.commit == null) return ['baton: cli commit unreadable — not a pinned commit (B-253)'];
  const at = p.commit.slice(0, 10);
  switch (p.kind) {
    case 'branch':
      return [
        `baton: cli at ${at} on branch ${p.ref}`,
        `baton: running from branch ${p.ref} at ${p.commit} — not a pinned commit`,
      ];
    case 'tag':
      return [`baton: cli at ${at}, tagged ${p.ref} — a pinned release`];
    case 'commit':
      return [`baton: cli at ${at}, a detached commit — pinned`];
    case 'release':
      return p.pinned
        ? [`baton: cli ${p.ref ?? 'release'} at ${at} — a released copy, pinned`]
        : [
          `baton: cli ${p.ref ?? 'release'} at ${at} — built from a modified tree`,
          `baton: running from a modified build at ${p.commit} — not a pinned commit`,
        ];
    case 'unknown':
      return ['baton: cli commit unreadable — not a pinned commit (B-253)'];
  }
}
