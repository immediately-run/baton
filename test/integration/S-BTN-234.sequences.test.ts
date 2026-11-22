// S-BTN-234 Baton hands out the identifiers (BATON_SPEC §15 S-BTN-234, §4.3 R-BTN-199; B-176):
// every id a concurrent branch writes to git — a ticket id from any filer, a rule, scenario,
// gate or migration number — is one Baton's per-repository, per-kind sequence hands out, and
// `baton tickets new` files through a PR on `baton-ticket/<id>` by default. Must hold: two
// filers racing get distinct ids; a fresh Baton seeded by a floor never reissues a number git
// holds; an inflated floor is refused; `next` issues increasing numbers per repository and
// never across two; the principals that file tickets may take a number and a key granted
// nowhere may not; the kind is opaque and validated; each take is an event naming the caller
// and the ticket it is for; `new` opens a branch carrying the new ticket alone, and the ticket
// is not on the board until it merges — on a `git` forge the branch is pushed and printed
// (the unit half, beside this one, walks `--direct`'s protected fallback, the CLI's floor, the
// fallback and the reserved `branch_pattern`); no `branch_pattern` matches `baton-ticket/*`
// (R-BTN-190, the unit half). The CLI's half runs on the local host alone: it writes a real
// repository and runs git and the CLI.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Sequences } from '../../src/core/sequences';
import type { Row } from '../../src/core/ports';
import { call as hostCall, HOST } from '#host';
import { initMain, parseSyncArgs, syncMain } from '../../src/defaults/cli';
import { nextMain } from '../../src/defaults/sequences';
import { ticketsMain } from '../../src/defaults/tickets';
import { keyCall, makeApiKey, ORIGIN, rows, setAdminKeys, setClock, syncToken, TOKENS, withCore } from '../helpers';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';

const T0 = Date.parse('2026-11-13T12:00:00Z');
const CLI = resolve(import.meta.dirname, '..', '..', 'cli', 'baton.mjs');

let admin: TestKey;
let opsOwner: TestKey;
let granted: TestKey;
let stranger: TestKey;
let syncKey: TestKey;

/** A take, signed by `key` at the core's clock: `POST …/sequences/{kind}/next`. */
async function take(key: TestKey, repository: string, kind: string, body?: unknown) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const res = await hostCall(await signedRequest(key, `${ORIGIN}/v1/repositories/${repository}/sequences/${encodeURIComponent(kind)}/next`, {
    created, method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

/** An ed25519 key ssh-keygen makes: its private file is a file the CLI itself signs with. */
function keyPair(name: string): { file: string; publicKey: string } {
  const dir = mkdtempSync(join(tmpdir(), 'baton-s222-key-'));
  const file = join(dir, name);
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', name, '-f', file], { stdio: 'ignore' });
  return { file, publicKey: execFileSync('cat', [`${file}.pub`], { encoding: 'utf8' }).trim().split(' ').slice(0, 2).join(' ') };
}

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  opsOwner = await makeKey('ecdsa-sha2-nistp256', 'ops-owner');
  granted = await makeKey('ssh-ed25519', 'granted');
  stranger = await makeKey('ssh-ed25519', 'stranger');
  syncKey = await makeKey('ssh-ed25519', 'sync');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', {
    id: 'ops', github: 'immediately-run/ops', default_branch: 'main',
    sync_workflow: '.github/workflows/baton-sync.yml', mirror_workflow: '.github/workflows/baton-mirror.yml', owner_keys: [opsOwner.publicKey],
  })).status).toBe(200);
  expect((await keyCall(opsOwner, '/v1/owner/ops/grants', { public_key: granted.publicKey, hostname: 'granted-host', capabilities: ['agent-venue'] })).status).toBe(200);
  expect(await withCore((c) => c.registry.addSyncKey('ops', syncKey.publicKey, 'sync', 'admin:test', []))).toBeTruthy();
});

