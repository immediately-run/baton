// cli.test.ts — `baton admin …` / `baton owner …` (R3-1240; BATON_SPEC §10.6, R-BTN-57/-58,
// R-BTN-66/-67): each command's one request (`plan`, pure), and a request signed with a real key
// file by `ssh-keygen -Y sign` that Baton's verifier accepts. Node only: it runs ssh-keygen.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApiKey, duration, parseArgs, plan, send } from '../../cli/baton.mjs';
import { formatDecision, listOnce, plain, watch, WATCH_EVERY_MS } from '../../cli/decisions.mjs';
import { ORIGIN, setAdminKeys, setClock } from '../helpers';
import type { TestKey } from '../lib/sshKeys';
import { call as hostCall } from '#host';

const PUB = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOwner';
const key = (p: string) => p;

describe('plan: one request per command', () => {
  it('admin commands', () => {
    expect(plan('admin', ['repo', 'add', 'immediately-run/ops', '--id', 'ops', '--owner-key', PUB, '--weight', '2', '--tiers', 'routine,critical', '--cut-over'], key)).toEqual({
      method: 'POST', path: '/v1/admin/repositories',
      body: { id: 'ops', github: 'immediately-run/ops', default_branch: 'main', weight: 2, tiers: ['routine', 'critical'], cut_over: true, owner_keys: [PUB] },
    });
    expect(plan('admin', ['repo', 'retire', 'ops'], key)).toEqual({ method: 'POST', path: '/v1/admin/repositories', body: { id: 'ops', retire: true } });
    expect(plan('admin', ['grant', 'docs', '--key', PUB, '--hostname', 'h', '--capabilities', 'human-operator'], key).body)
      .toEqual({ repository: 'docs', public_key: PUB, hostname: 'h', capabilities: ['human-operator'] });
    expect(plan('admin', ['revoke', 'SHA256:a/b'], key).path).toBe('/v1/admin/keys/SHA256%3Aa%2Fb/revoke');
    expect(plan('admin', ['open'], key)).toEqual({ method: 'POST', path: '/v1/admin/login-links', body: {} });
    expect(() => plan('admin', ['repo', 'add', 'x/y'], key)).toThrow('--owner-key is required');
  });

  it('owner commands, the required bars in their groups', () => {
    expect(plan('owner', ['grant', 'docs', '--key', PUB, '--capabilities', 'agent-venue', '--max-tier', 'routine'], key))
      .toEqual({ method: 'POST', path: '/v1/owner/docs/grants', body: { public_key: PUB, capabilities: ['agent-venue'], max_tier: 'routine' } });
    expect(plan('owner', ['owners', 'docs', '--remove', 'SHA256:x'], key).body).toEqual({ fingerprint: 'SHA256:x', remove: true });
    expect(plan('owner', ['bar', 'docs', '--course', '*', '--tag', 'account:go_plus', '--applies', 'claim', '--starts-at', '2026-10-16T13:00:00Z', '--reason', 'go-quota', '--release-holders'], key).body)
      .toEqual({ course: '*', tag: 'account:go_plus', applies: 'claim', starts_at: Date.parse('2026-10-16T13:00:00Z'), release_holders: true, reason: 'go-quota' });
    expect(plan('owner', ['bar', 'lift', 'docs', '7'], key).path).toBe('/v1/owner/docs/bars/7/lift');
    expect(plan('owner', ['settings', 'docs', '--required-bar', '*', '--course', 'roadmap-pr', '--except', 'implement,review', '--tag-prefix', 'family:',
      '--required-bar', 'merge', '--course', 'roadmap-pr', '--tag-prefix', 'account:', '--retry', '1h,4h', '--max-failed', '3'], key)).toEqual({
      method: 'PUT', path: '/v1/owner/docs/settings', body: {
        required_bars: [{ course: 'roadmap-pr', leg: '*', except: ['implement', 'review'], tag_prefix: 'family:' }, { course: 'roadmap-pr', leg: 'merge', tag_prefix: 'account:' }],
        retry: { backoff_ms: [3_600_000, 14_400_000], max_failed: 3 },
      } });
    expect(plan('owner', ['settings', 'docs', '--no-required-bars', '--retry', 'default', '--unblocked-workflow', 'none'], key).body)
      .toEqual({ required_bars: [], retry: null, unblocked_trigger: null });
    expect(plan('owner', ['settings', 'docs', '--unblocked-workflow', '.github/workflows/unblocked.yml'], key).body)
      .toEqual({ unblocked_trigger: { kind: 'github-app', workflow: '.github/workflows/unblocked.yml' } });
    expect(() => plan('owner', ['settings', 'docs', '--no-required-bars', '--required-bar', '*', '--course', 'c', '--tag-prefix', 'p'], key)).toThrow('clears them');
    expect(() => plan('owner', ['settings', 'docs'], key)).toThrow('at least one setting');
    // R-BTN-80: remind_after in seconds, from a duration.
    expect(plan('owner', ['settings', 'docs', '--remind-after', '6h'], key).body).toEqual({ remind_after: 21_600 });
  });

  it('owner resolve and ticket history (R-BTN-78, R-BTN-81)', () => {
    expect(plan('owner', ['resolve', 'docs', 'R3-1', 'baton:retries', 'retry'], key))
      .toEqual({ method: 'POST', path: '/v1/owner/docs/tickets/docs%3AR3-1/resolve', body: { decision: 'baton:retries', answer: 'retry' } });
    expect(plan('owner', ['resolve', 'docs', 'docs:R3-1', 'baton:stalled', 'park'], key).path).toBe('/v1/owner/docs/tickets/docs%3AR3-1/resolve');
    expect(() => plan('owner', ['resolve', 'docs', 'R3-1', 'baton:retries'], key)).toThrow('the answer (retry or park) is required');
    expect(() => plan('owner', ['resolve', 'docs', 'R3-1', 'baton:retries', 'retry', 'extra'], key)).toThrow('no further argument');
    expect(plan('ticket', ['history', 'docs:R3-1'], key)).toEqual({ method: 'GET', path: '/v1/repositories/docs/tickets/R3-1/history' });
    expect(plan('ticket', ['history', 'docs:R3-1', '--before', '40', '--limit', '20'], key).path).toBe('/v1/repositories/docs/tickets/R3-1/history?before=40&limit=20');
    expect(() => plan('ticket', ['history', 'R3-1'], key)).toThrow('<repository>:<id>');
    expect(() => plan('ticket', ['show', 'docs:R3-1'], key)).toThrow('baton ticket history');
  });

  it('owner courier commands (R-BTN-80)', () => {
    expect(plan('owner', ['courier', 'add', 'docs', '--key', PUB, '--asks', 'owner,legal'], key))
      .toEqual({ method: 'POST', path: '/v1/owner/docs/couriers', body: { public_key: PUB, asks: ['owner', 'legal'] } });
    expect(plan('owner', ['courier', 'revoke', 'docs', 'SHA256:abc'], key))
      .toEqual({ method: 'POST', path: '/v1/owner/docs/couriers', body: { fingerprint: 'SHA256:abc', revoke: true } });
    expect(() => plan('owner', ['courier', 'add', 'docs', '--key', PUB], key)).toThrow('--asks is required');
    expect(() => plan('owner', ['courier', 'revoke', 'docs'], key)).toThrow('the key fingerprint is required');
    expect(() => plan('owner', ['courier', 'add', 'docs', '--key', PUB, '--asks', 'owner', '--severity', 'high'], key)).toThrow('not a flag');
    expect(() => plan('owner', ['bar', 'docs', '--course', '*', '--tag', 't', '--applies', 'claim', '--starts-at', 'soon', '--reason', 'r'], key)).toThrow('not a date');
  });

  it('repo add and set take §11’s whole forms; an unknown or misspelled flag is refused (round 3)', () => {
    expect(plan('admin', ['repo', 'add', 'immediately-run/Docs', '--owner-key', `${PUB},${PUB}2`], key).body).toMatchObject({ id: 'docs', github: 'immediately-run/Docs', owner_keys: [PUB, `${PUB}2`] });
    expect(plan('admin', ['repo', 'add', 'group/sub/proj', '--forge', 'gitlab', '--web-base', 'https://gitlab.example.com/group/sub/proj', '--remote', 'https://gitlab.example.com/group/sub/proj.git',
      '--ci-identity', 'gitlab:https://gitlab.example.com', '--mirror-key', PUB, '--owner-key', PUB], key).body).toEqual({
      id: 'proj', github: 'group/sub/proj', default_branch: 'main', forge: 'gitlab', remote: 'https://gitlab.example.com/group/sub/proj.git', web_base: 'https://gitlab.example.com/group/sub/proj',
      ci_identity: { kind: 'gitlab-ci', issuer: 'https://gitlab.example.com', mirror: false }, sync_keys: [{ public_key: PUB, role: 'mirror' }], owner_keys: [PUB],
    });
    expect(plan('admin', ['repo', 'add', 'o/r', '--sync-key', PUB, '--owner-key', PUB], key).body.sync_keys).toEqual([{ public_key: PUB, role: 'sync' }]);
    expect(plan('admin', ['repo', 'set', 'docs', '--remote', 'git@github.com:o/r.git', '--sync-workflow', 'none', '--ci-identity', 'none', '--add-owner-key', PUB,
      '--add-sync-key', PUB, '--remove-sync-key', 'SHA256:x'], key).body).toEqual({
      id: 'docs', remote: 'git@github.com:o/r.git', sync_workflow: null, ci_identity: null, owner_keys_add: [PUB], sync_keys_add: [{ public_key: PUB, role: 'sync' }], sync_keys_remove: ['SHA256:x'],
    });
    expect(() => plan('admin', ['repo', 'set', 'docs'], key)).toThrow('at least one change');
    expect(() => plan('admin', ['repo', 'set', 'docs', '--remot', 'x'], key)).toThrow('--remot: not a flag');
    expect(() => plan('owner', ['grant', 'docs', '--key', PUB, '--capabilites', 'agent-venue'], key)).toThrow('--capabilites: not a flag');
    expect(() => plan('admin', ['open', '--force', 'yes'], key)).toThrow('not a flag');
    // Adjudicated: one dash, a typographic dash and a stray positional are refused too.
    expect(() => plan('admin', ['grant', 'docs', '--key', PUB, '-capabilities', 'a,b'], key)).toThrow('-capabilities: not a flag');
    expect(() => plan('admin', ['repo', 'set', 'docs', '--weight', '2', '\u2014tiers', 'a,b'], key)).toThrow('not a flag');
    expect(() => plan('admin', ['repo', 'add', 'o/Docs', '--owner-key', PUB, '-cut-over'], key)).toThrow('not a flag');
    expect(() => plan('owner', ['grant', 'docs', 'extra', '--key', PUB], key)).toThrow('extra: this command takes no further argument');
    expect(() => plan('admin', ['repo', 'set', 'docs', 'stray', '--weight', '2'], key)).toThrow('stray: this command takes no further argument');
    expect(() => plan('admin', ['repo', 'add', 'o/r', '--owner-key', PUB, '--ci-identity', 'circle'], key)).toThrow('--ci-identity');
  });

  it('resources, instances, a reading by hand, and the blocks queries (R3-1251)', () => {
    expect(plan('admin', ['resource', 'add', 'llm:x', '--scope', 'account', '--schema', 'schema.json'], key, () => '{"type":"object"}')).toEqual({
      method: 'POST', path: '/v1/admin/resources', body: { name: 'llm:x', scope: 'account', detail_schema: { type: 'object' } } });
    expect(plan('admin', ['instance', 'add', 'opencode-go:go_plus', '--serves', 'llm:x,llm:y', '--repositories', 'docs'], key)).toEqual({
      method: 'POST', path: '/v1/admin/instances', body: { name: 'opencode-go:go_plus', serves: ['llm:x', 'llm:y'], repositories: ['docs'] } });
    expect(plan('admin', ['resource', 'set', 'opencode-go:go_plus', '--unavailable', '--until', '2026-10-17T12:00:00Z', '--valid-for', '2h', '--detail', '{"used":3}'], key)).toEqual({
      method: 'POST', path: '/v1/admin/readings',
      body: { readings: [{ instance: 'opencode-go:go_plus', available: false, until: Date.parse('2026-10-17T12:00:00Z'), valid_for: 7200, detail: { used: 3 } }] } });
    expect(() => plan('admin', ['resource', 'set', 'i', '--available', '--unavailable'], key)).toThrow(/one of --available or --unavailable/);
    expect(() => plan('admin', ['resource', 'set', 'i', '--available', '--until', '2026-10-17T12:00:00Z'], key)).toThrow(/--unavailable/);
    expect(plan('blocked', ['docs:R3-1205'])).toEqual({ method: 'GET', path: '/v1/repositories/docs/tickets/R3-1205/blocks' });
    expect(plan('blocked', ['--repository', 'docs', '--on', 'decision:*'])).toEqual({ method: 'GET', path: '/v1/repositories/docs/blocked?on=decision%3A*' });
    expect(() => plan('blocked', ['R3-1205'])).toThrow(/<repository>:<id>/);
    expect(() => plan('blocked', ['--on', 'resource:x'])).toThrow(/--repository/);
  });

  it('parseArgs and duration', () => {
    expect(parseArgs(['a', '--x', '1', '--flag'], ['flag'])).toEqual({ flags: { x: '1', flag: true }, positional: ['a'], groups: [] });
    expect(() => parseArgs(['--x'])).toThrow('needs a value');
    expect(duration('30m')).toBe(1_800_000);
    expect(() => duration('1w')).toThrow();
  });
});

