// S-BTN-108 a board posted by a sync key (B-88, BATON_SPEC §7.1, §11; R-BTN-93): a repository
// whose sync key is registered posts its board from a laptop — `baton repo sync --sync-key FILE`.
// Must hold: with no CI token and no BATON_SYNC_TOKEN — the laptop's run — `syncMain` signs with
// the flag's key, which is an ed25519 key ssh-keygen made on disk (not one of the harness's
// WebCrypto keys), and the local host reads that key as its sync credential and the board lands;
// an unregistered key is refused `unauthenticated` and a key in the mirror role `forbidden`, each
// before any board is posted; a key registered for another repository posts under that
// repository's board, never this checkout's (its credential names the repository it acts for,
// R-BTN-93), and the repository it serves lists the tickets. Node only: it writes a real
// repository, registers its sync key in the local host and runs git.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { call as hostCall } from '#host';
import { initMain, parseSyncArgs, syncMain } from '../../src/defaults/cli';
import { envAuth } from '../../src/runner/api';
import { ORIGIN, rows, setClock, syncToken, withCore } from '../helpers';
import { githubFake } from '../githubFake';

// The harness's clock: the real one, less a minute. `syncMain` signs with the system clock (the
// stub runs under the real one), so the two must agree within the signature window — 5 minutes —
// and a minute is inside it. `later` moves the host on a step between runs, as S-BTN-104 and
// S-BTN-105 do, since an identical observation needs a fresh number.
const T0 = Date.now() - 60_000;
let minutes = 1;
const later = () => setClock(T0 + (minutes += 1) * 60_000);
/** The repository the checkout's origin names: `docs`, the local host's, so a board lands there. */
const SLUG = 'immediately-run/docs';

/** An ed25519 key ssh-keygen makes: its private file, the public line and the fingerprint a
 *  registration carries. Unlike the harness's WebCrypto keys, its private half is a file the CLI
 *  itself signs with — the laptop's case. */
function keyPair(dir: string, name: string): { file: string; publicKey: string; fingerprint: string } {
  const file = join(dir, name);
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', name, '-f', file], { stdio: 'ignore' });
  const listing = execFileSync('ssh-keygen', ['-l', '-E', 'sha256', '-f', file], { encoding: 'utf8' }).split(' ')[1];
  return { file, publicKey: execFileSync('cat', [`${file}.pub`], { encoding: 'utf8' }).trim().split(' ').slice(0, 2).join(' '), fingerprint: listing };
}

/** Register a sync key for `repository` in `role`: the registry's own route, the fingerprint made
 *  as production makes it (`baton admin repo add --sync-key`, R-BTN-93). */
async function addSyncKey(publicKey: string, repository: string, role: 'sync' | 'mirror' = 'sync'): Promise<string> {
  return withCore((c) => c.registry.addSyncKey(repository, publicKey, role, 'admin:test', []));
}

/** A checkout with a tickets/ wiki and `.baton/` as `baton repo init` writes it, committed. */
function repoWithTickets(): string {
  const dir = mkdtempSync(join(tmpdir(), 'baton-s108-'));
  const g = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: 'ignore' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 'relay@test');
  g('config', 'user.name', 'relay test');
  g('remote', 'add', 'origin', `https://github.com/${SLUG}.git`);
  mkdirSync(join(dir, 'tickets'), { recursive: true });
  writeFileSync(join(dir, 'tickets', 'one.mdx'), '---\nid: T-1\ntitle: One\n---\n');
  return dir;
}

/** The head the board is posted over: the host's own, read before the sync replaces it. */
const headSha = async (): Promise<string> => {
  const res = await hostCall(new Request(`${ORIGIN}/v1/sync/head`, { headers: { Authorization: `Bearer ${await syncToken()}` } }));
  return ((await res.json()) as { sha: string | null }).sha ?? '';
};

/** Every repository's tickets, by qualified id. */
const boardOf = () => rows<{ id: string }>('SELECT id FROM tickets ORDER BY id');

let dir: string;
let scratch: string;
beforeEach(async () => {
  minutes = 1;
  await setClock(T0);
  dir = repoWithTickets();
  scratch = mkdtempSync(join(tmpdir(), 'baton-s108-keys-'));
  expect(await initMain([], { root: dir, log: () => {} })).toBe(0);
  execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'commit', '-qm', 'init'], { stdio: 'ignore' });
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

/** The laptop's environment for one sync: the recorded facts, the local host, and no CI token
 *  and no BATON_SYNC_TOKEN — only the flag's key can authenticate. */
