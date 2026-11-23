// homes.test.ts — B-121's unit half: homes.json's parsing and validation (through
// src/core/validate.ts's patterns — repository id, origin), the `baton home` commands, and the
// home in force's resolution through the CLI's own entry (`--home`, then BATON_HOME, then the
// file's default; a positional REPO or a qualified ticket id always wins), the way S-BTN-225
// exercises the same rules against a real Baton. Node only: it runs ssh-keygen and git.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { homesPath, main, plan } from '../../cli/baton.mjs';
import { homeMain, homesHelp, looksLikePath, parseHomes, readHomes, resolveHomes, runnerHome } from '../../src/defaults/homes';

const CLI = join(import.meta.dirname, '../../cli/baton.mjs');
const URLS = {
  docs: 'https://baton.docs.example',
  fieldhouse: 'https://baton.fieldhouse.example',
  baton: 'https://baton.baton.example',
};
/** The three homes the ticket names, as a homes.json file writes them. */
const homesOf = (over: Record<string, unknown> = {}) => ({
  homes: {
    docs: { origin: URLS.docs, repository: 'docs' },
    fieldhouse: { origin: URLS.fieldhouse, repository: 'fieldhouse' },
    baton: { origin: URLS.baton, repository: 'baton' },
    ...over,
  },
});

let dir: string;
let cfg: string;
let key: string;

/** A checkout whose .baton/baton.json names its Baton and its repos' short names. */
function checkout(name: string, batonUrl: string, repos: Record<string, string> = {}): string {
  const at = join(dir, name);
  mkdirSync(join(at, '.baton'), { recursive: true });
  writeFileSync(join(at, '.baton', 'baton.json'), JSON.stringify({ baton_url: batonUrl, repos }));
  execFileSync('git', ['-C', at, 'init', '-q', '.'], { stdio: 'ignore' });
  execFileSync('git', ['-C', at, 'remote', 'add', 'origin', `git@github.com:immediately-run/${name}.git`], { stdio: 'ignore' });
  return at;
}

/** The environment a CLI call runs in: a config directory of its own, no leg variables (this
 *  suite may itself run inside a leg session, whose BATON_HOME names this very checkout). */
const LEG_ENV = ['BATON_HOME', 'BATON_URL', 'BATON_KEY_FILE', 'BATON_TOKEN', 'BATON_KEY', 'BATON_PARENT'];
let saved: Record<string, string | undefined>;
let wasCwd: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'baton-homes-'));
  cfg = mkdtempSync(join(tmpdir(), 'baton-homes-cfg-'));
  saved = {};
  for (const n of [...LEG_ENV, 'XDG_CONFIG_HOME']) {
    saved[n] = process.env[n];
    delete process.env[n];
  }
  process.env.XDG_CONFIG_HOME = cfg;
  wasCwd = process.cwd();
  process.chdir(dir);   // 'docs' names no directory here, so it reads as a home name (B-121)
  key = join(dir, 'the.key');
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key], { stdio: 'ignore' });
});

