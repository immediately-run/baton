// version.mjs — which client this CLI is (BATON_SPEC §11.3 R-BTN-197, B-254): the package's
// version, whether the code runs from a git working tree (B-138's guard), and the
// `Baton-Client` value every request the CLI and the runner send. A leaf, as `sign.mjs` is: it
// imports only node: builtins, so the runner's bundle takes it without the CLI's graph, and the
// CLI takes it beside `workingTreeOf`'s other readers.
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The version of the package this CLI ships in — the pin the B-138 refusal names. `cli/` reads
 *  the checkout's package.json, the bundled `dist/` the package's own; null when neither reads. */
export function packageVersion() {
  try {
    return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

/** B-138: the git working tree that owns the CLI's code — the directory holding the `.git` the
 *  CLI sits below — or null when no tree owns it (an npm install, npx's cache: a released copy,
 *  whose code no push changes). A checkout's `cli/` and a `dist/` built inside one are working
 *  trees: their code is what a push (a branch a leg checks out) leaves there. A `.git` above a
 *  `node_modules` boundary does not own the code below it — npm laid that down, no branch of
 *  the outer tree does (round 1, the dotfiles `$HOME`: a released copy installed under a `$HOME`
 *  that is itself a git repository is still a released copy). */
export function workingTreeOf(cliFile = fileURLToPath(import.meta.url)) {
  for (let dir = dirname(cliFile), parent = dirname(dir), base = basename(dir);; dir = parent, parent = dirname(dir), base = basename(dir)) {
    if (base === 'node_modules') return null;   // npm's boundary: no tree above it owns this code
    if (existsSync(join(dir, '.git'))) return dir;
    if (parent === dir) return null;
  }
}

/** R-BTN-197 (B-254): what every request the CLI and a runner send says it is — `Baton-Client:
 *  baton/<version>`, `+dev` while the code runs from a git working tree (B-138's guard, a
 *  branch a leg checks out), as `baton/0.1.4+dev`. The server compares by semver precedence,
 *  `+dev` taking no part. */
export function clientVersion() {
  return `baton/${packageVersion() ?? '0.0.0'}${workingTreeOf() != null ? '+dev' : ''}`;
}