describe('S-BTN-234 Baton hands out the identifiers (B-176)', () => {
  it('reads the stored number inside the allocation transaction', async () => {
    await withCore((core) => {
      const store = core.store;
      let allocating = false;
      const sequences = new Sequences({ now: () => core.now(), store: {
        ...store,
        exec<T = Row>(query: string, ...params: unknown[]) {
          if (/^SELECT last_number FROM sequences\b/.test(query)) expect(allocating).toBe(true);
          return store.exec<T>(query, ...params);
        },
        transaction: (fn) => store.transaction(() => {
          allocating = true;
          try { return fn(); } finally { allocating = false; }
        }),
      } });
      expect(sequences.next('ops', 'migration', 40, 'test', null)).toEqual({ kind: 'migration', number: 41 });
      expect(sequences.next('ops', 'migration', null, 'test', null)).toEqual({ kind: 'migration', number: 42 });
    });
  });

  it('a retired repository hands out no number — not-found, as one never registered (R-BTN-47)', async () => {
    expect(await take(opsOwner, 'ops', 'ticket-b', { floor: 5 })).toMatchObject({ status: 200, json: { number: 6 } });
    expect((await keyCall(admin, '/v1/admin/repositories', { id: 'ops', retire: true, confirm: true })).status).toBe(200);
    // Every principal that could take one before, the administrator included: the sequence is a
    // repository's rule, and a retired repository has none.
    for (const key of [admin, opsOwner, granted, syncKey]) {
      expect((await take(key, 'ops', 'ticket-b')).json.number).toBeUndefined();
    }
    expect(await take(admin, 'ops', 'ticket-b')).toMatchObject({ status: 404, json: { code: 'not-found' } });
    expect(await rows('SELECT last_number FROM sequences WHERE repository_id = ? AND kind = ?', 'ops', 'ticket-b')).toEqual([{ last_number: 6 }]);
  });

  it('two filers racing get distinct ids; a floor seeds a fresh Baton above what git holds, and a number is never reissued', async () => {
    // A fresh Baton, seeded by the floor the filer read from git: the first number is above it.
    expect(await take(opsOwner, 'ops', 'ticket-b', { floor: 5 })).toMatchObject({ status: 200, json: { kind: 'ticket-b', number: 6 } });
    // The second filer's floor sees the same git: distinct, whatever order the requests land in.
    expect(await take(opsOwner, 'ops', 'ticket-b', { floor: 5 })).toMatchObject({ status: 200, json: { number: 7 } });
    // A floor below the stored number moves nothing: Baton's own count is the authority.
    expect(await take(opsOwner, 'ops', 'ticket-b', { floor: 2 })).toMatchObject({ status: 200, json: { number: 8 } });
    // A floor above it (a number only an open branch holds) is taken — lost state fails closed.
    expect(await take(opsOwner, 'ops', 'ticket-b', { floor: 9 })).toMatchObject({ status: 200, json: { number: 10 } });
    // Two takes at once, the race the sequence exists for: distinct numbers, whatever interleaves.
    const racing = await Promise.all([take(opsOwner, 'ops', 'ticket-b'), take(granted, 'ops', 'ticket-b')]);
    expect(new Set(racing.map((r) => r.json.number))).toEqual(new Set([11, 12]));
  });

  it('a floor more than 10 000 above the stored number is refused — gaps are harmless, and a bigger floor only burns numbers', async () => {
    const at = await take(opsOwner, 'ops', 'scenario', { floor: 100 });
    expect(at).toMatchObject({ status: 200, json: { number: 101 } });
    const cap = await take(opsOwner, 'ops', 'scenario', { floor: 101 + 10_001 });
    expect(cap).toMatchObject({ status: 400, json: { code: 'invalid-params' } });
    expect(cap.json.message).toContain('floor');
    // The cap itself (10 000 above) is the boundary, not a refusal.
    expect(await take(opsOwner, 'ops', 'scenario', { floor: 101 + 10_000 })).toMatchObject({ status: 200, json: { number: 10_102 } });
    // A floor that is not a non-negative integer is refused before any SQL (null is no floor).
    for (const bad of [-1, 1.5, '9']) {
      expect(await take(opsOwner, 'ops', 'rule', { floor: bad })).toMatchObject({ status: 400, json: { code: 'invalid-params' } });
    }
  });

  it('next scenario and next migration issue increasing numbers per repository, and never across two', async () => {
    for (const kind of ['scenario', 'migration']) {
      const first = await take(opsOwner, 'ops', kind, { floor: 47 });
      const second = await take(granted, 'ops', kind, { floor: 47 });
      expect(first.json.number).toEqual(second.json.number - 1);
    }
    // Another repository's sequence is its own: ops's takes moved nothing of docs's.
    expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [opsOwner.publicKey] })).status).toBe(200);
    expect(await take(opsOwner, 'docs', 'scenario', { floor: 47 })).toMatchObject({ status: 200, json: { number: 48 } });
    expect(await rows('SELECT repository_id, kind, last_number FROM sequences ORDER BY repository_id, kind')).toEqual([
      { repository_id: 'docs', kind: 'scenario', last_number: 48 },
      { repository_id: 'ops', kind: 'migration', last_number: 49 },
      { repository_id: 'ops', kind: 'scenario', last_number: 49 },
    ]);
  });

  it('the principals that file tickets may take a number; a key granted nowhere may not, and the kind is opaque and validated', async () => {
    // The owner's CLI, an administrator, a key granted on the repository (the runner role) and
    // the repository's sync key — the principals that file tickets today.
    expect(await take(opsOwner, 'ops', 'gate')).toMatchObject({ status: 200, json: { number: 1 } });
    expect(await take(admin, 'ops', 'gate')).toMatchObject({ status: 200, json: { number: 2 } });
    expect(await take(granted, 'ops', 'gate')).toMatchObject({ status: 200, json: { number: 3 } });
    expect(await take(syncKey, 'ops', 'gate')).toMatchObject({ status: 200, json: { number: 4 } });
    // A key Baton does not know is unauthenticated; owning another repository confers nothing
    // (R-BTN-58), and a key granted nowhere is refused, as on every repository route.
    expect(await take(stranger, 'ops', 'gate')).toMatchObject({ status: 401, json: { code: 'unauthenticated' } });
    expect(await take(opsOwner, 'docs', 'gate')).toMatchObject({ status: 403, json: { code: 'forbidden' } });
    // The kind is opaque to core — any shape it accepts is a sequence — and validated before
    // any SQL: not a kind, an uppercase one, an over-long one.
    for (const kind of ['Ticket-B', 'ticket/b', 'ticket_b', `${'t'.repeat(32)}x`]) {
      const res = await take(opsOwner, 'ops', kind);
      expect(res).toMatchObject({ status: 400, json: { code: 'invalid-params' } });
      expect(res.json.message).toContain('kind');
    }
    expect(await take(opsOwner, 'no-repository', 'rule')).toMatchObject({ status: 404, json: { code: 'not-found' } });
    // An unknown field is refused; `for` is a local ticket id.
    expect(await take(opsOwner, 'ops', 'rule', { number: 9 })).toMatchObject({ status: 400, json: { code: 'invalid-params' } });
    expect(await take(opsOwner, 'ops', 'rule', { for: 'not an id' })).toMatchObject({ status: 400, json: { code: 'invalid-params' } });
  });

  it('a runner bearer token takes a number only where R-BTN-58 grants it — the bearer path checks the grant as the signed one does', async () => {
    // The transition's live-runner bearer (front.ts's verifyRunner): no signature, no API key,
    // the credential the token hashes name. Round 1, finding 1: this take was 200 whatever
    // the grants said, and its event logged a bare `runner` naming no caller.
    const bearerTake = () => hostCall(new Request(`${ORIGIN}/v1/repositories/ops/sequences/ticket-b/next`, {
      method: 'POST', headers: { Authorization: `Bearer ${TOKENS['vm-a']}`, 'Content-Type': 'application/json' }, body: '{}',
    }));
    const refused = await bearerTake();
    expect(refused.status).toBe(403);
    expect(await (refused.json() as Promise<Record<string, any>>)).toMatchObject({ code: 'forbidden' });
    expect(await rows('SELECT 1 FROM sequences')).toEqual([]);
    expect(await rows(`SELECT 1 FROM events WHERE kind = 'sequence'`)).toEqual([]);
    // A delegated bearer — an API key the owner granted on the repository (R-BTN-159; B-124's
    // MCP keys will ride the same rule once they exist) — takes a number: a number is not
    // authority, and issuing one more than needed only leaves a gap.
    const delegated = await makeApiKey('delegated');
    expect((await keyCall(opsOwner, '/v1/owner/ops/grants', { public_key: delegated.line, hostname: 'delegated-host', capabilities: ['agent-venue'] })).status).toBe(200);
    const took = await hostCall(new Request(`${ORIGIN}/v1/repositories/ops/sequences/ticket-b/next`, {
      method: 'POST', headers: { Authorization: `Bearer ${delegated.key}`, 'Content-Type': 'application/json' }, body: '{}',
    }));
    expect(took.status).toBe(200);
    expect(await (took.json() as Promise<Record<string, any>>)).toMatchObject({ kind: 'ticket-b', number: 1 });
    const events = await rows<{ actor: string; detail: string }>(`SELECT actor, detail_json AS detail FROM events WHERE kind = 'sequence'`);
    expect(events).toEqual([{ actor: `runner:${delegated.fingerprint}`, detail: JSON.stringify({ kind: 'ticket-b', number: 1 }) }]);
  });

  it('a body that is not JSON is refused, and a refused floor leaves its trace in the log', async () => {
    // An empty body legitimately carries neither field; garbage is the caller's error, never
    // "no floor, no for" that still takes a number (round 1, nit 2).
    const delegated = await makeApiKey('garbage');
    expect((await keyCall(opsOwner, '/v1/owner/ops/grants', { public_key: delegated.line, hostname: 'garbage-host', capabilities: ['agent-venue'] })).status).toBe(200);
    const raw = (body: string) => hostCall(new Request(`${ORIGIN}/v1/repositories/ops/sequences/rule/next`, {
      method: 'POST', headers: { Authorization: `Bearer ${delegated.key}`, 'Content-Type': 'application/json' }, body,
    }));
    expect((await raw('')).status).toBe(200);
    expect((await raw('not json at all')).status).toBe(400);
    expect(await rows('SELECT last_number FROM sequences WHERE kind = ?', 'rule')).toEqual([{ last_number: 1 }]);
    // The refused floor is logged — refused, with no number — and nothing was issued (round 1,
    // should-fix 2).
    const cap = await take(opsOwner, 'ops', 'rule', { floor: 1 + 10_001 });
    expect(cap).toMatchObject({ status: 400, json: { code: 'invalid-params' } });
    expect(await rows<{ detail: string }>(`SELECT detail_json AS detail FROM events WHERE kind = 'sequence' ORDER BY seq`))
      .toEqual([{ detail: JSON.stringify({ kind: 'rule', number: 1 }) }, { detail: JSON.stringify({ kind: 'rule', floor: 10_002, refused: 'floor-cap' }) }]);
    expect(await rows('SELECT last_number FROM sequences WHERE kind = ?', 'rule')).toEqual([{ last_number: 1 }]);
  });

  it('each take is an event naming the caller and, when given, the ticket it is for', async () => {
    expect(await take(granted, 'ops', 'ticket-b', { floor: 3, for: 'B-9' })).toMatchObject({ status: 200, json: { number: 4 } });
    expect(await take(opsOwner, 'ops', 'ticket-b')).toMatchObject({ status: 200, json: { number: 5 } });
    const events = await rows<{ kind: string; actor: string; ticket_id: string | null; repository_id: string; detail: string }>(
      `SELECT kind, actor, ticket_id, repository_id, detail_json AS detail FROM events WHERE kind = 'sequence' ORDER BY seq`);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ kind: 'sequence', actor: `runner:${granted.fingerprint}`, ticket_id: 'ops:B-9', repository_id: 'ops' });
    expect(JSON.parse(events[0].detail)).toEqual({ kind: 'ticket-b', number: 4, floor: 3 });
    expect(events[1]).toMatchObject({ kind: 'sequence', actor: `owner:${opsOwner.fingerprint}`, ticket_id: null, repository_id: 'ops' });
    expect(JSON.parse(events[1].detail)).toEqual({ kind: 'ticket-b', number: 5 });
  });
});

