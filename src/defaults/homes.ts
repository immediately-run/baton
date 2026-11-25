// homes.ts — `baton home list | use | add | remove | show` and the home in force (B-121,
// BATON_SPEC §11.3 R-BTN-127): the CLI's `~/.config/baton/homes.json`, beside keys.json,
// origins.json and runner.json (R-BTN-137), naming the home repositories an operator moves
// between — docs, fieldhouse, baton. A home is a convenience, never a boundary: it grants
// nothing, and every request is still signed and checked as without it. What it holds is what
// a command needs when its argument names no repository: the repository (a positional REPO and
// a qualified ticket id still override it), the origin (`--url` and `BATON_URL` still override
// it) and, for `baton run`, the checkout.
//
// The home in force is `--home <name|path>`, then `BATON_HOME`, then the file's `default` —
// never a guess: a home whose origin differs from `--url`/`BATON_URL` refuses, both named
// (R-BTN-56), and with homes and none in force a command that needs a repository refuses,
// listing them. `home *` is local: it calls no server (R-BTN-129's actions are not its), so a
// refusal is thrown and the CLI prints it as one `baton: …` line, exit 2 — the same contract
// the ticket commands keep (tickets.ts).
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ORIGIN, REPOSITORY_ID } from '../core/validate';
import { readSettingsJson } from './tickets-config';
import { remoteSlug } from './remote-slug';
// Where homes.json sits is spelled once, in the CLI's own entry (beside DEFAULT_URL, the other
// value tickets.ts reads the same way), so the CLI's fast path and this module cannot drift.
import { homesPath } from '../client/config.mjs';

/** One home as homes.json holds it (B-121): the origin its repository's Baton serves (a
 *  checkout's `baton_url`, R-BTN-56), the repository id, and — when the operator named one —
 *  the checkout `baton run --home <name>` works. */
export interface HomeEntry {
  origin: string;
  repository: string;
  checkout?: string;
}

/** homes.json (B-121): `{default?: <name>, homes: {<name>: {origin, repository, checkout?}}}`.
 *  A name defaults to the repository id and matches its pattern; `default` names a home. */
export interface HomesFile {
  default?: string;
  homes: Record<string, HomeEntry>;
}

/** The refusal's shape (B-121's unit half): `<file>: <field>: <why>`, one line, exit 2 thrown. */
function bad(what: string, field: string, why: string): never {
  throw new Error(`${what}: ${field}: ${why}`);
}

/** homes.json as it must be (B-121), validated through src/core/validate.ts's patterns: a home
 *  name and its `repository` are repository ids (R-BTN-47), its `origin` an origin (R-BTN-137).
 *  `what` names the file in every refusal, the field beside it. */
export function parseHomes(text: string, what: string): HomesFile {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return bad(what, 'homes.json', 'not JSON');
  }
  if (json == null || typeof json !== 'object' || Array.isArray(json)) bad(what, 'homes.json', 'the file is {default?: <name>, homes: {<name>: {origin, repository, checkout?}}}');
  const { default: def, homes, ...rest } = json as Record<string, unknown>;
  for (const key of Object.keys(rest)) bad(what, key, 'unknown key — the file keeps default and homes');
  if (homes == null || typeof homes !== 'object' || Array.isArray(homes)) bad(what, 'homes', 'an object {<name>: {origin, repository, checkout?}}');
  const out: Record<string, HomeEntry> = {};
  for (const [name, entry] of Object.entries(homes as Record<string, unknown>)) {
    if (!REPOSITORY_ID.test(name)) bad(what, `homes.${name}`, 'a home name is like a repository id (R-BTN-47): lowercase, a letter first, at most 40 of [a-z0-9-]');
    if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) bad(what, `homes.${name}`, 'an object {origin, repository, checkout?}');
    const { origin, repository, checkout, ...extra } = entry as Record<string, unknown>;
    for (const key of Object.keys(extra)) bad(what, `homes.${name}.${key}`, 'unknown key — a home keeps origin, repository and checkout');
    if (typeof origin !== 'string' || !ORIGIN.test(origin)) bad(what, `homes.${name}.origin`, 'an origin (R-BTN-137): scheme and host, no path, no trailing slash, e.g. https://baton.immediately.run');
    if (typeof repository !== 'string' || !REPOSITORY_ID.test(repository)) bad(what, `homes.${name}.repository`, 'a repository id (R-BTN-47), e.g. docs');
    if (checkout !== undefined && (typeof checkout !== 'string' || checkout === '')) bad(what, `homes.${name}.checkout`, 'a checkout path');
    out[name] = { origin, repository, ...(checkout != null ? { checkout } : {}) };
  }
  if (def !== undefined && (typeof def !== 'string' || !(def in out))) bad(what, 'default', 'names one of homes');
  return { ...(def !== undefined ? { default: def as string } : {}), homes: out };
}

