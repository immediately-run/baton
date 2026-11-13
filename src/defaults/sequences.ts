// sequences.ts — the CLI's half of Baton's identifier sequences (B-176, BATON_SPEC §4.3
// R-BTN-195): the kinds the CLI names (`ticket-b`, `rule`, `scenario`, `gate`, `migration`), the
// `floor` each kind's is seeded by, and `baton tickets next <kind>`, the command a PR author
// (and an agent) takes a number from. Baton hands the number out (R-BTN-193: git is never a
// counter); git keeps the work, and the one thing the CLI still reads git for is the floor — the
// highest number the caller sees, on the default branch and on every open branch's head, so a
// lost or fresh Baton never reissues a number git holds (value 1: lost state fails closed).
//
// With no Baton configured, unreachable or `--offline`, the caller falls back to today's scan and
// SAYS so (R-BTN-131): the duplicate-id refusal stays the backstop for that path, and a branch
// merging main before it merges and renumbering if main took the number for the rest.
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { send, DEFAULT_URL } from '../../cli/baton.mjs';
import { remoteSlug } from './cli';
import { checkKey, Undetermined } from './tickets-baton';
import { readSettingsJson, readTicketSettings } from './tickets-config';
import { rulesConfig } from './tickets-rules';

const git = (root: string, ...a: string[]): string =>
  execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' } }).trim();

/** One open branch head `git ls-remote --heads` answers. */
interface Head { sha: string; ref: string }

/** The default branch's and every open branch's head — the whole of git a floor reads. The
 *  reserved namespaces (`baton-ticket/*`, `baton-request/*`) are read like any other branch:
 *  a number a filing branch holds is taken. */
const heads = (root: string, remote: string): Head[] => {
  const out = git(root, 'ls-remote', '--heads', remote);
  return out.split('\n').filter(Boolean).map((l) => {
    const [sha, ref] = l.split('\t');
    return { sha: (sha ?? '').trim(), ref: (ref ?? '').trim() };
  }).filter((h) => h.sha !== '' && h.ref !== '');
};

/** A kind the CLI names, with what numbers it: the ticket kind's allocating prefix, the spec
 *  kinds' id prefixes (the rule prefix from `check.rules`, the scenario's and the gate's beside
 *  it), and the migrations' folder. Core knows none of this (value 3). */
export interface NamedKind {
  /** The kind as the route takes it: `ticket-b`, `rule`, `scenario`, `gate`, `migration`. */
  kind: string;
  family: 'ticket' | 'rule' | 'scenario' | 'gate' | 'migration';
  /** The ticket kind's allocating prefix (`B`), or null for the other families. */
  prefix: string | null;
  /** The id prefixes the spec families number (`R-BTN`, `S-BTN`, `G-BTN`). */
  idPrefix: string | null;
  /** Where the numbers live in the tree: the items folder, the spec folder, the migrations'. */
  at: string;
}

/** The one word the CLI adds to a number when it prints it: `<prefix>-<n>`, or the migrations'
 *  four digits (`0049`). */
export function printOf(k: NamedKind, n: number): string {
  if (k.family === 'ticket') return `${k.prefix}-${n}`;
  if (k.family === 'migration') return String(n).padStart(4, '0');
  return `${k.idPrefix}-${n}`;
}

/** Parse the kind word `baton tickets next` (and `new`, `request`) name. `ticket` alone takes
 *  the repository's allocating prefix; `ticket-<prefix>` names one. */
export function parseKind(word: string, root: string): NamedKind {
  const settings = readTicketSettings(root);
  const rules = rulesConfig(readSettingsJson(root).check);
  const items = (settings.items ?? 'tickets').replace(/\/$/, '');
  const of = (family: NamedKind['family'], idPrefix: string | null, at: string): NamedKind => ({ kind: family, family, prefix: null, idPrefix, at });
  if (word === 'rule') return of('rule', rules.prefix, 'spec/BATON_SPEC');
  if (word === 'scenario') return of('scenario', rules.prefix.replace(/^R-/, 'S-'), 'spec/BATON_SPEC');
  if (word === 'gate') return of('gate', rules.prefix.replace(/^R-/, 'G-'), 'spec/BATON_SPEC');
  if (word === 'migration') return of('migration', null, 'src/migrations');
  const t = /^(?:ticket|ticket-([A-Za-z0-9._-]+))$/.exec(word);
  if (t) {
    const prefix = (t[1] ?? (settings.ticket_prefix ?? 'B').replace(/-$/, '')).replace(/-$/, '');
    const kind = `ticket-${prefix.toLowerCase()}`;
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(kind)) throw new Error(`${word}: not a kind baton tickets next takes — the prefix makes the kind ${kind}, which the sequence route refuses`);
    return { kind, family: 'ticket', prefix, idPrefix: null, at: items };
  }
  throw new Error(`${word}: not a kind baton tickets next takes — rule, scenario, gate, migration, ticket[-<prefix>]`);
}