describe('send: signed with a key file, verified by Baton', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'baton-cli-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('an administrator’s key file signs a request Baton accepts; another key is unauthenticated', async () => {
    const file = join(dir, 'admin');
    expect(spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', file]).status).toBe(0);
    const other = join(dir, 'other');
    spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', other]);
    // ssh-keygen signs at the wall clock: Baton's clock is set to it.
    await setClock(Date.now());
    await setAdminKeys({ publicKey: readFileSync(`${file}.pub`, 'utf8').trim() } as TestKey);
    const fetchImpl = (url: string, init: RequestInit) => hostCall(new Request(url, init));
    const ok = await send(ORIGIN, plan('admin', ['open']), file, fetchImpl);
    expect(ok.status).toBe(200);
    expect(ok.json.url).toMatch(/\/login#[0-9a-f]{64}$/);
    expect(await send(ORIGIN, plan('admin', ['open']), other, fetchImpl)).toMatchObject({ status: 401, json: { code: 'unauthenticated' } });
  });

  it('baton key create makes an API key whose file -i sends as a bearer Baton accepts (R-BTN-159)', async () => {
    const file = join(dir, 'admin.key');
    const line = createApiKey(file, 'admin');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(`${file}.pub`, 'utf8').trim()).toBe(line);
    expect(line).toMatch(/^bak_[0-9a-f]{16} sha256:[0-9a-f]{64} admin$/);
    // Never over an existing key.
    expect(() => createApiKey(file)).toThrow('already exists');
    await setClock(Date.now());
    await setAdminKeys(line);
    const fetchImpl = (url: string, init: RequestInit) => hostCall(new Request(url, init));
    const ok = await send(ORIGIN, plan('admin', ['open']), file, fetchImpl);
    expect(ok.status).toBe(200);
    // The owner-key flag reads the public line from its file, as it reads an SSH public key.
    expect(plan('admin', ['repo', 'add', 'o/r', '--owner-key', `${file}.pub`]).body.owner_keys).toEqual([line]);
  });
});