/** homes.json read (null when absent); a malformed file refuses naming the file and the field. */
export function readHomes(path: string = homesPath()): HomesFile | null {
  if (!existsSync(path)) return null;
  return parseHomes(readFileSync(path, 'utf8'), path);
}

/** homes.json as the `home use|add|remove` commands leave it: one JSON object, a trailing
 *  newline, the homes in name order so the file diffs as the operator reads it. The config
 *  directory is made when it is not there — a first `baton home add` on a fresh machine. */
export function writeHomes(path: string, file: HomesFile): void {
  mkdirSync(dirname(path), { recursive: true });
  const homes = Object.fromEntries(Object.keys(file.homes).sort().map((name) => [name, file.homes[name]]));
  writeFileSync(path, `${JSON.stringify({ ...(file.default != null ? { default: file.default } : {}), homes }, null, 2)}\n`);
}

/** Two origins equal with only a trailing slash apart: the OIDC `aud` never carries one
 *  (R-BTN-15), but a URL typed at a flag might. */
export const sameOrigin = (a: string, b: string): boolean => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');

/** The origin a checkout's `.baton/baton.json` `baton_url` names, or the refusal naming the
 *  checkout (round 1: `homeOfCheckout` and `home add --checkout` asked the same question twice,
 *  word for word). R-BTN-56: a home checkout names its Baton; R-BTN-137: what it names is an
 *  origin. */
function batonUrlOf(checkout: string, settings: ReturnType<typeof readSettingsJson>): string {
  if (!settings.baton_url) throw new Error(`${checkout}: no .baton/baton.json baton_url — a home checkout names its Baton (R-BTN-56)`);
  if (!ORIGIN.test(settings.baton_url)) throw new Error(`${checkout}: baton_url (${settings.baton_url}) is not an origin: scheme and host, no path, no trailing slash (R-BTN-137)`);
  return settings.baton_url;
}

/** A value naming an existing *directory* (B-121's word for a path), not merely any existing
 *  file: `--home` names a checkout, and a checkout is a directory. */
const namesDirectory = (p: string): boolean => {
  try { return statSync(p).isDirectory(); } catch { return false; }
};

/** A `--home`/`BATON_HOME` value names a checkout path rather than a home when it contains `/`
 *  or names an existing *directory* (B-121 — the spec's word; a regular file that exists is not
 *  a checkout). Everything else is a name in homes.json. */
export function looksLikePath(value: string, exists: (p: string) => boolean = namesDirectory): boolean {
  return value.includes('/') || exists(value);
}

/** The home a checkout names (B-121, `--home <path>`): the origin from its `.baton/baton.json`'s
 *  `baton_url` (R-BTN-56), and the repository the settings' `repos` short name for the
 *  checkout's origin slug, else the slug's last segment lowercased — `admin repo add`'s own
 *  default id, the ticket commands' rule (tickets.ts's batonTarget). */
export function homeOfCheckout(checkout: string): HomeEntry & { checkout: string } {
  const settings = readSettingsJson(checkout);
  const origin = batonUrlOf(checkout, settings);
  const slug = remoteSlug(checkout)?.toLowerCase() ?? null;
  const short = slug != null ? Object.entries(settings.repos ?? {}).find(([, path]) => path.toLowerCase() === slug)?.[0] : undefined;
  const repository = short ?? (slug != null ? (slug.split('/').at(-1) ?? '') : '');
  if (!REPOSITORY_ID.test(repository)) {
    throw new Error(`${checkout}: its origin (${slug ?? 'none'}) names no repository id — name the repository yourself, or add the checkout as a home: baton home add <name> --repository <id> --checkout ${checkout}`);
  }
  return { origin, repository, checkout };
}