/** The highest number the `kind`'s identifiers reach across the default branch's and every open
 *  branch's head — the floor a fresh Baton is seeded by (R-BTN-195). A head the checkout cannot
 *  read is skipped, never guessed: a floor too low only risks a number git already holds, and
 *  the backstop catches it at merge. */
export function floorFor(root: string, remote: string, k: NamedKind): number {
  let open: Head[] = [];
  try {
    open = heads(root, remote);
  } catch {
    return 0;
  }
  // One plain fetch of the remote's heads — the same fetch every clone makes, never a
  // by-sha want a server may refuse — then each head read once from the object store,
  // whatever many refs point at it.
  const shas = [...new Set(open.map((h) => h.sha))];
  try {
    git(root, 'fetch', '-q', remote);
  } catch {
    // an unfetchable remote: the numbers it holds are the backstop's at merge, not the floor's
  }
  let floor = 0;
  const seen = (n: number): void => {
    if (Number.isFinite(n) && n > floor) floor = n;
  };
  for (const sha of shas) {
    if (k.family === 'ticket') {
      let listed = '';
      try {
        listed = git(root, 'ls-tree', '-r', '--name-only', sha, '--', k.at, `${k.at}/archive`);
      } catch {
        continue;
      }
      const re = new RegExp(`^${k.prefix!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)\\.mdx?$`, 'i');
      for (const f of listed.split('\n')) seen(Number(re.exec(f.split('/').at(-1) ?? '')?.[1] ?? Number.NaN));
    } else if (k.family === 'migration') {
      let listed = '';
      try {
        listed = git(root, 'ls-tree', '-r', '--name-only', sha, '--', k.at);
      } catch {
        continue;
      }
      for (const f of listed.split('\n')) {
        const name = f.split('/').at(-1) ?? '';
        seen(Number(/^(\d{4})_/.test(name) ? Number(name.slice(0, 4)) : Number.NaN));
      }
    } else {
      let found = '';
      try {
        found = git(root, 'grep', '-h', '-o', '-E', `${k.idPrefix}-[0-9]+`, sha, '--', k.at);
      } catch {
        continue; // git grep exits 1 when nothing matches
      }
      const re = new RegExp(`^${k.idPrefix!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`);
      for (const m of found.split('\n')) seen(Number(re.exec(m.trim())?.[1] ?? Number.NaN));
    }
  }
  return floor;
}

/** `POST /v1/repositories/{repository}/sequences/{kind}/next` (R-BTN-195) with the floor this
 *  checkout sees: the next number, Baton's to give. Throws whatever kept Baton from answering —
 *  the caller falls back to the scan and says so. */
