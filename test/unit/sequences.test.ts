// sequences.test.ts — the CLI's half of Baton's identifier sequences (B-176, R-BTN-199, §4.6;
// S-BTN-234's unit half): the floor each kind's number is seeded by — the highest number on the
// default branch and every open branch's head, so a fresh Baton never reissues a number git holds
// — the fallback that says itself (no key, no answer, --offline), `new`'s PR-first landing with
// the forge asked through `gh`, `--direct`'s protected-refusal fallback, and R-BTN-190's reserved
// namespace `baton-ticket/*` no `branch_pattern` may match.
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { floorFor, nextMain, parseKind, printOf } from '../../src/defaults/sequences';
import { checkRegistry } from '../../src/core/courses';

const git = (root: string, ...a: string[]): string =>
  execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' } }).trim();

const scratch: string[] = [];
afterEach(() => {
  while (scratch.length) rmSync(scratch.pop()!, { recursive: true, force: true });
});

/** A checkout with a bare origin, committed and pushed: the fixture the floor reads. Its `repos`
 *  map names the bare path as `seq`, so the CLI's asks reach the stand-in under that id. */
function repo(files: Record<string, string>, bareAt?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'baton-seq-'));
  const bare = bareAt ?? mkdtempSync(join(tmpdir(), 'baton-seq-origin-'));
  scratch.push(dir, ...(bareAt ? [] : [bare]));
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare], { stdio: 'ignore' });
  for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 'seq@test'], ['config', 'user.name', 'seq'], ['remote', 'add', 'origin', bare]]) {
    execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore' });
  }
  mkdirSync(join(dir, '.baton'), { recursive: true });
  writeFileSync(join(dir, '.baton', 'baton.json'), `${JSON.stringify({ baton_url: 'https://baton.immediately.run', items: 'tickets', ticket_prefix: 'B', legacy_ids: ['R3-\\d+'], project: 'baton', repos: { seq: bare } }, null, 2)}\n`);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  mkdirSync(join(dir, 'tickets', 'projects'), { recursive: true });
  writeFileSync(join(dir, 'tickets', 'projects', 'baton.mdx'), '---\ntitle: baton\nid: baton\nstatus: active\nkind: project\n---\n\nProse.\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'fixture');
  git(dir, 'push', '-q', 'origin', 'HEAD:main');
  return dir;
}

const ticket = (id: string, status = 'available'): string => `---\ntitle: "${id} — t"\nid: ${id}\nstatus: ${status}\ntags: [roadmap-item]\ntopics: [baton]\nowns: {}\nprs: []\ndepends_on: []\n---\n\nBody.\n`;

/** A stand-in Baton answering the sequence route with a real counter, recording what it was asked. */
async function standIn(): Promise<{ url: string; asked: string[]; close: () => void }> {
  const asked: string[] = [];
  const counters = new Map<string, number>();
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://baton.test');
    asked.push(`${req.method} ${url.pathname} ${req.headers.authorization ? 'bearer' : 'none'}`);
    const m = /^\/v1\/repositories\/([^/]+)\/sequences\/([^/]+)\/next$/.exec(url.pathname);
    if (req.method !== 'POST' || !m) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, code: 'not-found', message: `no route ${url.pathname}` }));
      return;
    }
    let body = '';
    req.on('data', (c: Buffer) => { body += c; });
    req.on('end', () => {
      const floor = Number(JSON.parse(body || '{}').floor ?? 0);
      const kind = decodeURIComponent(m[2]);
      const n = Math.max(counters.get(kind) ?? 0, Number.isFinite(floor) ? floor : 0) + 1;
      counters.set(kind, n);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, kind, number: n }));
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address() as { address: string; port: number };
  return { url: `http://${address.address}:${address.port}`, asked, close: () => server.close() };
}

/** An API key file: `send`'s own dispatch takes it as a bearer (R-BTN-159). */
function keyFile(): string {
  const file = join(mkdtempSync(join(tmpdir(), 'baton-seq-key-')), 'key');
  scratch.push(join(file, '..'));
  writeFileSync(file, `bak_${'0'.repeat(16)}_${'a'.repeat(64)}\n`);
  return file;
}