/** Where the home in force came from (B-121): the `--home` flag, `BATON_HOME`, or homes.json's
 *  `default` — `baton home show` prints it. */
export type HomeSource = '--home' | 'BATON_HOME' | 'default';

/** The home in force, as `baton home show` prints it and the CLI's commands read it. */
export interface HomeInForce {
  name: string;
  home: HomeEntry;
  source: HomeSource;
}

/** The homes as a command meets them (B-121): the home in force (null when none is) and every
 *  home's name — what a command that needs a repository lists when none is in force.
 *
 *  Resolution: `--home <name|path>` (a value containing `/` or naming an existing directory is
 *  a path, read as its checkout), then `BATON_HOME` (the same rule), then the file's `default`.
 *  A name that is no home refuses, listing the file's names. A home in force whose origin
 *  differs from `explicitUrl` — the `--url` flag or `BATON_URL`, never a default — refuses,
 *  both named: the CLI never guesses across origins (R-BTN-56, B-121). */
export interface HomesResolution {
  inForce: HomeInForce | null;
  names: string[];
}

export function resolveHomes(opts: { flag?: string; env?: NodeJS.ProcessEnv; explicitUrl?: string | null; homes?: HomesFile | null; path?: string; exists?: (p: string) => boolean } = {}): HomesResolution {
  const env = opts.env ?? process.env;
  const homes = 'homes' in opts ? opts.homes : readHomes(opts.path ?? homesPath(env));
  const names = homes ? Object.keys(homes.homes) : [];
  const listing = names.length ? `homes: ${names.join(', ')}` : 'no homes configured';
  const byName = (name: string, source: HomeSource): HomeInForce => {
    const home = homes?.homes[name];
    if (!home) throw new Error(`${source} names no home ${name} — ${listing} (baton home list)`);
    return { name, home, source };
  };
  const byValue = (value: string, source: '--home' | 'BATON_HOME'): HomeInForce => {
    if (looksLikePath(value, opts.exists)) {
      const ofCheckout = homeOfCheckout(resolve(value));
      return { name: ofCheckout.checkout, home: ofCheckout, source };
    }
    return byName(value, source);
  };
  let inForce: HomeInForce | null = null;
  if (opts.flag !== undefined && opts.flag !== '') inForce = byValue(opts.flag, '--home');
  else if (env.BATON_HOME) inForce = byValue(env.BATON_HOME, 'BATON_HOME');
  else if (homes?.default != null) inForce = byName(homes.default, 'default');
  if (inForce && opts.explicitUrl != null && opts.explicitUrl !== '' && !sameOrigin(inForce.home.origin, opts.explicitUrl)) {
    throw new Error(`the home in force (${inForce.name}) names origin ${inForce.home.origin}, but --url/BATON_URL names ${opts.explicitUrl} — never guess across origins (R-BTN-56, B-121): make them agree, or drop one`);
  }
  return { inForce, names };
}

/** `baton run`'s `--home` (B-121): its meaning kept — a checkout the runner works — with a
 *  name resolving to its home's `checkout`, refused naming the home when the home has none. A
 *  path (a value containing `/` or naming an existing directory) is itself, as R-BTN-131 has
 *  always read it. */
export function runnerHome(value: string, env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = namesDirectory): string {
  if (looksLikePath(value, exists)) return value;
  const homes = readHomes(homesPath(env));
  const home = homes?.homes[value];
  if (!home) throw new Error(`--home names no home ${value}${homes ? ` — homes: ${Object.keys(homes.homes).join(', ')}` : ' and no homes.json is configured'} (baton home list, B-121)`);
  if (home.checkout == null) {
    throw new Error(`the home ${value} names no checkout — baton run works a checkout; baton home add ${value} --repository ${home.repository} --origin ${home.origin} --checkout <path> names one (B-121)`);
  }
  return home.checkout;
}

