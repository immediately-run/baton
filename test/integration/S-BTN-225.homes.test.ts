// S-BTN-225 the home in force (B-121; BATON_SPEC §15, §11.3 R-BTN-127, §2.2 R-BTN-56/R-BTN-137):
// homes.json switches the CLI's home repository, and the home in force — `--home <name|path>`,
// then BATON_HOME, then the file's `default` — supplies the repository a command's missing
// <repository> and bare ticket ids read in, and the origin a missing --url/BATON_URL calls.
// Must hold: `baton home use fieldhouse`, then `baton board` (the spec's `baton repo board`)
// reads Fieldhouse's board with no other argument; a bare ticket id resolves in the home in
// force; a positional repository and a qualified id win over all three sources; a home whose
// origin differs from --url/BATON_URL exits 2 naming both, never guessing across origins
// (R-BTN-56); with several homes and none in force a command that needs a repository exits 2
// listing them, never picking one; `--home <path>` still starts a runner on that checkout.
// The unit halves — the malformed-file refusals, the `home add` rules, the runner's name
// resolution through runMain — live in test/unit/homes.test.ts and test/unit/runner-main.test.ts.
// Node only: it runs the CLI's entry in this process, ssh-keygen and git.
import { describe, it, expect, beforeEach, afterEach, inject } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../cli/baton.mjs';
import { parseRunArgs } from '../../src/runner/main';
import { runnerHome } from '../../src/defaults/homes';
import { keyCall, ORIGIN, payload, setAdminKeys, setClock, syncCall, syncToken } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';
import { call as hostCall } from '#host';

const board = inject('board') as { shas: Record<string, string>; states: Record<string, { items?: unknown[]; state?: { items: unknown[] }; ready: string[] }> };

let admin: TestKey;
/** One key file owning both repositories the reads cross — Fieldhouse's, added to docs'. */
let keyFile: string;

/** The CLI in this process against the local host: each request's target captured, the answer
 *  printed as the command prints it, the exit code returned; a thrown refusal rejects. */
async function cli(argv: string[], env: Record<string, string | undefined> = {}): Promise<{ code: number; out: string; err: string; urls: string[] }> {
  const urls: string[] = [];
  const outs: string[] = [];
  const errs: string[] = [];
  const was = globalThis.fetch;
  const out = process.stdout.write;
  const error = process.stderr.write;
  const saved: Record<string, string | undefined> = {};
  for (const [n, v] of Object.entries(env)) {
    saved[n] = process.env[n];
    if (v === undefined) delete process.env[n];
    else process.env[n] = v;
  }
  process.stdout.write = ((x: unknown) => { outs.push(String(x)); return true; }) as typeof process.stdout.write;
  process.stderr.write = ((x: unknown) => { errs.push(String(x)); return true; }) as typeof process.stderr.write;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url instanceof Request ? url.url : url);
    urls.push(target);
    return hostCall(new Request(target, init));
  }) as typeof fetch;
  try {
    const code = await main(argv);
    return { code, out: outs.join(''), err: errs.join(''), urls };
  } finally {
    globalThis.fetch = was;
    process.stdout.write = out;
    process.stderr.write = error;
    for (const [n, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[n];
      else process.env[n] = v;
    }
  }
}

let dir: string;
let cfg: string;
let wasCwd: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
  // The CLI signs at the wall clock (ssh-keygen), so Baton's clock follows it (cli.test.ts's rule).
  await setClock(Date.now());
  admin = await makeKey('ssh-ed25519', 'admin');
  await setAdminKeys(admin);
  // Fieldhouse: registered, owned by a key file the CLI signs with, its board synced — so
  // `baton board` has a real board to read. The same key owns docs, whose seeded board the
  // bare-id case reads; docs and baton are the instance's own seeds.
  dir = mkdtempSync(join(tmpdir(), 'baton-s225-'));
  keyFile = join(dir, 'the.key');
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', keyFile], { stdio: 'ignore' });
  const pub = execFileSync('cat', [`${keyFile}.pub`], { encoding: 'utf8' }).trim().split(' ').slice(0, 2).join(' ');
  expect((await keyCall(admin, '/v1/admin/repositories', {
    id: 'fieldhouse', github: 'immediately-run/fieldhouse', default_branch: 'main',
    sync_workflow: '.github/workflows/baton-sync.yml', owner_keys: [pub],
  })).status).toBe(200);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [pub] })).status).toBe(200);
  await syncCall('/v1/sync/board', payload(board.shas.A, null, board.states.A));
  await syncCall('/v1/sync/board', payload('e'.repeat(40), null, board.states.A),
    await syncToken({ repository: 'immediately-run/fieldhouse', job_workflow_ref: 'immediately-run/fieldhouse/.github/workflows/baton-sync.yml@refs/heads/main' }));
  // The configuration the CLI reads: its own XDG_CONFIG_HOME, no leg variables (this suite may
  // run inside one), and a cwd where 'docs' and 'baton' name no directory (B-121: such a value
  // is a checkout path, not a name).
  cfg = mkdtempSync(join(tmpdir(), 'baton-s225-cfg-'));
  for (const n of ['BATON_HOME', 'BATON_URL', 'BATON_KEY_FILE', 'BATON_TOKEN', 'BATON_KEY', 'BATON_PARENT', 'XDG_CONFIG_HOME']) {
    savedEnv[n] = process.env[n];
    delete process.env[n];
  }
  process.env.XDG_CONFIG_HOME = cfg;
  wasCwd = process.cwd();
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(wasCwd);
  for (const [n, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[n];
    else process.env[n] = v;
  }
  rmSync(dir, { recursive: true, force: true });
  rmSync(cfg, { recursive: true, force: true });
});