/** A checkout whose origin is a bare repository — a `git` forge — with `.baton/` as
 *  `baton repo init` writes it, its `repos` map naming the bare path as `ops`, committed. */
class Repo {
  readonly dir = mkdtempSync(join(tmpdir(), 'baton-s222-'));
  readonly bare = mkdtempSync(join(tmpdir(), 'baton-s222-origin-'));
  constructor() {
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', this.bare], { stdio: 'ignore' });
    for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 's222@test'], ['config', 'user.name', 's222'], ['remote', 'add', 'origin', this.bare]]) {
      execFileSync('git', ['-C', this.dir, ...a], { stdio: 'ignore' });
    }
    mkdirSync(join(this.dir, 'tickets'), { recursive: true });
  }
  git(...a: string[]): string {
    return execFileSync('git', ['-C', this.dir, ...a], { encoding: 'utf8' }).trim();
  }
  publish(): void {
    this.git('add', '-A');
    this.git('commit', '-qm', 'scaffold');
    this.git('push', '-q', 'origin', 'HEAD:main');
  }
  /** `baton tickets new` in-process, its fetch routed into the harness's host — the CLI's own
   *  code, the real core answering (S-BTN-199's pattern: the local host serves no port). The
   *  core's clock moves to the real now first: the CLI signs at its own clock (R-BTN-32 is
   *  Baton's rule, not a laptop's). */
  async tickets(...argv: string[]): Promise<{ code: number; out: string[]; err: string[] }> {
    await setClock(Date.now());
    const out: string[] = [];
    const err: string[] = [];
    const fetchImpl: typeof fetch = (input, init) => hostCall(new Request(input, init));
    const code = await ticketsMain(argv, { root: this.dir, log: (l) => out.push(l), warn: (l) => err.push(l), fetchImpl });
    return { code, out, err };
  }
  /** The sync as the workflow runs it: a checkout of the default branch, the harness's credential. */
  async sync(): Promise<void> {
    this.git('fetch', '-q', 'origin');
    this.git('checkout', '-q', '--detach', 'origin/main');
    const facts = join(this.dir, '.baton', 'facts.json');
    writeFileSync(facts, '[]');
    const token = await syncToken({ repository: 'immediately-run/ops', job_workflow_ref: 'immediately-run/ops/.github/workflows/baton-sync.yml@refs/heads/main' });
    const args = parseSyncArgs(['--root', this.dir, '--url', ORIGIN, '--facts', facts], {});
    const log: string[] = [];
    const code = await syncMain({ ...args, auth: () => ({ Authorization: `Bearer ${token}` }), transport: (req) => hostCall(req), log: (l) => log.push(l) });
    if (code !== 0) throw new Error(`sync exited ${code}: ${log.join('\n')}`);
  }
}

