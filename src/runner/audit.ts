// audit.ts — the runner's half of B-134's leg scope audit: at each leg's end, the refs the leg's
// window moved in the home checkout are read from the runner's own git — evidence the agent
// does not supply — mapped to the repositories their remotes point at, and the pushes that land
// outside the claim's ticket scope (the claim answer's `scope`) are reported on the advance or
// end that finishes the leg. A cooperative aid, not a control (docs/security-model.mdx, review
// finding 16): it runs as the runner's OS user, inside the trust domain it audits, so a hostile
// leg can hide a push by deleting the remote-tracking ref it left — Baton's cross-check of the
// forge's push deliveries against open claims (`unclaimed-write`) is what does not trust it.
//
// What the evidence is: `git push` moves a remote-tracking ref (`refs/remotes/<remote>/<ref>`)
// and writes `update by push` to its reflog, so a tracking ref that appeared or moved between
// two reads, whose reflog names a push in that window, is one push, to the repository the
// remote's URL points at, whatever local branch it came from. A FETCH moves tracking refs the
// same way (its reflog says `fetch …: storing head`) and names nothing — a leg that only fetches
// from an out-of-scope remote is not reported as having pushed there; a movement with no reflog
// word of a push is not evidence of one, so it names nothing too (the false-positive direction
// is the one a finding and a hold would hang on). A tracking ref the leg DELETED names nothing
// (a push cannot delete one); a local branch alone names nothing (a push moves the tracking ref
// too). PRs opened or commented on and the VM's egress log are sources this half does not have
// — the report's shape carries them (`pr`, `egress`) for the reader that does.
import type { ScopeAction } from '../core/scope';

/** One read of the home checkout's remote state: every remote-tracking ref with the sha it
 *  points at, every configured remote with its push URL, and each tracking ref's reflog, newest
 *  entry first, as the sha it moved the ref to and its message. */
export interface RefState {
  tracking: [ref: string, sha: string][];
  remotes: Record<string, string>;
  log: Record<string, [sha: string, message: string][]>;
}

/** The whole forge path from a git remote URL — `https://github.com/immediately-run/docs.git`,
 *  `ssh://git@github.com/immediately-run/docs`, `git@github.com:immediately-run/docs.git` — or
 *  null when the URL names no repository: a bare path or host (a plain `git` remote's checkout,
 *  a host root) is not a forge repository. The path is kept whole (a GitLab subgroup's
 *  `group/sub/repo` names its repository by all three segments) because that is the spelling a
 *  scope's forge path keeps; naming the last two segments alone would never match a subgroup
 *  entry and report its in-scope pushes as outside. */
