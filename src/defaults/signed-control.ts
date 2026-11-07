// signed-control.ts — what counts when a repository requires owner-signed control inputs
// (B-127, BATON_SPEC R-BTN-66 as amended, §7.1; docs/security-model.mdx mitigation C): a
// control input counts only at a commit carrying a valid SSHSIG (namespace `git`) by a key of
// the repository's owners no agent session holds, for the commit that last changed it — read
// along the default branch's first parents, so a merge that differs from its first parent on a
// control path is that merge's change, never a rollback to an older signed version (the
// adversarial review's finding 13). An unsigned change keeps the last signed version in force;
// with none, nothing counts and the runners stand down, fail closed.
//
// Course code in the CLI, never core (§2b): the sync runs this where the git objects are, and
// posts the outcome (cli.ts); Baton and the runners read the post, and each runner verifies the
// named commits again before loading them (finding 4) through src/shared/commitSign.mjs.
import { verifySignedCommit, type KeygenInput } from '../shared/commitSign.mjs';
import { parseFrontmatter, strList } from './tickets-markdown';

/** An owner signing key of the repository, as Baton serves it: public, and one no agent session
 *  holds (the `human_only` register, B-136's as far as it is built — API keys cannot sign). */
export interface SigningKey {
  public_key: string;
  fingerprint: string;
}

/** The runner-loaded control inputs (B-127 item 4), each a group read from one commit:
 *  `agent_command` and `agent_wrapper` live in `.baton/baton.json`; an override is a course's
 *  `legs/<leg>.run.mjs`; a course's `rank.mjs` (R-BTN-98). */
export const CONTROL_GROUPS = {
  agent_command: [':(glob).baton/baton.json'],
  overrides: [':(glob).baton/courses/**/*.run.mjs'],
  rank: [':(glob).baton/courses/**/rank.mjs'],
} as const;
export type ControlGroup = keyof typeof CONTROL_GROUPS;

/** The control inputs (B-127 item 1), as path patterns: Baton's own configuration, goal files
 *  and everything a privileged interactive session loads or executes (security model reach 1;
 *  OWASP ASI05). The ticket frontmatter field `EXPEDITE` is watched as a field, not a path. A
 *  broader list — workflows, dependency manifests, more frontmatter — is B-126's detection
 *  watch; this is the gate's, deliberately narrower (a ticket's `tier` routes no new credentials
 *  and is not one, the owner 2026-10-27). */
export const SIGNED_CONTROL_PATTERNS = [
  '.baton/**',
  '**/goals/**',
  '.claude/**',
  '.claude-plugin/**',
  '**/.claude-plugin/**',
  'CLAUDE.md',
  '**/CLAUDE.md',
  'AGENTS.md',
  '**/AGENTS.md',
  '.mcp.json',
  '**/.mcp.json',
  'opencode.json',
  '**/opencode.json',
  '.opencode/**',
] as const;

/** One group's state: `read` the commit to load from (null: no signed version — nothing
 *  counts), `key` the fingerprint that signed `read` (null when `read` is only the pre-adoption
 *  baseline beyond the walk's memory, or nothing counts), `unsigned` the commits that changed
 *  the group without counting. */
export interface GroupInForce {
  read: string | null;
  key: string | null;
  unsigned: string[];
}

/** The outcome the sync posts (§7.1): the groups, and every control input whose last change is
 *  unsigned — the notice's paths and commits, a ticket file's entry naming its watched fields. */
export interface SignedControl {
  groups: Record<ControlGroup, GroupInForce>;
  unsigned: { path: string; commits: string[]; fields?: string[] }[];
}

/** A ticket brief's mark (B-127 item 7): whose words the brief is. `signed` only when the
 *  commit that last changed the brief paragraph carries an owner key's signature; `commit` that
 *  commit, `signer` the key when signed. */
export interface BriefMark {
  signed: boolean;
  signer: string | null;
  commit: string;
}

/** One git command in the repository, as the caller's own helper runs it (cli.ts's `git`). */
export type Git = (...args: string[]) => string;
/** The ssh-keygen seam of src/shared/commitSign.mjs (nodeKeygen on Node, a stub in tests). */
export type Keygen = (input: KeygenInput) => { status: number | null; stdout?: string; stderr?: string };