/** The help `baton home --help` prints (B-121): the commands, the file, and the resolution. */
export function homesHelp(): string[] {
  return [
    'baton home list                                               the homes, the default marked',
    'baton home use <name>                                         make <name> the default home',
    'baton home add [<name>] --repository <id> [--origin <url>] [--checkout <path>]',
    '                   <name> defaults to the repository id; with --checkout the origin is',
    '                   read from its .baton/baton.json (baton_url) and an --origin that differs',
    '                   is refused; without one, --origin is required',
    'baton home remove <name>                                      remove the home (and the default, if it was)',
    'baton home show [--home <name|path>]                          the home in force, and where it came from',
    '',
    `The homes live in ${homesPath()} — {default?: <name>, homes: {<name>: {origin,`,
    'repository, checkout?}}} — beside keys.json, origins.json and runner.json. A home is a',
    "convenience, never a boundary: it grants nothing, and every request is still signed and",
    'checked as without it. The home in force — --home <name|path>, then BATON_HOME, then the',
    "file's default — supplies the repository a command's missing <repository> and a bare ticket",
    'id read in, and the origin a missing --url/BATON_URL calls; the argument you name always',
    'wins, an origin that disagrees refuses (both named), and with several homes and none in',
    'force a command that needs a repository refuses, listing them (B-121).',
  ];
}

export interface HomesIo {
  log?: (line: string) => void;
  /** The environment homes.json's path is read from, for a test of its own. */
  env?: NodeJS.ProcessEnv;
  /** homes.json's path, for a test of its own; the default is homesPath's. */
  path?: string;
  /** The directory a relative --checkout resolves against (a test's stand-in for the cwd). */
  cwd?: string;
}

/** `baton home list | use | add | remove | show` (B-121) — local configuration, no request.
 *  Exit 0 when the command did what it says; a refusal throws, and the CLI prints it as one
 *  `baton: …` line, exiting 2. */
