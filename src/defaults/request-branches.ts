// request-branches.ts — the `baton-request/*` side branches (B-174, BATON_SPEC §5.8 R-BTN-131,
// R-BTN-190): where a forge refuses `baton ticket request`'s push to the default branch as
// protected, the same commit lands on `baton-request/<ID>` instead, and a PR opens from it.
// The namespace is reserved — no `branch_pattern` may match it (R-BTN-190), so the request's PR
// is never one of the new ticket's PRs and no leg continues it (R-BTN-25) — but its ticket file
// still holds an id, and every id allocator counts it (R-BTN-131): a request still waiting on
// its branch must not have its id handed to a second ticket.
//
// The scan is git-only and reads nothing but the branch heads: a head the default branch
// already reaches is a request whose PR merged — its id is free again. No refs are written into
// the caller's repository: the heads' objects are fetched with an empty refmap, so nothing
// lands but FETCH_HEAD and the object store. A leaf, like remote-slug.ts: request.ts and
// tickets.ts are bundled separately and both allocate ids.
import { execFileSync } from 'node:child_process';

const git = (root: string, ...a: string[]): string =>
  execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' } }).trim();

/** The side branch a request's commit lands on when the forge refuses the default branch
 *  (R-BTN-131): `baton-request/<ID>`, outside every `branch_pattern` (R-BTN-190). */
export const requestBranch = (id: string): string => `baton-request/${id}`;

/** The `baton-request/*` heads on `remote`, by branch name — the ref names alone, one
 *  `ls-remote`, no objects fetched. A listing that fails (a remote the fetch a moment earlier
 *  did reach, refusing one more call) answers empty and says one line on `warn` (round 1):
 *  the ids it hid are handed out again, and the sync's duplicate-id refusal (R-BTN-131) is
 *  the backstop that answers a collision no listing saw. */
export function requestHeads(at: string, remote: string, warn: (line: string) => void = () => {}): Map<string, string> {
  const out = new Map<string, string>();
  let listed = '';
  try {
    listed = git(at, 'ls-remote', '--heads', remote, 'refs/heads/baton-request/*');
  } catch {
    warn(`baton: the baton-request/* heads on ${remote} could not be listed; none of their ids is counted — a duplicate is answered by the sync's duplicate-id refusal`);
    return out;
  }
  for (const line of listed.split('\n')) {
    // A head's object name is a SHA-1 repository's 40 hex or a SHA-256 repository's 64 (round 1:
    // on the latter every head must stay visible to the allocators); ls-remote never prints a
    // truncated name, so no shorter run is matched.
    const m = /^([0-9a-f]{40}(?:[0-9a-f]{24})?)\trefs\/heads\/(baton-request\/.+)$/.exec(line.trim());
    if (m) out.set(m[2], m[1]);
  }
  return out;
}

/** The ticket numbers an OPEN request branch holds under `prefix` (R-BTN-131): each
 *  `baton-request/*` head on `remote` whose commit `head` — the fetched default branch the
 *  request was about to land on — does not reach, read from the branch's own tree under
 *  `items` by its file names, as every allocator reads the folder. A head `head` reaches is a
 *  request whose PR merged: its id is free again, and counts for nothing here. */
export function openRequestNumbers(at: string, remote: string, items: string, prefix: string, head: string, warn: (line: string) => void = () => {}): number[] {
  const heads = requestHeads(at, remote, warn);
  if (!heads.size) return [];
  // The heads' objects, fetched by name with an empty refmap: FETCH_HEAD and the object store
  // alone, never a remote-tracking ref in the caller's repository. One head deleted between the
  // listing and this fetch must not fail the whole command (round 1): its branch is gone, its
  // id is free again — so a refused batch is fetched one head at a time, and the heads that no
  // longer answer are dropped.
  const byName = (names: string[]) => git(at, 'fetch', '-q', '--refmap=', remote, ...names.map((name) => `refs/heads/${name}`));
  let live = heads;
  try {
    byName([...heads.keys()]);
  } catch {
    live = new Map();
    for (const name of heads.keys()) {
      try {
        byName([name]);
        live.set(name, heads.get(name)!);
      } catch {
        warn(`baton: ${name} on ${remote} could not be fetched; its id is not counted`);
      }
    }
  }
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)\\.mdx?$`);
  const taken: number[] = [];
  for (const sha of live.values()) {
    let reachable = true;
    try {
      git(at, 'merge-base', '--is-ancestor', sha, head);
    } catch {
      reachable = false; // not an ancestor — an unrelated history no more reaches head than a forked one
    }
    if (reachable) continue;
    for (const f of git(at, 'ls-tree', '-r', '--name-only', sha, '--', items).split('\n')) {
      const n = re.exec(f.split('/').at(-1) ?? '')?.[1];
      if (n != null) taken.push(Number(n));
    }
  }
  return taken;
}