/** homes.json as the operator's would be: the instance's three homes, all at its origin. */
function homesJson(default_?: string): string {
  const homes = {
    ...(default_ != null ? { default: default_ } : {}),
    homes: {
      docs: { origin: ORIGIN, repository: 'docs' },
      fieldhouse: { origin: ORIGIN, repository: 'fieldhouse' },
      baton: { origin: ORIGIN, repository: 'baton' },
    },
  };
  mkdirSync(join(cfg, 'baton'), { recursive: true });
  const path = join(cfg, 'baton', 'homes.json');
  writeFileSync(path, JSON.stringify(homes));
  return path;
}

describe('S-BTN-225 the home in force (B-121)', () => {
  it('`baton home use fieldhouse`, then `baton board` reads Fieldhouse\'s board with no other argument', async () => {
    homesJson();
    expect((await cli(['home', 'use', 'fieldhouse'])).code).toBe(0);
    const read = await cli(['board', '-i', keyFile]);
    expect(read.code).toBe(0);
    const answer = JSON.parse(read.out) as { repository: { id: string }; ready: { repository_id: string }[] };
    expect(answer.repository.id).toBe('fieldhouse');
    expect(answer.ready.length).toBeGreaterThan(0);
    expect(answer.ready.every((r) => r.repository_id === 'fieldhouse')).toBe(true);
  });

  it('a bare ticket id resolves in the home in force; a qualified id wins over all three sources', async () => {
    homesJson('fieldhouse');
    expect((await cli(['ticket', 'history', 'R3-9001', '-i', keyFile])).urls[0]).toBe(`${ORIGIN}/v1/repositories/fieldhouse/tickets/R3-9001/history`);
    // A home whose repository holds the ticket answers it: docs' seeded board has R3-9001.
    const show = await cli(['ticket', 'show', 'R3-9001', '-i', keyFile], { BATON_HOME: 'docs' });
    expect(show.code).toBe(0);
    expect(show.urls[0]).toBe(`${ORIGIN}/v1/repositories/docs/tickets/R3-9001`);
    // The qualified id wins over the default, BATON_HOME and --home alike.
    expect((await cli(['ticket', 'show', 'docs:R3-9001', '-i', keyFile, '--home', 'baton'], { BATON_HOME: 'fieldhouse' })).urls[0])
      .toBe(`${ORIGIN}/v1/repositories/docs/tickets/R3-9001`);
  });

  it('--home and BATON_HOME override the default, in that order; a positional repository overrides all three', async () => {
    homesJson('fieldhouse');
    expect((await cli(['board', '--home', 'docs', '-i', keyFile])).urls[0]).toBe(`${ORIGIN}/v1/repositories/docs/board`);
    expect((await cli(['board', '-i', keyFile], { BATON_HOME: 'baton' })).urls[0]).toBe(`${ORIGIN}/v1/repositories/baton/board`);
    expect((await cli(['board', '--home', 'docs', '-i', keyFile], { BATON_HOME: 'baton' })).urls[0]).toBe(`${ORIGIN}/v1/repositories/docs/board`);
    expect((await cli(['board', 'docs', '-i', keyFile, '--home', 'baton'], { BATON_HOME: 'fieldhouse' })).urls[0]).toBe(`${ORIGIN}/v1/repositories/docs/board`);
  });

  it('a home whose origin differs from --url/BATON_URL exits 2 naming both, never guessing across origins (R-BTN-56)', async () => {
    homesJson('fieldhouse');
    await expect(cli(['board', '-i', keyFile, '--url', 'https://another-baton.example'])).rejects.toThrow(
      `the home in force (fieldhouse) names origin ${ORIGIN}, but --url/BATON_URL names https://another-baton.example — never guess across origins`,
    );
    await expect(cli(['board', '-i', keyFile], { BATON_URL: 'https://another-baton.example' })).rejects.toThrow('never guess across origins (R-BTN-56, B-121)');
  });

  it('several homes and none in force: a command that needs a repository exits 2 listing them, never picking one', async () => {
    homesJson();
    await expect(cli(['board', '-i', keyFile])).rejects.toThrow('no home in force and no repository named — name one, or baton home use one of: docs, fieldhouse, baton');
  });

  it('--home <path> still starts a runner on that checkout: a name resolves to its home\'s checkout', async () => {
    const path = homesJson();
    const checkout = mkdtempSync(join(tmpdir(), 'baton-s225-run-'));
    const homes = JSON.parse(readFileSync(path, 'utf8')) as { homes: Record<string, unknown> };
    writeFileSync(path, JSON.stringify({ ...homes, homes: { ...homes.homes, relay: { origin: ORIGIN, repository: 'docs', checkout } } }));
    // The runner's own flag keeps R-BTN-131's meaning for a path, and a name resolves to the
    // checkout its home names (runMain's proof, with the refusals, is runner-main.test.ts's).
    expect(parseRunArgs(['--home', checkout], {}).home).toBe(checkout);
    expect(runnerHome('relay')).toBe(checkout);
    expect(runnerHome(checkout)).toBe(checkout);
    rmSync(checkout, { recursive: true, force: true });
  });
});