/** How deep the walks read: first-parent commits scanned for a path's last change. Deep enough
 *  that burying a change past it takes that many accepted head moves — each one posting a board
 *  that flagged the change while it was in memory — and bounded so a sync's git stays cheap
 *  (B-137's server-side read of the push deliveries is the memory-free answer; this is the
 *  client-side one). */
export const WALK_BOUND = 2000;
/** How many commits that changed one path the per-path walks list. */
export const CHANGERS_BOUND = 200;
/** The most signatures one sync verifies: past it everything reads unsigned (fail closed). */
export const VERIFIES_MAX = 256;

/** `keys`' public lines, the one list every verify passes. */
const publicKeyLines = (keys: SigningKey[]): string[] => keys.map((k) => k.public_key);

/** One pattern as a whole-path matcher: `**` spans directories, `*` and `?` stay within a
 *  segment — the grammar R-BTN-66's control paths admit (B-126's `controlPattern`, arrived
 *  apart from this change; one lands second to unify them). */
export function controlPattern(pattern: string): RegExp | null {
  if (!/^[A-Za-z0-9_./*?[\]-]{1,200}$/.test(pattern)) return null;
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') { out += '(?:.*/)?'; i += 2; }
      else { out += '.*'; i += 1; }
      continue;
    }
    if (c === '*') { out += '[^/]*'; continue; }
    if (c === '?') { out += '[^/]'; continue; }
    if (c === '[') {
      const close = pattern.indexOf(']', i + 1);
      if (close > i + 1) { out += pattern.slice(i, close + 1); i = close; continue; }
      out += '\\[';
      continue;
    }
    out += c.replace(/[.+{}()|^$\\]/g, '\\$&');
  }
  try {
    return new RegExp(`^${out}$`);
  } catch {
    return null;
  }
}

/** The agent-configuration control inputs (B-127 item 1's deliverable for the paths Baton
 *  cannot gate): what a privileged interactive session loads or executes — Claude Code's
 *  `.claude/**` (hooks, settings, skills, memory), every `CLAUDE.md` and `AGENTS.md`, MCP and
 *  opencode configuration, and plugin manifests. */
export const AGENT_CONFIG_PATTERNS = SIGNED_CONTROL_PATTERNS.filter((p) => !p.startsWith('.baton') && !p.startsWith('**/goals'));

/** Whether `path` is agent configuration (the verifier's list). */
export function isAgentConfigPath(path: string): boolean {
  return AGENT_CONFIG_PATTERNS.some((p) => controlPattern(p)?.test(path) ?? false);
}

/** The control inputs (B-127's list; no per-repository additions yet — R-BTN-66's
 *  `control_paths`, B-126's, feeds this too when it lands). */
export function isSignedControlPath(path: string): boolean {
  return SIGNED_CONTROL_PATTERNS.some((p) => controlPattern(p)?.test(path) ?? false);
}

/** The deps every walk shares: memoized signature checks under their bound. */
class Walk {
  private readonly verified = new Map<string, { key: string } | {} | null>();
  private spent = 0;
  constructor(
    private readonly git: Git,
    private readonly keys: string[],
    private readonly keygen: Keygen,
  ) {}
  /** The commits that changed `pathspec` against their first parent, newest first (bounded). */
  changers(pathspec: string, head: string): string[] {
    return this.git('log', '--first-parent', '--format=%H', `-n${CHANGERS_BOUND}`, head, '--', pathspec)
      .split('\n').map((l) => l.trim()).filter(Boolean);
  }
  /** The commit that added `pathspec`, when that is within the walk's memory; else null. */
  created(pathspec: string, head: string): string | null {
    const out = this.git('log', '--first-parent', '--diff-filter=A', '--format=%H', '-n1', head, '--', pathspec).trim();
    return out || null;
  }
  /** Whether `sha` is signed by an owner key, and which (memoized; past VERIFIES_MAX never). */
  signed(sha: string): { key: string } | {} | null {
    if (this.verified.has(sha)) return this.verified.get(sha) ?? null;
    if (this.spent++ >= VERIFIES_MAX) {
      this.verified.set(sha, null);
      return null;
    }
    let raw: string;
    try {
      raw = this.git('cat-file', 'commit', sha);
    } catch {
      this.verified.set(sha, null);
      return null;
    }
    // A git commit object ends in a newline and the signature covers it; the sync's own `git`
    // helper trims its answer, so the byte is put back rather than verified against a shortened
    // payload. A commit that genuinely lacked it fails closed, like any unsigned one.
    if (!raw.endsWith('\n')) raw += '\n';
    const out = verifySignedCommit(raw, this.keys, this.keygen);
    this.verified.set(sha, out);
    return out;
  }
  /** A file's bytes at `sha`, or null when the commit has no such file. */
  at(sha: string, path: string): string | null {
    try {
      return this.git('show', `${sha}:${path}`);
    } catch {
      return null;
    }
  }
}