export async function takeNumber(o: {
  url: string;
  keyFile: string;
  repository: string;
  kind: string;
  floor?: number | null;
  forTicket?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<{ kind: string; number: number }> {
  checkKey(o.keyFile);
  let answer: { status: number; json: Record<string, unknown> | null; text: string };
  try {
    answer = await send(o.url, {
      method: 'POST',
      path: `/v1/repositories/${encodeURIComponent(o.repository)}/sequences/${encodeURIComponent(o.kind)}/next`,
      body: { ...(o.floor != null ? { floor: o.floor } : {}), ...(o.forTicket != null ? { for: o.forTicket } : {}) },
    }, o.keyFile, o.fetchImpl) as typeof answer;
  } catch (e) {
    throw new Undetermined(`the ${o.kind} sequence of ${o.repository}`, `Baton at ${o.url} is unreachable (${e instanceof Error ? e.message : String(e)})`);
  }
  if (answer.status >= 200 && answer.status < 300 && Number.isSafeInteger(answer.json?.number)) {
    return { kind: o.kind, number: answer.json!.number as number };
  }
  const code = typeof answer.json?.code === 'string' ? answer.json.code : null;
  throw new Undetermined(`the ${o.kind} sequence of ${o.repository}`, code ? `${code} — ${String(answer.json?.message ?? '')}`.trim() : `HTTP ${answer.status}`);
}

/** Where the ticket commands' Baton reads go (B-129): the URL — `--url`, else `BATON_URL`, else
 *  the repository's own `baton_url`, else the default — the key (`-i`, else `BATON_KEY_FILE`),
 *  and this checkout's Baton repository: the `repos` short name whose forge path is the
 *  checkout's origin, else the origin path's last segment, `admin repo add`'s own default id. */
export function batonTarget(root: string, io: { url?: string; identity?: string }): { url: string; keyFile: string | null; repository: string | null; forgePath: string | null } {
  const json = readSettingsJson(root);
  const forgePath = remoteSlug(root);
  const slug = forgePath?.toLowerCase() ?? null;
  const short = slug != null ? Object.entries(json.repos ?? {}).find(([, path]) => path.toLowerCase() === slug)?.[0] : undefined;
  return {
    url: io.url ?? process.env.BATON_URL ?? json.baton_url ?? DEFAULT_URL,
    keyFile: io.identity?.trim() || process.env.BATON_KEY_FILE?.trim() || null,
    repository: short ?? (slug != null ? (slug.split('/').at(-1) ?? null)?.toLowerCase() ?? null : null),
    forgePath,
  };
}

/** Why a number came from the scan: the one line the fallback says (R-BTN-131 — the scan is the
 *  fallback, and the output says so). */
export const fallbackNote = (why: string): string => `id by the next-free scan — Baton did not answer (${why}); the number may collide with a branch's, and the duplicate check at merge is the backstop`;

/**
 * `baton tickets next <kind> [--for <ticket>] [-i KEY] [--url URL] [--offline] [--repo DIR]`
 * (B-176, R-BTN-195): the next number of one of the repository's sequences — `rule`, `scenario`,
 * `gate`, `migration`, `ticket[-<prefix>]` — for a PR author (and an agent) to use, taken from
 * Baton with the floor this checkout sees. With `--offline`, or when Baton does not answer, the
 * next free number by the scan is printed with the fallback's note. Exit 0 either way: a number
 * printed with its source named is the command's whole answer.
 */
export async function nextMain(argv: string[], io: { root?: string; log?: (line: string) => void; warn?: (line: string) => void; identity?: string; url?: string; offline?: boolean; fetchImpl?: typeof fetch } = {}): Promise<number> {
  const log = io.log ?? ((l: string) => process.stdout.write(`${l}\n`));
  const warn = io.warn ?? ((l: string) => process.stderr.write(`${l}\n`));
  let root = io.root ?? process.env.BATON_HOME ?? process.cwd();
  let kind = '';
  let forTicket: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--repo') root = resolve(value());
    else if (a === '-i') io.identity = value();
    else if (a === '--url') io.url = value();
    else if (a === '--offline') io.offline = true;
    else if (a === '--for') forTicket = value();
    else if (a === '--help' || a === '-h') {
      log('baton tickets next <kind> [--for <ticket>] [-i KEY] [--url URL] [--offline]');
      log('  rule | scenario | gate | migration | ticket[-<prefix>] — the next number of that');
      log('  sequence, taken from Baton with the floor this checkout sees (the default branch and');
      log('  every open branch). --offline and an unanswered Baton print the next free number by');
      log('  the scan and say so. --for names the ticket the number is for, recorded with the take.');
      return 0;
    } else if (a.startsWith('-')) throw new Error(`${a}: not a flag of baton tickets next`);
    else if (kind === '') kind = a;
    else throw new Error(`baton tickets next takes one kind, not ${kind} and ${a}`);
  }
  if (kind === '') throw new Error('baton tickets next <kind> — rule, scenario, gate, migration, ticket[-<prefix>]');
  if (forTicket != null && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(forTicket)) throw new Error(`--for ${forTicket}: not a ticket id of this repository`);
  const parsed = parseKind(kind, root);
  const remote = 'origin';
  const floor = floorFor(root, remote, parsed);
  if (!io.offline) {
    const target = batonTarget(root, io);
    if (target.keyFile != null && target.repository != null) {
      try {
        const took = await takeNumber({ url: target.url, keyFile: target.keyFile, repository: target.repository, kind: parsed.kind, floor, ...(forTicket != null ? { forTicket } : {}) });
        log(`✓ ${parsed.kind}: ${printOf(parsed, took.number)} (Baton's sequence, floor ${floor})`);
        return 0;
      } catch (e) {
        warn(`… ${fallbackNote(e instanceof Error ? e.message : String(e))}`);
      }
    } else {
      warn(`… ${fallbackNote(target.keyFile == null ? 'no key: pass -i KEY (or set BATON_KEY_FILE)' : 'this checkout names no Baton repository')}`);
    }
  } else {
    warn('… id by the next-free scan (--offline): the number may collide with a branch\'s, and the duplicate check at merge is the backstop');
  }
  log(`${parsed.kind}: ${printOf(parsed, floor + 1)} (the next free number by the scan, floor ${floor})`);
  return 0;
}