describe('baton test-course: the command (R3-1248)', () => {
  it('exits 0 on a sound course and 1 naming each violation, needing no Baton or key', () => {
    const root = mkdtempSync(join(tmpdir(), 'baton-cli-kit-'));
    try {
      const course = JSON.parse(readFileSync(join(import.meta.dirname, '../fixtures/courses/roadmap-pr/course.json'), 'utf8'));
      const dir = join(root, '.baton/courses/roadmap-pr');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'course.json'), JSON.stringify(course));
      const run = (...more: string[]) => spawnSync('node', [join(import.meta.dirname, '../../cli/baton.mjs'), 'test-course', root, 'roadmap-pr', ...more], { encoding: 'utf8', env: { ...process.env, BATON_URL: 'http://127.0.0.1:1' } });
      // no base resolves: an error naming --base, never a silent skip of the removal rule (round 1, 1-A-3)
      const nobase = run();
      expect([nobase.status, nobase.stderr]).toEqual([2, expect.stringContaining('pass --base REF')]);
      expect(run('--base', 'HAED').stderr).toContain('--base HAED: not a commit');
      const run2 = () => run('--base', 'none');
      const ok = run2();
      expect([ok.status, ok.stdout]).toEqual([0, expect.stringContaining('✓ no violations')]);
      expect(ok.stdout).toContain('with --base none (the removal rule is not checked)');
      expect(ok.stdout).toContain('no --board (live tickets not replayed)');
      mkdirSync(join(dir, 'legs'));
      writeFileSync(join(dir, 'legs/deploy.mjs'), '');
      const bad = run2();
      expect(bad.status).toBe(1);
      expect(bad.stdout).toContain('✗ legs-scripts: legs/deploy.mjs is no leg of the course');
      const usage = spawnSync('node', [join(import.meta.dirname, '../../cli/baton.mjs'), 'test-course', root], { encoding: 'utf8' });
      expect([usage.status, usage.stderr]).toEqual([2, expect.stringContaining('usage: baton test-course')]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});

describe('baton decision list: the CLI courier (R-BTN-80)', () => {
  const notice = (id: string, title: string, url?: string) => ({ notice_id: id, kind: 'decision', repository: 'docs', ticket: `docs:${id}`, title,
    decision: { id: `${id}-1`, asks: 'owner', ...(url ? { url } : {}) }, unblocks: [`docs:${id}`], created_at: 1 });

  it('prints control characters as U+FFFD, never as terminal instructions', () => {
    expect(plain('a\u001b]0;pwned\u0007b\nc\u2028d\u009be')).toBe('a\uFFFD]0;pwned\uFFFDb\uFFFDc\uFFFDd\uFFFDe');
    expect(formatDecision({ ticket: 'docs:E', title: 'Ship \u001b[31mit', decision: { id: 'E-1', asks: 'owner' } }))
      .toBe('docs:E — Ship \uFFFD[31mit\n  decision E-1 (asks owner)');
  });

  it('claims, prints each, then marks it sent; an answered one is no error; another refusal is', async () => {
    const calls: [string, string, unknown][] = [];
    const out: string[] = [];
    const replies: Record<string, { status: number; json: Record<string, unknown> }> = {
      'POST /v1/courier/notices/claim': { status: 200, json: { notices: [notice('A', 'First', 'https://github.com/o/r/pull/1'), notice('B', 'Second')] } },
      'POST /v1/courier/notices/A': { status: 200, json: { ok: true } },
      'POST /v1/courier/notices/B': { status: 409, json: { ok: false, code: 'closed', message: 'answered' } },
    };
    const request = async (method: string, path: string, body?: unknown) => {
      calls.push([method, path, body]);
      // Each notice is written before it is marked.
      if (path.endsWith('/A') && calls.length === 2) expect(out).toHaveLength(1);
      return replies[`${method} ${path}`];
    };
    expect(await listOnce(request, (t: string) => out.push(t))).toBe(2);
    expect(out).toEqual(['docs:A — First\n  decision A-1 (asks owner)\n  https://github.com/o/r/pull/1', 'docs:B — Second\n  decision B-1 (asks owner)']);
    expect(calls.map(([m, p, b]) => [m, p, b])).toEqual([
      ['POST', '/v1/courier/notices/claim', {}],
      ['POST', '/v1/courier/notices/A', { state: 'sent', channel: 'cli' }],
      ['POST', '/v1/courier/notices/B', { state: 'sent', channel: 'cli' }],
    ]);
    replies['POST /v1/courier/notices/B'] = { status: 403, json: { ok: false, code: 'forbidden', message: 'another courier' } };
    await expect(listOnce(request, () => {})).rejects.toThrow('marking B sent: 403 forbidden');
    replies['POST /v1/courier/notices/claim'] = { status: 401, json: { ok: false, code: 'unauthenticated', message: 'revoked' } };
    await expect(listOnce(request, () => {})).rejects.toThrow('401 unauthenticated revoked');
  });

  it('--all reads the open decisions once and claims nothing', async () => {
    const out: string[] = [];
    const paths: string[] = [];
    const request = async (method: string, path: string) => {
      paths.push(`${method} ${path}`);
      return { status: 200, json: { decisions: [{ ...notice('E', 'Open'), notice_state: null }] } };
    };
    expect(await listOnce(request, (t: string) => out.push(t), { all: true })).toBe(1);
    expect(paths).toEqual(['GET /v1/courier/decisions']);
    expect(out).toEqual(['docs:E — Open\n  decision E-1 (asks owner)\n  notice: none']);
  });

  it('--watch asks once a minute until stopped', async () => {
    const stop = new AbortController();
    const waits: number[] = [];
    let passes = 0;
    const warned: string[] = [];
    const request = async () => {
      passes++;
      // The second pass finds Baton unreachable: reported, and the watch goes on.
      if (passes === 2) throw new Error('fetch failed');
      return { status: 200, json: { notices: [] } };
    };
    const sleep = async (ms: number) => {
      waits.push(ms);
      if (waits.length === 3) stop.abort();
    };
    await watch(request, () => {}, { signal: stop.signal, sleep, warn: (t: string) => warned.push(t) });
    expect(passes).toBe(3);
    expect(warned).toEqual(['baton decision list: fetch failed; trying again in a minute']);
    expect(waits).toEqual([WATCH_EVERY_MS, WATCH_EVERY_MS, WATCH_EVERY_MS]);
    expect(WATCH_EVERY_MS).toBe(60_000);
  });
});