/** One group's in-force state: the newest changer whose signature counts, the read commit at
 *  its tree (every later change is unsigned and left behind), or — with no changer within the
 *  walk's memory — the head as the pre-adoption baseline, unverified. */
function groupInForce(walk: Walk, group: ControlGroup, head: string): GroupInForce {
  // Newest first: `git log`'s own order, kept through the dedupe (a group's pathspecs list the
  // same commit twice at most once here, but the order is what the walk below depends on).
  const changers: string[] = [];
  for (const p of CONTROL_GROUPS[group]) for (const sha of walk.changers(p, head)) if (!changers.includes(sha)) changers.push(sha);
  if (!changers.length) return { read: head, key: null, unsigned: [] };
  const unsigned: string[] = [];
  for (const sha of changers) {
    const v = walk.signed(sha);
    if (v) return { read: sha, key: 'key' in v ? v.key : null, unsigned };
    unsigned.push(sha);
  }
  return { read: null, key: null, unsigned };
}

/** Every path the head's first-parent history changed, with the newest commit that changed it:
 *  one bounded `git log --name-status`, its first sight of a path being that path's last
 *  change. Paths beyond the bound keep no entry (their change predates the walk's memory). */
function lastChanges(git: Git, head: string): Map<string, string> {
  const out = new Map<string, string>();
  const text = git('log', '--first-parent', '--no-renames', '--name-status', '--format=%H', `-n${WALK_BOUND}`, head);
  let sha = '';
  for (const line of text.split('\n')) {
    if (/^[0-9a-f]{40}$/.test(line)) { sha = line; continue; }
    if (!sha || !/^[A-Z]\t/.test(line)) continue;
    const path = line.slice(2).split('\t').at(-1)!;
    if (!out.has(path)) out.set(path, sha);
  }
  return out;
}

/**
 * The signed-control state of `head` (B-127): the three runner-loaded groups, and the control
 * inputs whose last change is unsigned — the notice's list. With no owner signing keys (the
 * usual repository today), null: nothing is marked and nothing gated.
 */
export function signedControlOf(head: string, keys: SigningKey[], git: Git, keygen: Keygen): SignedControl | null {
  if (!keys.length) return null;
  const walk = new Walk(git, publicKeyLines(keys), keygen);
  const groups = {
    agent_command: groupInForce(walk, 'agent_command', head),
    overrides: groupInForce(walk, 'overrides', head),
    rank: groupInForce(walk, 'rank', head),
  };
  const byCommit = new Map<string, string[]>();
  for (const [path, sha] of lastChanges(git, head)) {
    if (!isSignedControlPath(path)) continue;
    if (walk.signed(sha)) continue;
    const list = byCommit.get(sha) ?? [];
    list.push(path);
    byCommit.set(sha, list);
  }
  const unsigned = [...byCommit.entries()]
    .flatMap(([sha, paths]) => paths.map((path) => ({ path, commits: [sha] })))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { groups, unsigned };
}

/**
 * The agent-configuration paths of `head` whose last change no owner key signed (B-127 item 1's
 * deliverable for the paths Baton cannot gate): the check the owner's privileged sessions run
 * before they open — a verifier installed outside the repository (user-level settings, or the
 * environment's setup script), because Baton cannot stop a harness loading an unsigned file, and
 * a check kept in the repository is rewritten by the very push it guards. Beyond the walk's
 * memory a change predates the gate and is not listed; an empty answer is a green one.
 */