afterEach(() => {
  process.chdir(wasCwd);
  for (const [n, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[n];
    else process.env[n] = v;
  }
  rmSync(dir, { recursive: true, force: true });
  rmSync(cfg, { recursive: true, force: true });
});

/** homes.json at the config of this test's environment. */
const homesFile = () => join(cfg, 'baton', 'homes.json');
const writeHomesFile = (homes: unknown) => {
  mkdirSync(dirname(homesFile()), { recursive: true });
  writeFileSync(homesFile(), JSON.stringify(homes));
};

/** main() against a stand-in fetch that records each target and answers JSON: what the
 *  resolution-order tests read, with no Baton behind it. */
async function mainCapturing(argv: string[]): Promise<{ code: number; urls: string[] }> {
  const urls: string[] = [];
  const was = globalThis.fetch;
  const out = process.stdout.write;
  const err = process.stderr.write;
  process.stdout.write = process.stderr.write = (() => true) as typeof process.stdout.write;
  globalThis.fetch = (async (url: string | URL | Request) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ repository: { id: 'stub' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const code = await main(argv);
    return { code, urls };
  } finally {
    globalThis.fetch = was;
    process.stdout.write = out;
    process.stderr.write = err;
  }
}

describe('homes.json: parsing and validation through src/core/validate.ts\'s patterns', () => {
  it('reads the file the spec shapes: default optional, each home {origin, repository, checkout?}', () => {
    const file = parseHomes(JSON.stringify({ default: 'docs', homes: { docs: { origin: URLS.docs, repository: 'docs', checkout: '/a/b' }, fieldhouse: { origin: URLS.fieldhouse, repository: 'fieldhouse' } } }), '/x/homes.json');
    expect(file).toEqual({ default: 'docs', homes: { docs: { origin: URLS.docs, repository: 'docs', checkout: '/a/b' }, fieldhouse: { origin: URLS.fieldhouse, repository: 'fieldhouse' } } });
    expect(readHomes(join(dir, 'absent.json'))).toBeNull();
  });
  it('a malformed file names the file and the field, each refusal its own', () => {
    const what = '/x/homes.json';
    expect(() => parseHomes('{', what)).toThrow(`${what}: homes.json: not JSON`);
    expect(() => parseHomes('[]', what)).toThrow(`${what}: homes.json: the file is`);
    expect(() => parseHomes('{"homes": {}, "extra": 1}', what)).toThrow(`${what}: extra: unknown key`);
    expect(() => parseHomes('{"homes": []}', what)).toThrow(`${what}: homes: an object`);
    expect(() => parseHomes(JSON.stringify({ homes: { Docs: { origin: URLS.docs, repository: 'docs' } } }), what)).toThrow(`${what}: homes.Docs: a home name is like a repository id`);
    expect(() => parseHomes(JSON.stringify({ homes: { docs: {} } }), what)).toThrow(`${what}: homes.docs.origin: an origin`);
    expect(() => parseHomes(JSON.stringify({ homes: { docs: { origin: 'https://baton.docs.example/run', repository: 'docs' } } }), what)).toThrow(`${what}: homes.docs.origin: an origin`);
    expect(() => parseHomes(JSON.stringify({ homes: { docs: { origin: 'https://baton.docs.example/', repository: 'docs' } } }), what)).toThrow(`${what}: homes.docs.origin: an origin`);
    expect(() => parseHomes(JSON.stringify({ homes: { docs: { origin: URLS.docs, repository: 'Docs' } } }), what)).toThrow(`${what}: homes.docs.repository: a repository id`);
    expect(() => parseHomes(JSON.stringify({ homes: { docs: { origin: URLS.docs, repository: 'docs', hom: 1 } } }), what)).toThrow(`${what}: homes.docs.hom: unknown key`);
    expect(() => parseHomes(JSON.stringify({ homes: { docs: { origin: URLS.docs, repository: 'docs', checkout: '' } } }), what)).toThrow(`${what}: homes.docs.checkout: a checkout path`);
    expect(() => parseHomes(JSON.stringify({ default: 'nope', homes: { docs: { origin: URLS.docs, repository: 'docs' } } }), what)).toThrow(`${what}: default: names one of homes`);
  });
  it('homesPath: $XDG_CONFIG_HOME, else ~/.config, beside keys.json and runner.json', () => {
    expect(homesPath({ XDG_CONFIG_HOME: '/cfg' })).toBe('/cfg/baton/homes.json');
    expect(homesPath({ HOME: '/u' })).toBe('/u/.config/baton/homes.json');
    expect(homesPath({ XDG_CONFIG_HOME: '', HOME: '/u' })).toBe('/u/.config/baton/homes.json');
  });
});

describe('baton home: the local commands (B-121)', () => {
  const run = (argv: string[], io = {}) => {
    const lines: string[] = [];
    const code = homeMain(argv, { log: (l) => lines.push(l), path: homesFile(), ...io });
    return { code, lines, text: lines.join('\n') };
  };

  it('add with --checkout reads the origin from the checkout\'s .baton/baton.json', () => {
    const at = checkout('fieldhouse', URLS.fieldhouse, { fieldhouse: 'immediately-run/fieldhouse' });
    const { lines } = run(['add', 'fieldhouse', '--repository', 'fieldhouse', '--checkout', at]);
    expect(lines[0]).toBe(`home fieldhouse: repository fieldhouse, origin ${URLS.fieldhouse}, checkout ${at}`);
    expect(readHomes(homesFile())?.homes.fieldhouse).toEqual({ origin: URLS.fieldhouse, repository: 'fieldhouse', checkout: at });
    // An --origin that agrees is accepted (the slash aside, R-BTN-15's rule).
    run(['add', 'fh2', '--repository', 'fieldhouse', '--origin', `${URLS.fieldhouse}/`, '--checkout', at]);
    expect(readHomes(homesFile())?.homes.fh2.origin).toBe(URLS.fieldhouse);
  });
  it('add refuses an --origin that differs from the checkout\'s baton_url, both named; and a checkout with none', () => {
    const at = checkout('fieldhouse', URLS.fieldhouse);
    expect(() => run(['add', 'fieldhouse', '--repository', 'fieldhouse', '--origin', 'https://another.example', '--checkout', at]))
      .toThrow(`--origin https://another.example differs from ${at}'s baton_url ${URLS.fieldhouse} (R-BTN-56)`);
    const bare = join(dir, 'bare');
    mkdirSync(bare, { recursive: true });
    expect(() => run(['add', 'x', '--repository', 'x', '--checkout', bare])).toThrow(`${bare}: no .baton/baton.json baton_url`);
  });
  it('add without --checkout requires --origin; the name defaults to the repository and matches its pattern', () => {
    expect(() => run(['add', 'docs', '--repository', 'docs'])).toThrow('--origin is required without --checkout');
    expect(() => run(['add', '--repository', 'docs', '--origin', URLS.docs])).not.toThrow();
    expect(readHomes(homesFile())?.homes.docs).toEqual({ origin: URLS.docs, repository: 'docs' });
    expect(() => run(['add', 'Nope', '--repository', 'docs', '--origin', URLS.docs])).toThrow('a home name is like a repository id');
    expect(() => run(['add', 'docs2', '--origin', URLS.docs])).toThrow('--repository is required');
    expect(() => run(['add', 'docs2', '--repository', 'docs', '--origin', 'ftp://x'])).toThrow('--origin ftp://x: an origin');
  });
  it('use refuses an unknown name listing the names (exit 2 through the CLI) and sets the default otherwise', () => {
    writeHomesFile(homesOf());
    expect(() => run(['use', 'nope'])).toThrow('no home nope — homes: docs, fieldhouse, baton (baton home list)');
    run(['use', 'fieldhouse']);
    expect(readHomes(homesFile())?.default).toBe('fieldhouse');
    run(['use', 'docs']);
    expect(readHomes(homesFile())?.default).toBe('docs');
    // The exit the CLI gives a refusal: 2, one baton: line.
    writeHomesFile({ homes: { docs: { origin: URLS.docs, repository: 'docs' } } });
    const out = spawnSync(process.execPath, [CLI, 'home', 'use', 'nope'], { encoding: 'utf8', env: { ...process.env, XDG_CONFIG_HOME: cfg } });
    expect(out.status).toBe(2);
    expect(out.stderr).toBe('baton: no home nope — homes: docs (baton home list)\n');
  });
  it('remove removes the home and the default with it; list marks the default; show names the source', () => {
    writeHomesFile({ default: 'docs', ...homesOf() });
    // The file's order is as written: docs, fieldhouse, baton — the default marked with *.
    expect(run(['list']).lines[0]).toBe(`* docs  docs  ${URLS.docs}`);
    expect(run(['list']).lines[2]).toBe(`  baton  baton  ${URLS.baton}`);
    const { text } = run(['show']);
    expect(text).toBe(`home in force: docs — repository docs, origin ${URLS.docs}\nfrom default (homes.json default; --home or BATON_HOME overrides it)`);
    run(['remove', 'docs']);
    expect(readHomes(homesFile())?.default).toBeUndefined();
    // Written by `home remove` itself, the homes land in name order.
    expect(Object.keys(readHomes(homesFile())!.homes)).toEqual(['baton', 'fieldhouse']);
    expect(() => run(['remove', 'docs'])).toThrow('no home docs');
    // show reads --home and BATON_HOME through the same resolution the API commands use.
    expect(run(['show'], { env: { ...process.env, BATON_HOME: 'baton' } }).text).toContain('from BATON_HOME');
    // Round 1: `--home` names the home show prints, so the ticket §2's `from --home` line is
    // reachable — before, show refused any argument and the flag source was unreachable.
    expect(run(['show', '--home', 'baton']).text).toContain('from --home');
    expect(run(['show', '--home', 'baton']).lines[0]).toContain('home in force: baton');
    expect(() => run(['show', '--home'])).toThrow('--home needs a value');
    expect(() => run(['show', 'baton'])).toThrow('baton home show takes no argument');
  });
  it('an unknown subcommand, a stray flag and --help keep the CLI\'s own refusals', () => {
    expect(() => run(['teleport'])).toThrow('baton home list | use <name> | add');
    expect(() => run(['use', 'docs', '--fast'])).toThrow('baton home use takes one home name');
    expect(run(['--help']).lines.length).toBe(homesHelp().length);
  });
  it('the CLI routes `baton home …` to the bundled command (B-121: local, no request)', async () => {
    writeHomesFile({ default: 'docs', ...homesOf() });
    const { code, urls } = await mainCapturing(['home', 'show']);
    expect(code).toBe(0);
    expect(urls).toEqual([]);
  });
});

describe('the home in force: --home, then BATON_HOME, then default (S-BTN-225\'s unit half)', () => {
  it('the default supplies the repository and the origin a missing --url/BATON_URL calls', async () => {
    writeHomesFile({ default: 'fieldhouse', ...homesOf() });
    const { code, urls } = await mainCapturing(['board', '-i', key]);
    expect(code).toBe(0);
    expect(urls).toEqual([`${URLS.fieldhouse}/v1/repositories/fieldhouse/board`]);
  });
  it('--home and BATON_HOME override the default, in that order', async () => {
    writeHomesFile({ default: 'fieldhouse', ...homesOf() });
    expect((await mainCapturing(['board', '--home', 'docs', '-i', key])).urls).toEqual([`${URLS.docs}/v1/repositories/docs/board`]);
    process.env.BATON_HOME = 'baton';
    expect((await mainCapturing(['board', '-i', key])).urls).toEqual([`${URLS.baton}/v1/repositories/baton/board`]);
    expect((await mainCapturing(['board', '--home', 'docs', '-i', key])).urls).toEqual([`${URLS.docs}/v1/repositories/docs/board`]);
    delete process.env.BATON_HOME;
  });
  it('a positional REPO and a qualified ticket id win over all three', async () => {
    writeHomesFile({ default: 'fieldhouse', ...homesOf() });
    process.env.BATON_HOME = 'baton';
    expect((await mainCapturing(['board', 'docs', '--home', 'baton', '-i', key])).urls).toEqual([`${URLS.baton}/v1/repositories/docs/board`]);
    expect((await mainCapturing(['ticket', 'show', 'docs:B-5', '-i', key])).urls).toEqual([`${URLS.baton}/v1/repositories/docs/tickets/B-5`]);
    delete process.env.BATON_HOME;
  });
  it('a bare ticket id reads in the home in force', async () => {
    writeHomesFile({ default: 'fieldhouse', ...homesOf() });
    expect((await mainCapturing(['ticket', 'history', 'B-5', '-i', key])).urls).toEqual([`${URLS.fieldhouse}/v1/repositories/fieldhouse/tickets/B-5/history`]);
    expect((await mainCapturing(['ticket', 'show', 'B-5', '--home', 'docs', '-i', key])).urls).toEqual([`${URLS.docs}/v1/repositories/docs/tickets/B-5`]);
    expect((await mainCapturing(['blocked', 'B-7', '-i', key])).urls).toEqual([`${URLS.fieldhouse}/v1/repositories/fieldhouse/tickets/B-7/blocks`]);
    // plan() pure, as every command's request is: the repository the home names, in the body too.
    expect(plan('owner', ['grants'], undefined, undefined, { repository: 'fieldhouse', names: [] }).path).toBe('/v1/owner/fieldhouse/grants');
    expect(plan('owner', ['revoke', 'SHA256:abc'], undefined, undefined, { repository: 'fieldhouse', names: [] }).path).toBe('/v1/owner/fieldhouse/grants/SHA256%3Aabc/revoke');
    expect(plan('owner', ['resolve', 'B-5', 'baton:stalled', 'retry'], undefined, undefined, { repository: 'fieldhouse', names: [] }).path).toBe('/v1/owner/fieldhouse/tickets/fieldhouse%3AB-5/resolve');
    expect(plan('admin', ['grant', '--key', 'ssh-ed25519 AAAA', '--capabilities', 'a'], undefined, undefined, { repository: 'fieldhouse', names: [] }).body.repository).toBe('fieldhouse');
    // With no home in force, the bare id keeps its old refusal.
    expect(() => plan('ticket', ['show', 'B-5'])).toThrow('the ticket is <repository>:<id>');
  });
  it('round 1: the destructive owner verbs keep their shapes — a named REPO wins, the short shape reads the home', () => {
    // Round 1 inverted the shape tests: `bar lift REPO ID` (three words) was read as the
    // id-only shape, silently retargeting a destructive POST to the home's repository with
    // the named one dropped; the advertised short shape threw instead.
    const home = { repository: 'fieldhouse', names: [] };
    expect(plan('owner', ['bar', 'lift', 'docs', 'B-7'], undefined, undefined, home)).toEqual({ method: 'POST', path: '/v1/owner/docs/bars/B-7/lift', body: {} });
    expect(plan('owner', ['bar', 'lift', 'B-7'], undefined, undefined, home)).toEqual({ method: 'POST', path: '/v1/owner/fieldhouse/bars/B-7/lift', body: {} });
    expect(plan('owner', ['courier', 'revoke', 'docs', 'SHA256:abc'], undefined, undefined, home))
      .toEqual({ method: 'POST', path: '/v1/owner/docs/couriers', body: { fingerprint: 'SHA256:abc', revoke: true } });
    expect(plan('owner', ['courier', 'revoke', 'SHA256:abc'], undefined, undefined, home))
      .toEqual({ method: 'POST', path: '/v1/owner/fieldhouse/couriers', body: { fingerprint: 'SHA256:abc', revoke: true } });
    // settings reads the home for the repository — the PUT path and the code-repos resolver
    // one and the same repository (round 1 left both on need(positional[0])).
    expect(plan('owner', ['settings', '--no-required-bars'], undefined, undefined, home)).toEqual({ method: 'PUT', path: '/v1/owner/fieldhouse/settings', body: { required_bars: [] } });
    expect(plan('owner', ['settings', '--code-repos', 'a/b'], undefined, undefined, home)).toHaveProperty('resolveCodeRepos', { repository: 'fieldhouse', offline: null });
    expect(plan('owner', ['settings', 'docs', '--code-repos', 'a/b'], undefined, undefined, home)).toHaveProperty('resolveCodeRepos', { repository: 'docs', offline: null });
    // Without a home in force, the old refusals stand — the shapes are not re-read.
    expect(() => plan('owner', ['bar', 'lift', 'B-7'])).toThrow('the bar id is required');
    expect(() => plan('owner', ['courier', 'revoke', 'SHA256:abc'])).toThrow('the key fingerprint is required');
    expect(() => plan('owner', ['settings', '--no-required-bars'])).toThrow('the repository id is required');
  });
  it('round 1: a leading-colon id keeps its parse refusal; a bare id with homes and none in force lists them', () => {
    const home = { repository: 'fieldhouse', names: [] };
    // A colon at index 0 names no repository: with a home in force it used to fall through to
    // the bare-id branch and request local id `:B-5` against the home's repository.
    expect(() => plan('ticket', ['show', ':B-5'], undefined, undefined, home)).toThrow('the ticket is <repository>:<id>');
    expect(() => plan('ticket', ['show', ':B-5'])).toThrow('the ticket is <repository>:<id>');
    // §5's rule, which the bare-id commands joined late: several homes, none in force — the
    // refusal lists them, as the missing-REPO one always did.
    expect(() => plan('ticket', ['show', 'B-5'], undefined, undefined, { repository: null, names: ['docs', 'fieldhouse'] }))
      .toThrow('no home in force and no repository named — name one, or baton home use one of: docs, fieldhouse (B-121)');
  });
  it('a home whose origin differs from --url/BATON_URL refuses, both named (R-BTN-56: never guess)', async () => {
    writeHomesFile({ default: 'fieldhouse', ...homesOf() });
    await expect(mainCapturing(['board', '-i', key, '--url', 'https://another.example'])).rejects.toThrow(
      `the home in force (fieldhouse) names origin ${URLS.fieldhouse}, but --url/BATON_URL names https://another.example — never guess across origins`,
    );
    process.env.BATON_URL = 'https://another.example';
    await expect(mainCapturing(['board', '-i', key])).rejects.toThrow('never guess across origins (R-BTN-56, B-121)');
    delete process.env.BATON_URL;
    // An agreeing one passes, a trailing slash aside.
    expect((await mainCapturing(['board', '-i', key, '--url', `${URLS.fieldhouse}/`])).urls[0]).toBe(`${URLS.fieldhouse}/v1/repositories/fieldhouse/board`);
  });
  it('with homes and none in force, a command that needs a repository exits 2 listing them — never picking one', async () => {
    writeHomesFile(homesOf());
    await expect(mainCapturing(['board', '-i', key])).rejects.toThrow('no home in force and no repository named — name one, or baton home use one of: docs, fieldhouse, baton');
    await expect(mainCapturing(['owner', 'grants', '--dev', '-i', key])).rejects.toThrow('no home in force');
    // With no homes at all, the plain requirement stands.
    rmSync(homesFile());
    await expect(mainCapturing(['board', '-i', key])).rejects.toThrow('the repository id is required');
  });
  it('--home names a home or a checkout path; an unknown name refuses listing the homes', async () => {
    writeHomesFile(homesOf());
    await expect(mainCapturing(['board', '--home', 'nope', '-i', key])).rejects.toThrow('--home names no home nope — homes: docs, fieldhouse, baton (baton home list)');
    await expect(mainCapturing(['board', '-i', key, '--home'])).rejects.toThrow('--home needs a value');
    // A checkout path is read as its checkout: origin from its baton_url, repository the repos
    // short name of its origin slug, else the slug's last segment (admin repo add's own rule).
    const at = checkout('fieldhouse', URLS.fieldhouse, { 'fieldhouse': 'immediately-run/fieldhouse' });
    expect((await mainCapturing(['board', '--home', at, '-i', key])).urls).toEqual([`${URLS.fieldhouse}/v1/repositories/fieldhouse/board`]);
    const slug = checkout('immediately-run-baton', URLS.baton);
    expect((await mainCapturing(['board', '--home', slug, '-i', key])).urls).toEqual([`${URLS.baton}/v1/repositories/immediately-run-baton/board`]);
    // BATON_HOME as a path — the shape a leg session runs in — reads the same.
    process.env.BATON_HOME = at;
    expect((await mainCapturing(['board', '-i', key])).urls).toEqual([`${URLS.fieldhouse}/v1/repositories/fieldhouse/board`]);
    delete process.env.BATON_HOME;
  });
  it('a checkout with no baton_url names the checkout; a malformed homes.json names the file and the field', async () => {
    const bare = join(dir, 'bare');
    mkdirSync(bare, { recursive: true });
    writeHomesFile(homesOf());
    await expect(mainCapturing(['board', '--home', bare, '-i', key])).rejects.toThrow(`${bare}: no .baton/baton.json baton_url`);
    writeHomesFile({ homes: { docs: { origin: 'nope', repository: 'docs' } } });
    await expect(mainCapturing(['board', '-i', key])).rejects.toThrow(`${homesFile()}: homes.docs.origin: an origin`);
    await expect(mainCapturing(['home', 'list'])).rejects.toThrow(`${homesFile()}: homes.docs.origin: an origin`);
  });
});

describe('resolveHomes and runnerHome: the pure halves', () => {
  it('looksLikePath: a slash or an existing directory; a regular file is not a checkout (round 1)', () => {
    const file = join(dir, 'a-file');
    writeFileSync(file, 'x');
    expect(looksLikePath('/an/absolute/path')).toBe(true);
    expect(looksLikePath('rel/path')).toBe(true);
    // The cwd of this suite is dir: 'a-file' exists there as a regular file — the spec's word
    // is *directory*, so it reads as a home name (and then names no home), not a checkout.
    expect(looksLikePath('a-file')).toBe(false);
    const folder = join(dir, 'a-folder');
    mkdirSync(folder);
    expect(looksLikePath('a-folder')).toBe(true);
    expect(looksLikePath('nothing-here')).toBe(false);
  });
  it('resolveHomes: the source of each win, and the names for the none-in-force listing', () => {
    const homes = parseHomes(JSON.stringify({ default: 'fieldhouse', ...homesOf() }), 'x');
    expect(resolveHomes({ env: {}, homes })).toMatchObject({ inForce: { name: 'fieldhouse', source: 'default' }, names: ['docs', 'fieldhouse', 'baton'] });
    expect(resolveHomes({ flag: 'docs', env: { BATON_HOME: 'baton' }, homes }).inForce?.source).toBe('--home');
    expect(resolveHomes({ env: { BATON_HOME: 'baton' }, homes }).inForce?.source).toBe('BATON_HOME');
    expect(resolveHomes({ env: {}, homes: parseHomes(JSON.stringify(homesOf()), 'x') }).inForce).toBeNull();
  });
  it('runnerHome: a path keeps R-BTN-131\'s meaning; a name resolves to its checkout, or refuses naming the home', () => {
    const env = { XDG_CONFIG_HOME: cfg };
    writeHomesFile({ homes: { relay: { origin: URLS.baton, repository: 'baton', checkout: '/w/relay' }, bare: { origin: URLS.baton, repository: 'baton' } } });
    expect(runnerHome('/a/checkout', env)).toBe('/a/checkout');
    expect(runnerHome('relay', env)).toBe('/w/relay');
    expect(() => runnerHome('bare', env)).toThrow('the home bare names no checkout — baton run works a checkout');
    expect(() => runnerHome('nope', env)).toThrow('--home names no home nope — homes: relay, bare (baton home list, B-121)');
    expect(() => runnerHome('nope', { XDG_CONFIG_HOME: join(dir, 'empty') })).toThrow('and no homes.json is configured');
  });
});