async function onLaptop<T>(key: string, fn: (transport: (req: Request) => Promise<Response>) => Promise<T>): Promise<T> {
  const facts = join(dir, '.baton', 'facts.json');
  writeFileSync(facts, '[]');
  const saved = { url: process.env.ACTIONS_ID_TOKEN_REQUEST_URL, token: process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, sync: process.env.BATON_SYNC_KEY, bearer: process.env.BATON_SYNC_TOKEN };
  delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  delete process.env.BATON_SYNC_TOKEN;
  delete process.env.BATON_SYNC_KEY;
  try {
    const args = parseSyncArgs(['--root', dir, '--url', ORIGIN, '--facts', facts, '--sync-key', key], process.env);
    return await fn((req) => hostCall(req));
  } finally {
    for (const [k, v] of [['ACTIONS_ID_TOKEN_REQUEST_URL', saved.url], ['ACTIONS_ID_TOKEN_REQUEST_TOKEN', saved.token], ['BATON_SYNC_KEY', saved.sync], ['BATON_SYNC_TOKEN', saved.bearer]] as const) {
      if (v !== undefined) process.env[k] = v;
    }
  }
}

/** One sync from the checkout, signed by `key` alone: its exit code. */
function signedSync(key: string): Promise<number> {
  return onLaptop(key, (transport) => syncMain({ root: dir, url: ORIGIN, factsFile: join(dir, '.baton', 'facts.json'), syncKey: key, transport, log: () => {} }));
}

/** The first signed call, as the host answered it — the refusal's status and §11 body. */
function firstSignedCall(key: string): Promise<{ status: number; json: Record<string, unknown> }> {
  return onLaptop(key, async (transport) => {
    // The CLI's own signer (the runner's helper, B-88): what `--sync-key` signs with.
    const auth = envAuth({ BATON_KEY_FILE: key });
    const url = `${ORIGIN}/v1/sync/observation`;
    const res = await transport(new Request(url, { method: 'POST', headers: { ...auth('POST', url, '{}', null), 'Content-Type': 'application/json' }, body: '{}' }));
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  });
}

describe('S-BTN-108 a board posted by a sync key', () => {
  it('a registered sync key posts the board from a laptop, one flag, no CI and no bearer', async () => {
    const key = keyPair(scratch, 'sync');
    // The registration's own fingerprint is the one ssh-keygen gives the file the CLI signs with:
    // one key, so `repo add --sync-key <the .pub>` registers exactly the key `--sync-key <file>`
    // signs with.
    expect(await addSyncKey(key.publicKey, 'docs')).toBe(key.fingerprint);
    later();
    const before = await headSha();
    const code = await signedSync(key.file);
    expect(code).toBe(0);
    // The board landed, under the repository the checkout's origin names.
    expect(await boardOf()).toEqual([{ id: `${SLUG.split('/')[1]}:T-1` }]);
    // And the head moved: the board is a reading after the observation the signed run took.
    expect(before).not.toBe(await headSha());
  });

  it('a key registered for another repository posts nowhere near this repository’s board', async () => {
    later();
    const key = keyPair(scratch, 'elsewhere');
    // The key serves `baton`; this checkout is `docs`.
    expect(await addSyncKey(key.publicKey, 'baton')).toBe(key.fingerprint);
    process.env.GITHUB_TOKEN = 't';
    vi.stubGlobal('fetch', githubFake({ '/repos/immediately-run/baton/pulls?state=all': [] }));
    try {
      expect(await signedSync(key.file)).toBe(0);
    } finally {
      vi.unstubAllGlobals();
      delete process.env.GITHUB_TOKEN;
    }
    // The sync's credential names the repository it acts for (R-BTN-93), so the checkout's
    // tickets land in `baton` — that repository's board — and docs' stays as it was.
    expect(await boardOf()).toEqual([{ id: 'baton:T-1' }]);
  });

  it('an unregistered key is refused, and no board lands', async () => {
    later();
    const key = keyPair(scratch, 'stranger');
    const refused = await firstSignedCall(key.file);
    expect(refused.status).toBe(401);
    expect(refused.json.code).toBe('unauthenticated');
    expect(await signedSync(key.file)).toBe(1);
    expect(await boardOf()).toEqual([]);
  });

  it('a key in the mirror role is refused at the sync’s route', async () => {
    later();
    const key = keyPair(scratch, 'mirror');
    await addSyncKey(key.publicKey, 'docs', 'mirror');
    const refused = await firstSignedCall(key.file);
    expect(refused.status).toBe(403);
    expect(refused.json.code).toBe('forbidden');
    expect(String(refused.json.message)).toContain('mirror');
    expect(await signedSync(key.file)).toBe(1);
    expect(await boardOf()).toEqual([]);
  });
});