export function unsignedAgentConfig(head: string, keys: SigningKey[], git: Git, keygen: Keygen): { path: string; commit: string }[] {
  if (!keys.length) return [];
  const walk = new Walk(git, publicKeyLines(keys), keygen);
  const out: { path: string; commit: string }[] = [];
  for (const [path, sha] of lastChanges(git, head)) {
    if (!isAgentConfigPath(path)) continue;
    if (walk.signed(sha)) continue;
    out.push({ path, commit: sha });
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** The text of a ticket's brief: the `**Brief:**` line and the lines of its paragraph — the
 *  words that read as the owner's. Null when the file carries none. */
export function briefOf(text: string): string | null {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.startsWith('**Brief:**'));
  if (at < 0) return null;
  const out = [lines[at]];
  for (let i = at + 1; i < lines.length && lines[i].trim() !== ''; i++) out.push(lines[i]);
  return out.join('\n');
}

/** Whether the file at `sha` carries the EXPEDITE tag, as the ticket source reads `tags:`. */
function expediteAt(walk: Walk, sha: string, path: string): boolean {
  const text = walk.at(sha, path);
  if (text == null) return false;
  const fm = parseFrontmatter(text) as { tags?: unknown } | null;
  return fm != null && strList(fm.tags).includes('EXPEDITE');
}

/** The newest commit of `changers` (newest first) that changed the value — against the next
 *  changer's, or against the absent value when the oldest changer listed is the file's creation
 *  (the value appeared with it). Null when no change is within the walk's memory: the value
 *  predates it and counts as today's, so an unsigned change that touched the file around an
 *  unchanged value — a Status line appended below a signed brief — claims nothing. */
function lastChangeOf<T>(changers: string[], valueOf: (sha: string) => T, absent: T, created: string | null): string | null {
  for (let i = 0; i < changers.length; i++) {
    const was = i + 1 < changers.length
      ? valueOf(changers[i + 1])
      : created === changers[changers.length - 1] ? absent : undefined;
    if (was === undefined) break;
    if (valueOf(changers[i]) !== was) return changers[i];
  }
  return null;
}

/**
 * The brief marks of `paths` (B-127 item 7 — marked whether or not the setting is on) and the
 * paths whose EXPEDITE does not count (item 1: a control input; only under
 * `require_signed_control` does the sync drop it), mapped to the unsigned commit that last
 * changed the tag — the notice names it. Both read the same per-file walk: the newest commit
 * that changed the words — the brief paragraph, the tag — against their state at the previous
 * changer, first parents only, so a Status line appended below changes neither. A value whose
 * last change is beyond the walk's memory is left unmarked and counts as today's (the
 * pre-adoption baseline); a ticket file the head does not carry is left out.
 */
export function marksOf(
  head: string,
  keys: SigningKey[],
  paths: string[],
  git: Git,
  keygen: Keygen,
): { briefs: Map<string, BriefMark>; expedite: Map<string, string> } {
  const briefs = new Map<string, BriefMark>();
  const expedite = new Map<string, string>();
  if (!keys.length) return { briefs, expedite };
  const walk = new Walk(git, publicKeyLines(keys), keygen);
  for (const path of paths) {
    const changers = walk.changers(path, head);
    if (!changers.length) continue;
    const created = walk.created(path, head);
    const briefCommit = lastChangeOf(changers, (sha) => briefOf(walk.at(sha, path) ?? ''), null, created);
    if (briefCommit != null) {
      const v = walk.signed(briefCommit);
      briefs.set(path, v
        ? { signed: true, signer: 'key' in v ? v.key : null, commit: briefCommit }
        : { signed: false, signer: null, commit: briefCommit });
    }
    const expediteCommit = lastChangeOf(changers, (sha) => expediteAt(walk, sha, path), false, created);
    if (expediteCommit != null && !walk.signed(expediteCommit)) expedite.set(path, expediteCommit);
  }
  return { briefs, expedite };
}
