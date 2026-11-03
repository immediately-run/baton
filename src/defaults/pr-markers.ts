// pr-markers.ts — the run-tests gate's marker commits on a PR's branch (B-110): the gate's
// green/red, the close's own record of a leg no agent ran. A marker is a RECORD, never the
// authority (the owner, 2026-11-03, "Through Baton, not git"): it counts only as an empty-tree
// commit — its tree its parent's, the tested head — carrying `Baton-Tests`, `Baton-Tested: <the
// head the script ran on>` and `Baton-Claim: <nonce>`, whose sha is the evidence Baton recorded
// for that claim's run-tests leg (`Claims.syncRecord`, read by the sync with its observation).
// A pusher can write any trailer; it cannot write Baton's record, so a forged marker is content
// — a push that re-opens the gate. The owner's adjudication answer is no trailer at all: it is
// given through Baton (`baton owner resolve`). Shared by the GitHub fact adapter (which reads the
// commits from the forge) and the plain-git reading of a checkout's own git (`commitsOf`, no
// forge, `gh` nowhere in sight); pure but for the injected git, so both hosts type-check it.

/** The trailer keys the gate's marker carries (B-110) — the `branch` course's `Baton-Verdict`
 *  family (R-BTN-96) is its own. */
export const MARKER_KEYS = ['Baton-Tests', 'Baton-Tested', 'Baton-Claim'] as const;

/** One commit of a PR's branch as a fact adapter reads it, oldest first: its sha, its date, its
 *  first parent, whether it changes no tree (its tree is its first parent's — `empty`), and its
 *  message. */
export interface BranchCommit {
  sha: string;
  /** The commit's date, epoch ms (its committer date). */
  at: number;
  /** Its first parent's sha; null for a root, or a parent the adapter did not read. */
  parent: string | null;
  /** Its tree is its first parent's: it changes nothing — a marker's shape. */
  empty: boolean;
  message: string;
}

/** One commit's gate marker claim, read from its trailers — not yet verified (`verifiedMarkers`). */
export interface GateMarker {
  sha: string;
  at: number;
  tests: 'green' | 'red';
  /** The head the script ran on (`Baton-Tested`). */
  tested: string;
  /** The claim whose close wrote it (`Baton-Claim`). */
  claim: string;
}

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

const SHA = /^[0-9a-f]{40}$/;

/** A commit's gate-marker claim: an empty-tree commit whose trailers name the outcome, the
 *  tested head — its own first parent — and the claim. Anything else is content (a push),
 *  whatever its message says: a content commit carrying a trailer is still a push (B-110 round
 *  1, finding 18). */
export function markerOf(c: BranchCommit): GateMarker | null {
  if (typeof c.message !== 'string' || !c.empty) return null;
  const t = trailersOf(c.message);
  const tests = t['Baton-Tests'];
  const tested = t['Baton-Tested'];
  const claim = t['Baton-Claim'];
  if ((tests !== 'green' && tests !== 'red') || tested == null || !SHA.test(tested) || claim == null || claim === '') return null;
  // The marker sits on the head it tested: its first parent IS the tested head.
  if (c.parent !== tested) return null;
  return { sha: c.sha, at: c.at, tests, tested, claim };
}

/** Baton's record a marker is judged against (B-110): the legs claims finished with an evidence
 *  pointer, each with its claim's nonce — `Claims.syncRecord`'s `legs`, read with the sync's
 *  observation. */
export interface RecordedLeg {
  ticket: string;
  leg: string;
  claim_nonce: string;
  evidence: string;
}

/** The markers that count on one branch: each one's sha is the evidence Baton recorded for a
 *  `leg` (`run-tests`) of `ticket` finished by the claim the marker names — a nonce copied onto a
 *  forged commit names a record whose evidence is another sha. */
export function verifiedMarkers(commits: BranchCommit[], ticket: string, record: RecordedLeg[], leg = 'run-tests'): GateMarker[] {
  const ok = new Set(record.filter((r) => r.ticket === ticket && r.leg === leg).map((r) => `${r.claim_nonce}\u0000${r.evidence}`));
  return commits.map(markerOf).filter((m): m is GateMarker => m != null && ok.has(`${m.claim}\u0000${m.sha}`));
}

/** The gate's state on a branch (B-110), read by commit ORDER, never dates (finding 17): the
 *  branch's content head is its newest commit that is not a counted marker; the gate is the
 *  newest counted marker that tested exactly that head — green or red — and open when none did
 *  (no marker yet, or a push after the last one, a forged marker included). */
export function gateOfBranch(commits: BranchCommit[], counted: GateMarker[]): 'open' | 'green' | 'red' {
  const markers = new Set(counted.map((m) => m.sha));
  const content = [...commits].reverse().find((c) => !markers.has(c.sha));
  if (!content) return 'open';
  const last = [...counted].reverse().find((m) => m.tested === content.sha);
  return last ? last.tests : 'open';
}

/** A branch's commits from a checkout's own git — the plain-git half of the fact reading
 *  (B-110): no forge, no `gh`, the commits read where they sit, oldest first. `run` executes git
 *  (bounded and non-interactive as B-94 asks); `range` is what `git log` lists (`<branch>`, or
 *  `<branch> --not <base>` for a PR's own commits). The NUL-separated format carries the whole
 *  message, so a trailer block with blank lines survives intact; a first parent outside the
 *  range has its tree read on its own. */
export function commitsOf(run: (args: string[]) => string, range: string[] = ['HEAD']): BranchCommit[] {
  const log = run(['log', '--format=%H%x1f%P%x1f%T%x1f%ct%x1f%B%x1e', ...range]);
  const rows = log.split('\x1e').map((entry) => entry.replace(/^\s+/, '').trimEnd()).filter((entry) => entry !== '').reverse().map((entry) => {
    const [sha, parents, tree, at, ...message] = entry.split('\x1f');
    return { sha: sha.trim(), parent: parents.trim().split(/\s+/)[0] || null, tree: tree.trim(), at: Number(at) * 1000, message: message.join('\x1f') };
  });
  const trees = new Map(rows.map((r) => [r.sha, r.tree]));
  const treeOf = (sha: string): string | null => {
    if (trees.has(sha)) return trees.get(sha)!;
    try {
      const t = run(['rev-parse', `${sha}^{tree}`]).trim();
      trees.set(sha, t);
      return t;
    } catch {
      return null;
    }
  };
  return rows.map((r) => ({ sha: r.sha, at: r.at, parent: r.parent, empty: r.parent != null && treeOf(r.parent) === r.tree, message: r.message }));
}