describe('the floor: the highest number the default branch and every open branch head hold (B-176)', () => {
  it('a ticket number on an open branch\'s head only — not on the default branch — raises the floor', () => {
    const dir = repo({ 'tickets/B-3.mdx': ticket('B-3') });
    const kind = parseKind('ticket', dir);
    expect(floorFor(dir, 'origin', kind)).toBe(3);
    // A peer's filing branch, not reachable from main: its number is taken all the same.
    git(dir, 'checkout', '-q', '-b', 'baton-ticket/B-7');
    writeFileSync(join(dir, 'tickets', 'B-7.mdx'), ticket('B-7'));
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'peer files B-7');
    git(dir, 'push', '-q', 'origin', 'HEAD:refs/heads/baton-ticket/B-7');
    git(dir, 'checkout', '-q', 'main');
    let reachable = true;
    try {
      git(dir, 'merge-base', '--is-ancestor', 'origin/baton-ticket/B-7', 'origin/main');
    } catch {
      reachable = false;
    }
    expect(reachable).toBe(false);
    expect(floorFor(dir, 'origin', kind)).toBe(7);
    // The archived folder counts, and only the prefix's own series does.
    const withArchive = repo({ 'tickets/B-3.mdx': ticket('B-3'), 'tickets/archive/B-9.mdx': ticket('B-9', 'done'), 'tickets/R3-40.mdx': ticket('R3-40') });
    expect(floorFor(withArchive, 'origin', parseKind('ticket', withArchive))).toBe(9);
    expect(floorFor(withArchive, 'origin', parseKind('ticket-R3', withArchive))).toBe(40);
  });

  it('a remote that cannot be read has no floor — "cannot see git" is never read as "git holds nothing" (value 1)', () => {
    // A checkout whose origin nothing serves, holding numbers git would count: the floor is
    // refused, not 0 — a fresh Baton seeded by 0 would answer below every number git holds
    // (round 1, should-fix 1), and the scan has nothing to count either.
    const dir = repo({ 'tickets/B-200.mdx': ticket('B-200'), 'src/migrations/0047_x.sql': '-- 47\n' });
    git(dir, 'remote', 'set-url', 'origin', join(mkdtempSync(join(tmpdir(), 'baton-seq-dead-')), 'nothing'));
    expect(() => floorFor(dir, 'origin', parseKind('ticket', dir))).toThrow(/cannot read origin's branches/);
    expect(() => floorFor(dir, 'origin', parseKind('migration', dir))).toThrow(/cannot read origin's branches/);
  });

  it('a migration number and a rule id on an open branch\'s head only raise their kinds\' floors', () => {
    const dir = repo({
      'src/migrations/0047_x.sql': '-- 47\n',
      'spec/BATON_SPEC/13-data-model.md': '- **R-BTN-190 (leg state).** … S-BTN-197 … G-BTN-3 …\n',
    });
    git(dir, 'checkout', '-q', '-b', 'claude/B-110-next');
    writeFileSync(join(dir, 'src', 'migrations', '0048_y.sql'), '-- 48\n');
    writeFileSync(join(dir, 'spec', 'BATON_SPEC', '13-data-model.md'), '- **R-BTN-198 (sequences).** S-BTN-231 … G-BTN-3\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'peer takes 0048 and R-BTN-198');
    git(dir, 'push', '-q', 'origin', 'HEAD:refs/heads/claude/B-110-next');
    git(dir, 'checkout', '-q', 'main');
    expect(floorFor(dir, 'origin', parseKind('migration', dir))).toBe(48);
    expect(floorFor(dir, 'origin', parseKind('rule', dir))).toBe(198);
    expect(floorFor(dir, 'origin', parseKind('scenario', dir))).toBe(231);
    expect(floorFor(dir, 'origin', parseKind('gate', dir))).toBe(3);
    // The printed forms: the migrations' four digits, the spec ids' own prefixes.
    expect(printOf(parseKind('migration', dir), 49)).toBe('0049');
    expect(printOf(parseKind('scenario', dir), 223)).toBe('S-BTN-223');
    expect(printOf(parseKind('ticket', dir), 8)).toBe('B-8');
  });
});

describe('baton tickets next: Baton first, the scan the fallback that says itself (B-176)', () => {
  it('takes the number from Baton with the floor this checkout sees, and prints it with the floor', async () => {
    const dir = repo({ 'tickets/B-3.mdx': ticket('B-3'), 'src/migrations/0047_x.sql': '-- 47\n' });
    const baton = await standIn();
    try {
      const out: string[] = [];
      const err: string[] = [];
      expect(await nextMain(['scenario', '-i', keyFile(), '--url', baton.url], { root: dir, log: (l) => out.push(l), warn: (l) => err.push(l) })).toBe(0);
      expect(out).toEqual(['✓ scenario: S-BTN-1 (Baton\'s sequence, floor 0)']);
      // The CLI's own ask: one route, one body — the kind the CLI names, the floor it read.
      expect(baton.asked).toEqual(['POST /v1/repositories/seq/sequences/scenario/next bearer']);
      expect(err).toEqual([]);
    } finally {
      baton.close();
    }
  });

  it('Baton unreachable falls back to the scan and says so; --offline says it too', async () => {
    const dir = repo({ 'tickets/B-3.mdx': ticket('B-3') });
    const out: string[] = [];
    const err: string[] = [];
    expect(await nextMain(['ticket', '-i', keyFile(), '--url', 'http://127.0.0.1:1'], { root: dir, log: (l) => out.push(l), warn: (l) => err.push(l) })).toBe(0);
    expect(err.join('\n')).toMatch(/^… id by the next-free scan — Baton did not answer \(the ticket-b sequence/);
    expect(out).toEqual(['ticket-b: B-4 (the next free number by the scan, floor 3)']);
    const offline: string[] = [];
    const offlineErr: string[] = [];
    expect(await nextMain(['migration', '--offline'], { root: dir, log: (l) => offline.push(l), warn: (l) => offlineErr.push(l) })).toBe(0);
    expect(offlineErr.join('\n')).toMatch(/^… id by the next-free scan \(--offline\)/);
    expect(offline).toEqual(['migration: 0001 (the next free number by the scan, floor 0)']);
    // No key configured: the scan again, with the note saying why.
    const noKey: string[] = [];
    const noKeyErr: string[] = [];
    expect(await nextMain(['rule'], { root: dir, log: (l) => noKey.push(l), warn: (l) => noKeyErr.push(l) })).toBe(0);
    expect(noKeyErr.join('\n')).toMatch(/no key: pass -i KEY/);
    expect(noKey).toEqual(['rule: R-BTN-1 (the next free number by the scan, floor 0)']);
  });
});

describe('baton tickets next --coordinator: Dibber\'s coordinator command (B-326, R-BTN-199)', () => {
  it('prints Baton\'s number alone, the last line Dibber reads', async () => {
    const dir = repo({ 'tickets/B-3.mdx': ticket('B-3') });
    const baton = await standIn();
    try {
      const out: string[] = [];
      const err: string[] = [];
      expect(await nextMain(['ticket-B', '--coordinator', '-i', keyFile(), '--url', baton.url], { root: dir, log: (l) => out.push(l), warn: (l) => err.push(l) })).toBe(0);
      expect(out).toEqual(['4']);
      expect(err).toEqual([]);
    } finally {
      baton.close();
    }
  });

  it('refuses rather than scan: Baton unreachable, no key, or --offline — so dibber new refuses too', async () => {
    const dir = repo({ 'tickets/B-3.mdx': ticket('B-3') });
    const out: string[] = [];
    await expect(nextMain(['ticket-B', '--coordinator', '-i', keyFile(), '--url', 'http://127.0.0.1:1'], { root: dir, log: (l) => out.push(l), warn: () => {} })).rejects.toThrow(/^ticket-b: Baton did not hand out a number \(.*\) — the coordinator answers with Baton's number or not at all$/);
    await expect(nextMain(['ticket-B', '--coordinator'], { root: dir, log: (l) => out.push(l), warn: () => {} })).rejects.toThrow("ticket-b: no key: pass -i KEY (or set BATON_KEY_FILE) — the coordinator answers with Baton's number or not at all");
    await expect(nextMain(['ticket-B', '--coordinator', '--offline'], { root: dir, log: (l) => out.push(l), warn: () => {} })).rejects.toThrow('--coordinator answers with Baton\'s number or not at all');
    expect(out).toEqual([]);
  });
});

describe('R-BTN-190: no branch_pattern matches the reserved namespaces (B-176)', () => {
  const entry = (branch_pattern: string): unknown => ({
    id: 'c', version: 1, min_runner_version: 1, skill: 'next-ticket', step_kinds: ['implement'], course: {}, branch_pattern,
  });
  it('a pattern matching baton-ticket/*, baton-request/* or baton-legs/* is refused — the exact shape too', () => {
    expect(() => checkRegistry([entry('baton-ticket/{ticket}-*')])).toThrow(/branch_pattern: must not match baton-ticket\/\*/);
    // The exact-collision pattern `baton-ticket/{ticket}` — the shape `new` itself pushes
    // (`baton-ticket/<id>`) is refused as the starred one is (round 1, finding 2).
    expect(() => checkRegistry([entry('baton-ticket/{ticket}')])).toThrow(/branch_pattern: must not match baton-ticket\/\*/);
    expect(() => checkRegistry([entry('baton-request/{ticket}')])).toThrow(/must not match baton-request\/\*/);
    expect(() => checkRegistry([entry('baton-legs/{ticket}-*')])).toThrow(/must not match baton-legs\/\*/);
    // A pattern that cannot reach a reserved namespace stands.
    expect(checkRegistry([entry('claude/{ticket}-*')])).toHaveLength(1);
    expect(checkRegistry([entry('ticket/{ticket}-*')])).toHaveLength(1);
  });
});
