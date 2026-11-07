// audit.ts — the runner's half of B-134's leg scope audit: at each leg's end, the refs the leg's
// window moved in the home checkout are read from the runner's own git — evidence the agent does
// not supply — mapped to the repositories their remotes point at, and the pushes that land
// outside the claim's ticket scope (the claim answer's `scope`) are reported on the advance or
// end that finishes the leg. A cooperative aid, not a control (docs/security-model.mdx, review
// finding 16): it runs as the runner's OS user, inside the trust domain it audits, so a hostile
// leg can hide a push by deleting the remote-tracking ref it left — Baton's cross-check of the
// forge's push deliveries against open claims (`unclaimed-write`) is what does not trust it.
//
// What the evidence is: `git push` moves a remote-tracking ref (`refs/remotes/<remote>/<ref>`),
// so a tracking ref that appeared or moved between two reads names one push, to the repository
// the remote's URL points at, whatever local branch it came from. A tracking ref the leg DELETED
// names nothing (a push cannot delete one); a local branch alone names nothing (a push moves the
// tracking ref too). PRs opened or commented on and the VM's egress log are sources this half
// does not have — the report's shape carries them (`pr`, `egress`) for the reader that does.
import type { ScopeAction } from '../core/scope';

/** One read of the home checkout's remote state: every remote-tracking ref with the sha it
 *  points at, and every configured remote with its push URL. */
export interface RefState {
  tracking: [ref: string, sha: string][];
  remotes: Record<string, string>;
}

/** `owner/name` from a git remote URL — `https://github.com/immediately-run/docs.git`,
 *  `ssh://git@github.com/immediately-run/docs`, `git@github.com:immediately-run/docs.git` — or
 *  null when the URL names no repository: a bare path or host (a plain `git` remote's checkout,
 *  a host root) is not a forge repository. The last two path segments are the repository (a
 *  GitLab subgroup's deeper paths name the subgroup's repository the same way a scope's forge
 *  path does). */
export function repoOfUrl(url: string): string | null {
  const clean = url.split(/[?#]/)[0].replace(/\.git$/i, '');
  // A URL with an authority (`scheme://host/path`) or an scp-style spelling
  // (`user@host:path`) names a host; a bare path names none.
  const m = /^([a-z][a-z0-9+.-]*):\/\/[^/?#]+\/(.+)$/i.exec(clean) ?? /^[^@/?#]+@[^@/?#:]+:(.+)$/.exec(clean);
  if (!m) return null;
  const segments = m[m.length - 1].split('/').map((s) => s.trim()).filter((s) => s !== '' && s !== '.' && s !== '..');
  if (segments.length < 2) return null;
  const [owner, name] = segments.slice(-2);
  if (!owner || !name) return null;
  return `${owner}/${name}`.toLowerCase();
}

/** The pushes between two reads of the home checkout: each remote-tracking ref that appeared or
 *  moved names one push, of the ref it tracks (the remote's namespace stripped back to a
 *  `refs/heads/` spelling), to the repository the remote's URL points at. A push to a remote
 *  whose URL names no repository (a plain `git` remote's path) is not reported — no repository
 *  to name — and a deleted tracking ref is not one either. */
export function pushesBetween(before: RefState, after: RefState): ScopeAction[] {
  const was = new Map(before.tracking);
  const out: ScopeAction[] = [];
  const seen = new Set<string>();
  for (const [ref, sha] of after.tracking) {
    if (was.get(ref) === sha) continue;
    const remote = ref.split('/')[2];
    const url = after.remotes[remote];
    if (url == null) continue; // a remote the after-read no longer names: not evidence of a push
    const repository = repoOfUrl(url);
    if (repository == null) continue;
    const pushed = `refs/heads/${ref.split('/').slice(3).join('/')}`;
    const key = `${repository}\u0000${pushed}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: 'push', target: repository, ref: pushed });
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
    return { tracking, remotes };
  } catch {
    return null;
  }
}