export function repoOfUrl(url: string): string | null {
  const clean = url.split(/[?#]/)[0].replace(/\/+$/, '').replace(/\.git$/i, '');
  // A URL with an authority (`scheme://host/path`) or an scp-style spelling
  // (`user@host:path`) names a host; a bare path names none.
  const m = /^([a-z][a-z0-9+.-]*):\/\/[^/?#]+\/(.+)$/i.exec(clean) ?? /^[^@/?#]+@[^@/?#:]+:(.+)$/.exec(clean);
  if (!m) return null;
  const segments = m[m.length - 1].split('/').map((s) => s.trim()).filter((s) => s !== '' && s !== '.' && s !== '..');
  if (segments.length < 2) return null;
  return segments.join('/').toLowerCase();
}

/** The reflog entries of `ref` that fall in the window between the two reads: the newest entries
 *  down to (not including) the one that produced the `before` sha — the movement the before-read
 *  already saw. When the before sha appears in no entry (the ref appeared, or its reflog was
 *  expired past it), every entry is in the window. */
function windowLog(ref: string, before: string | undefined, log: Record<string, [sha: string, string][]>): [sha: string, message: string][] {
  const entries = log[ref] ?? [];
  if (before === undefined) return entries;
  const at = entries.findIndex(([sha]) => sha === before);
  return at < 0 ? entries : entries.slice(0, at);
}

/** The pushes between two reads of the home checkout: each remote-tracking ref that appeared or
 *  moved, and whose reflog names a push (`update by push`) in the window between the reads,
 *  names one push, of the ref it tracks (the remote's namespace stripped back to a
 *  `refs/heads/` spelling), to the repository the remote's URL points at. A remote whose name
 *  has slashes (`git remote add a/b` is legal) is resolved against the configured names, longest
 *  first, so its refs are not misread as the remote `a`'s. A push to a remote whose URL names
 *  no repository (a plain `git` remote's path) is not reported — no repository to name — and a
 *  deleted tracking ref and a fetch-moved one are not either. */
export function pushesBetween(before: RefState, after: RefState): ScopeAction[] {
  const was = new Map(before.tracking);
  const out: ScopeAction[] = [];
  const seen = new Set<string>();
  for (const [ref, sha] of after.tracking) {
    if (was.get(ref) === sha) continue;
    const pushed = windowLog(ref, was.get(ref), after.log).some(([, message]) => message.startsWith('update by push'));
    if (!pushed) continue;
    // `refs/remotes/<rest…>`: the remote is the longest configured name the rest begins with —
    // a remote named `a/b` owns `refs/remotes/a/b/main`, and `ref.split('/')[2]` would misread
    // it as the remote `a`, which is not configured, and skip the push.
    const rest = ref.split('/').slice(2);
    let remote: string | null = null;
    let tail: string[] = [];
    for (let i = rest.length - 1; i > 0; i--) {
      const candidate = rest.slice(0, i).join('/');
      if (candidate in after.remotes) { remote = candidate; tail = rest.slice(i); break; }
    }
    if (remote == null) continue; // a remote the after-read no longer names: not evidence of a push
    const repository = repoOfUrl(after.remotes[remote]);
    if (repository == null) continue;
    const name = `refs/heads/${tail.join('/')}`;
    const key = `${repository}\u0000${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: 'push', target: repository, ref: name });
  }
  return out;
}

/** The actions outside the scope the claim answer carried (lowercased forge paths). A scope the
 *  claim answer did not carry (a Baton before B-134) audits nothing: there is no list to be
 *  outside. */
export function outsideScope(actions: ScopeAction[], scope: string[] | null | undefined): ScopeAction[] {
  if (scope == null) return [];
  const inScope = new Set(scope.map((s) => s.toLowerCase()));
  return actions.filter((a) => !inScope.has(a.target.toLowerCase()));
}

/** One read of the checkout's remote state, null when git could not answer — an unreadable
 *  audit is no audit, never a wrong one, and never a failed leg. */
export function readRefState(run: (args: string[]) => string): RefState | null {
  try {
    const remotes: Record<string, string> = {};
    for (const line of run(['remote', '-v']).split('\n')) {
      // `<name>\t<url> (fetch)` — the push URL is the same on every leg's checkout; a push URL
      // that differs is still the push's target, so it wins when it is listed.
      const m = /^([^\s]+)\t(\S+)\s+\((fetch|push)\)$/.exec(line.trim());
      if (!m) continue;
      if (m[3] === 'push' || !(m[1] in remotes)) remotes[m[1]] = m[2];
    }
    const tracking: [string, string][] = [];
    for (const line of run(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/remotes/']).split('\n')) {
      const at = line.indexOf(' ');
      if (at <= 0) continue;
      const ref = line.slice(0, at);
      const sha = line.slice(at + 1).trim();
      // A remote's own HEAD symref (`refs/remotes/origin/HEAD`) moves with fetches, not pushes.
      if (ref.endsWith('/HEAD') || !/^[0-9a-f]{40}$/.test(sha)) continue;
      tracking.push([ref, sha]);
    }
    // The reflog, newest entry first per ref — `git reflog show --all` walks every ref's log —
    // as `<selector>\t<sha it moved to>\t<message>`. The message is what tells a push
    // (`update by push`) from a fetch (`fetch …: storing head`); entries for refs this audit
    // does not read (local branches, a remote's HEAD) are skipped by name.
    const log: Record<string, [sha: string, message: string][]> = {};
    for (const line of run(['reflog', 'show', '--all', '--format=%gD%x09%H%x09%gs']).split('\n')) {
      const [selector, sha, ...message] = line.split('\t');
      if (!selector?.startsWith('refs/remotes/')) continue;
      const ref = selector.slice(0, selector.indexOf('@{'));
      if (!ref || ref.endsWith('/HEAD') || !/^[0-9a-f]{40}$/.test(sha ?? '')) continue;
      (log[ref] ??= []).push([sha, message.join('\t')]);
    }
    return { tracking, remotes, log };
  } catch {
    return null;
  }
}