let repo: Repo | null;
let minutes = 0;
/** Each sync takes an observation number; the next is refused until ten minutes pass (R-BTN-62). */
const later = () => setClock(T0 + (minutes += 11) * 60_000);
/** The runtime guard of S-BTN-175's: mkdtemp throws on the Workers runtime's `node:fs` stub. */
const onNode = (): Repo | null => {
  try {
    return new Repo();
  } catch {
    return null;
  }
};
let keyFile: string;
beforeEach(async () => {
  minutes = 0;
  repo = HOST === 'local' ? onNode() : null;
  if (repo != null) {
    const pair = keyPair('owner');
    keyFile = pair.file;
    // The CLI's key is an owner of `ops`: the principal a filer's own key is.
    expect((await keyCall(admin, '/v1/admin/repositories', { id: 'ops', owner_keys_add: [pair.publicKey] })).status).toBe(200);
  }
});
afterEach(() => {
  if (!repo) return;
  rmSync(repo.dir, { recursive: true, force: true });
  rmSync(repo.bare, { recursive: true, force: true });
});

describe('S-BTN-234 the CLI half: new asks Baton first and files through a PR (B-176)', () => {
  it.runIf(HOST === 'local')('new takes its id from the sequence and files the ticket alone on baton-ticket/<id>; the ticket boards only when the branch merges', async () => {
    if (repo === null) return;
    expect(await initMain(['--course', 'create-pr'], { root: repo.dir, log: () => {} })).toBe(0);
    // The repos map names this checkout's bare origin as `ops`, so the CLI's asks reach it; a
    // `kind: project` page is what `--project` names.
    const settings = JSON.parse(execFileSync('cat', [join(repo.dir, '.baton', 'baton.json')], { encoding: 'utf8' })) as Record<string, unknown>;
    settings.repos = { ops: repo.bare };
    writeFileSync(join(repo.dir, '.baton', 'baton.json'), `${JSON.stringify(settings, null, 2)}\n`);
    mkdirSync(join(repo.dir, 'tickets', 'projects'), { recursive: true });
    writeFileSync(join(repo.dir, 'tickets', 'projects', 'baton.mdx'), '---\ntitle: baton\nid: baton\nstatus: active\nkind: project\ntags:\n  - project\ndescription: the project\n---\n\nProse.\n');
    repo.publish();
    const before = repo.git('rev-parse', 'HEAD');

    const filed = await repo.tickets('new', '--title', 'First', '--project', 'baton', '-i', keyFile, '--url', ORIGIN);
    if (filed.code !== 0 || filed.err.length) throw new Error(`new exited ${filed.code}: ${filed.err.join('\n')}`);
    // The git forge has no PR to ask for: the branch is the answer, printed for a person to merge.
    expect(filed.out).toEqual(['✓ tickets: file B-1 — First', '  branch: baton-ticket/B-1 — pushed for a person to merge']);
    // The default branch is exactly as it was, and the filing branch carries the ticket alone.
    expect(execFileSync('git', ['-C', repo.bare, 'rev-parse', 'main'], { encoding: 'utf8' }).trim()).toBe(before);
    expect(execFileSync('git', ['-C', repo.bare, 'show', '--name-only', '--format=%s', 'baton-ticket/B-1'], { encoding: 'utf8' }).trim().split('\n'))
      .toEqual(['tickets: file B-1 — First', '', 'tickets/B-1.mdx']);
    // The id came from Baton's sequence, floor 0 on a fresh repository: number 1.
    expect(await rows('SELECT repository_id, kind, last_number FROM sequences')).toEqual([{ repository_id: 'ops', kind: 'ticket-b', last_number: 1 }]);

    // The ticket is not on the board while it lives only on the filing branch (the project
    // page beside it is; a page is not the ticket).
    await later();
    await repo.sync();
    expect((await rows('SELECT id FROM tickets')).map((r) => r.id)).not.toContain('ops:B-1');

    // A person merges the branch; the next sync boards the ticket at its course's start.
    execFileSync('git', ['-C', repo.dir, 'fetch', '-q', 'origin'], { stdio: 'ignore' });
    execFileSync('git', ['-C', repo.dir, 'merge', '-q', '--no-ff', '-m', 'merge the filing', 'origin/baton-ticket/B-1'], { stdio: 'ignore' });
    execFileSync('git', ['-C', repo.dir, 'push', '-q', 'origin', 'HEAD:main'], { stdio: 'ignore' });
    await later();
    await repo.sync();
    expect(await rows('SELECT id, course_id FROM tickets WHERE id = ?', 'ops:B-1')).toEqual([{ id: 'ops:B-1', course_id: 'create-pr' }]);
  }, 120_000);

  it.runIf(HOST === 'local')('baton tickets next takes its number from the real core, with the floor this checkout sees', async () => {
    if (repo === null) return;
    expect(await initMain(['--course', 'create-pr'], { root: repo.dir, log: () => {} })).toBe(0);
    const settings = JSON.parse(execFileSync('cat', [join(repo.dir, '.baton', 'baton.json')], { encoding: 'utf8' })) as Record<string, unknown>;
    settings.repos = { ops: repo.bare };
    writeFileSync(join(repo.dir, '.baton', 'baton.json'), `${JSON.stringify(settings, null, 2)}\n`);
    mkdirSync(join(repo.dir, 'tickets', 'projects'), { recursive: true });
    writeFileSync(join(repo.dir, 'tickets', 'projects', 'baton.mdx'), '---\ntitle: baton\nid: baton\nstatus: active\nkind: project\ntags:\n  - project\ndescription: the project\n---\n\nProse.\n');
    repo.publish();
    // A peer's filing branch holds B-3: the floor reads it (the unit half walks the kinds; this
    // walk is the CLI against the real core).
    execFileSync('git', ['-C', repo.dir, 'checkout', '-q', '-b', 'peer'], { stdio: 'ignore' });
    writeFileSync(join(repo.dir, 'tickets', 'B-3.mdx'), '---\ntitle: "B-3 — t"\nid: B-3\nstatus: available\ntags: [roadmap-item]\n---\n\nBody.\n');
    execFileSync('git', ['-C', repo.dir, 'add', '-A'], { stdio: 'ignore' });
    execFileSync('git', ['-C', repo.dir, 'commit', '-qm', 'peer files B-3'], { stdio: 'ignore' });
    execFileSync('git', ['-C', repo.dir, 'push', '-q', 'origin', 'HEAD:refs/heads/baton-ticket/B-3'], { stdio: 'ignore' });
    execFileSync('git', ['-C', repo.dir, 'checkout', '-q', 'main'], { stdio: 'ignore' });

    await setClock(Date.now());
    const out: string[] = [];
    const err: string[] = [];
    const code = await nextMain(['ticket', '-i', keyFile, '--url', ORIGIN], {
      root: repo.dir, log: (l) => out.push(l), warn: (l) => err.push(l), fetchImpl: (input, init) => hostCall(new Request(input, init)),
    });
    expect(code).toBe(0);
    expect(err).toEqual([]);
    // The floor saw the open branch's B-3; Baton's answer is above it.
    expect(out).toEqual(["✓ ticket-b: B-4 (Baton's sequence, floor 3)"]);
    expect(await rows('SELECT repository_id, kind, last_number FROM sequences')).toEqual([{ repository_id: 'ops', kind: 'ticket-b', last_number: 4 }]);
    const events = await rows<{ actor: string; detail: string }>(`SELECT actor, detail_json AS detail FROM events WHERE kind = 'sequence'`);
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].detail)).toEqual({ kind: 'ticket-b', number: 4, floor: 3 });
    expect(events[0].actor).toMatch(/^owner:/);
  }, 120_000);

  it.runIf(HOST === 'local')('two concurrent baton tickets new runs against one Baton file two distinct ids', async () => {
    if (repo === null) return;
    expect(await initMain(['--course', 'create-pr'], { root: repo.dir, log: () => {} })).toBe(0);
    const settings = JSON.parse(execFileSync('cat', [join(repo.dir, '.baton', 'baton.json')], { encoding: 'utf8' })) as Record<string, unknown>;
    settings.repos = { ops: repo.bare };
    writeFileSync(join(repo.dir, '.baton', 'baton.json'), `${JSON.stringify(settings, null, 2)}\n`);
    mkdirSync(join(repo.dir, 'tickets', 'projects'), { recursive: true });
    writeFileSync(join(repo.dir, 'tickets', 'projects', 'baton.mdx'), '---\ntitle: baton\nid: baton\nstatus: active\nkind: project\ntags:\n  - project\ndescription: the project\n---\n\nProse.\n');
    repo.publish();
    // Two filings at once, the race the sequence exists for: two ids, two branches.
    const both = await Promise.all([
      repo.tickets('new', '--title', 'One', '--project', 'baton', '-i', keyFile, '--url', ORIGIN),
      repo.tickets('new', '--title', 'Two', '--project', 'baton', '-i', keyFile, '--url', ORIGIN),
    ]);
    for (const r of both) {
      if (r.code !== 0 || r.err.length) throw new Error(`new exited ${r.code}: ${r.err.join('\n')}`);
    }
    const branches = execFileSync('git', ['-C', repo.bare, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/baton-ticket/*'], { encoding: 'utf8' }).trim().split('\n').sort();
    expect(branches).toEqual(['baton-ticket/B-1', 'baton-ticket/B-2']);
    expect(await rows('SELECT repository_id, kind, last_number FROM sequences')).toEqual([{ repository_id: 'ops', kind: 'ticket-b', last_number: 2 }]);
  }, 120_000);
});
