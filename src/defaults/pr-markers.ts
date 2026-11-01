// pr-markers.ts — the `Baton-*` trailer commits a PR's branch carries (B-110): the run-tests
// gate's green/red — the close's own record of a leg no agent ran — and the owner's
// adjudication answer, git's durable record of a person's word. The forge's comment spellings
// (the verdict and adjudication lines, R-BTN-74) are readers beside them, so a plain-git
// repository — no forge adapter, `gh` nowhere in sight (R3-1265) — reads the same facts from
// the branch itself. Shared by the GitHub fact adapter (which reads the commits' messages from
// the forge) and any reader of a checkout's own git; pure, so both hosts type-check it.
import type { FactMarker } from './course-pr';

/** A trailer key of this course's own (B-110): `Baton-Tests`, `Baton-Adjudicated` and
 *  `Baton-Claim` — the `branch` course's `Baton-Verdict` family (R-BTN-96) is its own. */
export const MARKER_KEYS = ['Baton-Tests', 'Baton-Adjudicated', 'Baton-Claim'] as const;

/** A commit message's trailer block, as `git interpret-trailers --parse` reads it: the last
 * paragraph, each line `Key: value` (a folded continuation line is not a trailer of its own),
 * the last occurrence per key. A message whose last paragraph is prose has no trailers. */
export function trailersOf(message: string): Record<string, string> {
  const paragraphs = message.split(/\r?\n\s*\r?\n/).map((p) => p.trim()).filter((p) => p !== '');
  const block = paragraphs.at(-1) ?? '';
  const out: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    // A continuation line (indented, or a folded trailer's tail) extends nothing we read: every
    // value these markers carry is one line.
    const m = /^([A-Za-z][A-Za-z0-9-]*):\s*(\S.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

/** One commit's marker, when its message carries a `Baton-*` trailer this course reads: the
 *  gate's outcome, the owner's answer, the claim whose close wrote it. A commit with none is
 *  not a marker — it is content, a push. */
export function markerOf(commit: { sha: string; at: number; message: string }): FactMarker | null {
  if (typeof commit.message !== 'string') return null; // an adapter that reads no messages sees no markers
  const t = trailersOf(commit.message);
  const tests = t['Baton-Tests'];
  const adjudicated = t['Baton-Adjudicated'];
  if (tests == null && adjudicated == null) return null;
  return {
    at: commit.at,
    sha: commit.sha,
    ...(tests === 'green' || tests === 'red' ? { tests } : {}),
    ...(adjudicated === 'merge' || adjudicated === 'owner' || adjudicated === 'round' ? { adjudicated } : {}),
    ...(t['Baton-Claim'] != null ? { claim: t['Baton-Claim'] } : {}),
  };
}

/** A branch's commits, oldest first, as its marker commits — the readers' half of the fact
 *  adapter's trailer reading (B-110). A commit carrying a marker trailer changes no tree, so
 *  the caller counts it as no push. */
export function markersOfCommits(commits: { sha: string; at: number; message: string }[]): FactMarker[] {
  return commits.map(markerOf).filter((m): m is FactMarker => m != null);
}

/** A branch's commits from a checkout's own git — the plain-git half of the fact reading
 *  (B-110): no forge, no `gh`, the commits read where they sit. `run` executes git (bounded and
 *  non-interactive as B-94 asks); the branch defaults to the checkout's HEAD. The NUL-separated
 *  format carries the whole message, so a trailer block with blank lines survives intact. */
export function commitsOf(run: (args: string[]) => string, branch = 'HEAD'): { sha: string; at: number; message: string }[] {
  const log = run(['log', '--format=%H%x1f%at%x1f%B%x1e', branch]);
  return log.split('\x1e').map((entry) => entry.replace(/^\s+/, '').trimEnd()).filter((entry) => entry !== '').reverse().map((entry) => {
    const [sha, at, ...message] = entry.split('\x1f');
    return { sha: sha.trim(), at: Number(at) * 1000, message: message.join('\x1f') };
  });
}