export function homeMain(argv: string[], io: HomesIo = {}): number {
  const log = io.log ?? ((l: string) => process.stdout.write(`${l}\n`));
  const path = io.path ?? homesPath(io.env ?? process.env);
  const homes = readHomes(path);
  const names = homes ? Object.keys(homes.homes) : [];
  const listing = names.length ? `homes: ${names.join(', ')}` : 'no homes configured';
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    for (const line of homesHelp()) log(line);
    return 0;
  }
  const [command, ...rest] = argv;
  if (command === 'list') {
    if (rest.length) throw new Error('baton home list takes no argument');
    if (!homes || !names.length) {
      log(`no homes configured — baton home add <name> --repository <id> --origin <url> [--checkout <path>]`);
      return 0;
    }
    for (const name of names) {
      const h = homes.homes[name];
      log(`${homes.default === name ? '*' : ' '} ${name}  ${h.repository}  ${h.origin}${h.checkout ? `  ${h.checkout}` : ''}`);
    }
    log(`* the default (baton home use <name> moves it) — ${path}`);
    return 0;
  }
  if (command === 'show') {
    // Round 1: `--home <name|path>` may name the home `show` prints, as it rides every API
    // command — without it the ticket §2's `from --home` line is unreachable.
    const at = rest.indexOf('--home');
    if (at >= 0 && rest[at + 1] == null) throw new Error('--home needs a value');
    const restSansHome = at >= 0 ? rest.filter((_, i) => i !== at && i !== at + 1) : rest;
    if (restSansHome.length) throw new Error('baton home show takes no argument');
    const { inForce } = resolveHomes({ ...(at >= 0 ? { flag: rest[at + 1] } : {}), env: io.env ?? process.env, homes });
    if (!inForce) {
      log(`no home in force — ${listing}`);
      return 0;
    }
    const h = inForce.home;
    log(`home in force: ${inForce.name} — repository ${h.repository}, origin ${h.origin}${h.checkout ? `, checkout ${h.checkout}` : ''}`);
    log(`from ${inForce.source}${inForce.source === 'default' ? ' (homes.json default; --home or BATON_HOME overrides it)' : ''}`);
    return 0;
  }
  if (command === 'use') {
    const [name, ...more] = rest;
    if (more.length) throw new Error('baton home use takes one home name');
    if (!name) throw new Error('baton home use <name> — the home to make the default');
    if (!homes || !(name in homes.homes)) throw new Error(`no home ${name} — ${listing} (baton home list)`);
    writeHomes(path, { ...homes, default: name });
    const h = homes.homes[name];
    log(`home in force: ${name} — repository ${h.repository}, origin ${h.origin} (the default: baton board and a bare ticket id now read it, B-121)`);
    return 0;
  }
  if (command === 'remove') {
    const [name, ...more] = rest;
    if (more.length) throw new Error('baton home remove takes one home name');
    if (!name) throw new Error('baton home remove <name> — the home to remove');
    if (!homes || !(name in homes.homes)) throw new Error(`no home ${name} — ${listing} (baton home list)`);
    const { [name]: _removed, ...kept } = homes.homes;
    const wasDefault = homes.default === name;
    writeHomes(path, { homes: kept, ...(wasDefault || homes.default == null ? {} : { default: homes.default }) });
    log(`removed home ${name}${wasDefault ? ' (the default with it — baton home use <name> names the next)' : ''}`);
    return 0;
  }
  if (command === 'add') {
    const flags: Record<string, string> = {};
    const positional: string[] = [];
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === '--repository' || a === '--origin' || a === '--checkout') {
        const v = rest[++i];
        if (v === undefined) throw new Error(`${a} needs a value`);
        flags[a.slice(2)] = v;
      } else if (a.startsWith('--')) throw new Error(`${a}: not a flag of baton home add (--repository, --origin, --checkout)`);
      else if (positional.length >= 1) throw new Error(`${a}: baton home add takes one home name`);
      else positional.push(a);
    }
    // B-121: `<name>` defaults to the repository id and matches its pattern.
    const name = positional[0] ?? flags.repository;
    if (!name) throw new Error('baton home add [<name>] --repository <id> [--origin <url>] [--checkout <path>]');
    if (!REPOSITORY_ID.test(name)) throw new Error(`${name}: a home name is like a repository id (R-BTN-47): lowercase, a letter first, at most 40 of [a-z0-9-]`);
    if (!flags.repository) throw new Error('--repository is required — the home repository\'s id, e.g. docs');
    if (!REPOSITORY_ID.test(flags.repository)) throw new Error(`--repository ${flags.repository}: a repository id (R-BTN-47), e.g. docs`);
    let origin = flags.origin;
    // With --checkout the origin is the checkout's own baton_url (R-BTN-56); an --origin that
    // differs is refused, both named — the same never-guess rule the home in force keeps.
    let checkout: string | undefined;
    if (flags.checkout != null) {
      checkout = resolve(io.cwd ?? process.cwd(), flags.checkout);
      const url = batonUrlOf(checkout, readSettingsJson(checkout));
      if (origin != null && !sameOrigin(origin, url)) {
        throw new Error(`--origin ${origin} differs from ${checkout}'s baton_url ${url} (R-BTN-56) — never guess across origins: drop --origin, or make them agree`);
      }
      origin = url;
    }
    if (origin == null) throw new Error('--origin is required without --checkout (or name a checkout whose .baton/baton.json baton_url is its origin)');
    if (!ORIGIN.test(origin)) throw new Error(`--origin ${origin}: an origin (R-BTN-137): scheme and host, no path, no trailing slash, e.g. https://baton.immediately.run`);
    const replaced = homes?.homes[name] != null;
    writeHomes(path, { ...(homes ?? { homes: {} }), homes: { ...(homes?.homes ?? {}), [name]: { origin, repository: flags.repository, ...(checkout != null ? { checkout } : {}) } } });
    log(`home ${name}: repository ${flags.repository}, origin ${origin}${checkout ? `, checkout ${checkout}` : ''}${replaced ? ' (replaced the previous home of that name)' : ''}`);
    return 0;
  }
  throw new Error(`${command}: baton home list | use <name> | add [<name>] --repository <id> [--origin <url>] [--checkout <path>] | remove <name> | show`);
}

/** Re-exported for the tests and the runner's import: one spelling of the file's path. */
export { homesPath };
