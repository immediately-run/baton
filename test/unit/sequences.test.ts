// sequences.test.ts — the CLI's half of Baton's identifier sequences (B-176, R-BTN-195, §4.6;
// S-BTN-222's unit half): the floor each kind's number is seeded by — the highest number on the
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
import { ticketsMain } from '../../src/defaults/tickets';
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

  it('a migration number and a rule id on an open branch\'s head only raise their kinds\' floors', () => {
    const dir = repo({
      'src/migrations/0047_x.sql': '-- 47\n',
      'spec/BATON_SPEC/13-data-model.md': '- **R-BTN-190 (leg state).** … S-BTN-197 … G-BTN-3 …\n',
    });
    git(dir, 'checkout', '-q', '-b', 'claude/B-110-next');
    writeFileSync(join(dir, 'src', 'migrations', '0048_y.sql'), '-- 48\n');
    writeFileSync(join(dir, 'spec', 'BATON_SPEC', '13-data-model.md'), '- **R-BTN-195 (sequences).** S-BTN-222 … G-BTN-3\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'peer takes 0048 and R-BTN-195');
    git(dir, 'push', '-q', 'origin', 'HEAD:refs/heads/claude/B-110-next');
    git(dir, 'checkout', '-q', 'main');
    expect(floorFor(dir, 'origin', parseKind('migration', dir))).toBe(48);
    expect(floorFor(dir, 'origin', parseKind('rule', dir))).toBe(195);
    expect(floorFor(dir, 'origin', parseKind('scenario', dir))).toBe(222);
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

describe('baton tickets new: the PR-first landing and --direct (B-176)', () => {
  /** `baton tickets new` in-process, its fetch routed where the test names. A refusal the CLI
   *  would print as one `baton: …` line and exit 2 on is caught here as the CLI catches it. */
  async function run(root: string, io: { url?: string; identity?: string; fetchImpl?: typeof fetch }, ...argv: string[]): Promise<{ code: number; out: string[]; err: string[] }> {
    const out: string[] = [];
    const err: string[] = [];
    try {
      const code = await ticketsMain(['new', ...argv], { root, log: (l) => out.push(l), warn: (l) => err.push(l), ...io });
      return { code, out, err };
    } catch (e) {
      return { code: 2, out, err: [...err, `baton: ${(e as Error).message}`] };
    }
  }
  const bareOf = (root: string): string => git(root, 'remote', 'get-url', 'origin');
  const at = (root: string, ref: string, path: string): string | null => {
    try {
      return execFileSync('git', ['-C', bareOf(root), 'show', `${ref}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return null;
    }
  };

  it('new takes its id from Baton and files the ticket ALONE on baton-ticket/<id>, printed for a person to merge (a git forge)', async () => {
    const dir = repo({ 'tickets/B-3.mdx': ticket('B-3') });
    const baton = await standIn();
    try {
      const r = await run(dir, { url: baton.url, identity: keyFile() }, '--title', 'Fourth', '--project', 'baton');
      expect(r.code).toBe(0);
      expect(r.err).toEqual([]);
      expect(r.out).toEqual(['✓ tickets: file B-4 — Fourth', '  branch: baton-ticket/B-4 — pushed for a person to merge']);
      // The ticket alone on the filing branch; the default branch untouched.
      expect(at(dir, 'baton-ticket/B-4', 'tickets/B-4.mdx')).toContain('id: B-4');
      expect(at(dir, 'main', 'tickets/B-4.mdx')).toBeNull();
      expect(execFileSync('git', ['-C', bareOf(dir), 'log', '--format=%s', 'main'], { encoding: 'utf8' }).trim()).toBe('fixture');
      // The ask this filing made: the ticket kind, floor 3 (B-3 on main), no ticket it is for.
      expect(baton.asked).toEqual(['POST /v1/repositories/seq/sequences/ticket-b/next bearer']);
    } finally {
      baton.close();
    }
  });

  it('a dependency\'s **Used by:** line is NOT written by a PR filing — two open filings never share a write target', async () => {
    const dir = repo({ 'tickets/B-3.mdx': ticket('B-3') });
    const baton = await standIn();
    try {
      const r = await run(dir, { url: baton.url, identity: keyFile() }, '--title', 'Fourth', '--project', 'baton', '--depends-on', 'B-3');
      expect(r.code).toBe(0);
      // The branch carries the new ticket alone: B-3's file, on main and on the branch, is as it was.
      expect(at(dir, 'baton-ticket/B-4', 'tickets/B-3.mdx')).not.toContain('**Used by:** B-4');
      expect(at(dir, 'baton-ticket/B-4', 'tickets/B-4.mdx')).toContain('depends_on:');
    } finally {
      baton.close();
    }
  });

  it('on a github origin, gh pr create opens the PR and its URL is printed; a gh that fails keeps the branch', async () => {
    // The bare origin lives at a path whose name says github.com: git works locally, and the
    // CLI's forge detection reads the host from the remote's own URL.
    const nest = mkdtempSync(join(tmpdir(), 'baton-seq-gh-'));
    scratch.push(nest);
    const dir = repo({ 'tickets/B-3.mdx': ticket('B-3') }, join(nest, 'github.com', 'ops'));
    const bin = mkdtempSync(join(tmpdir(), 'baton-seq-bin-'));
    scratch.push(bin);
    writeFileSync(join(bin, 'gh'), '#!/bin/sh\necho "https://github.com/immediately-run/ops/pull/9"\n');
    execFileSync('chmod', ['+x', join(bin, 'gh')], { stdio: 'ignore' });
    const baton = await standIn();
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
    try {
      const r = await run(dir, { url: baton.url, identity: keyFile() }, '--title', 'Fourth', '--project', 'baton');
      expect(r.code).toBe(0);
      expect(r.err).toEqual([]);
      expect(r.out).toEqual(['✓ tickets: file B-4 — Fourth', '  PR: https://github.com/immediately-run/ops/pull/9']);
      // A gh that answers nothing: the branch stays the answer, and the failure is said, not hidden.
      writeFileSync(join(bin, 'gh'), '#!/bin/sh\necho "gh: no credential" >&2\nexit 1\n');
      const failed = await run(dir, { url: baton.url, identity: keyFile() }, '--title', 'Fifth', '--project', 'baton');
      expect(failed.code).toBe(0);
      expect(failed.out).toEqual(['✓ tickets: file B-5 — Fifth', '  branch: baton-ticket/B-5 — pushed for a person to merge']);
      expect(failed.err.join('\n')).toMatch(/gh could not open the PR for baton-ticket\/B-5/);
      expect(at(dir, 'baton-ticket/B-5', 'tickets/B-5.mdx')).toContain('id: B-5');
    } finally {
      process.env.PATH = path;
      baton.close();
    }
  });

  it('--direct keeps today\'s push to the default branch with the reverse mentions; a protected refusal falls back to the PR', async () => {
    const dir = repo({ 'tickets/B-3.mdx': ticket('B-3') });
    const baton = await standIn();
    try {
      const r = await run(dir, { url: baton.url, identity: keyFile() }, '--direct', '--title', 'Fourth', '--project', 'baton', '--depends-on', 'B-3');
      expect(r.code).toBe(0);
      expect(r.out).toEqual(['✓ tickets: file B-4 — Fourth']);
      expect(at(dir, 'main', 'tickets/B-4.mdx')).toContain('id: B-4');
      expect(at(dir, 'main', 'tickets/B-3.mdx')).toContain('**Used by:** B-4');

      // The forge refuses the default branch as protected (GitHub's own GH006 words, from a
      // pre-receive hook): the same filing lands as the PR, by the forge's answer alone.
      const bare = bareOf(dir);
      mkdirSync(join(bare, 'hooks'), { recursive: true });
      writeFileSync(join(bare, 'hooks', 'pre-receive'), [
        '#!/bin/sh',
        'while read old new ref; do',
        '  if [ "$ref" = "refs/heads/main" ]; then',
        '    echo "error: GH006: Protected branch update failed for refs/heads/main." >&2',
        '    exit 1',
        '  fi',
        'done',
        '',
      ].join('\n'));
      execFileSync('chmod', ['+x', join(bare, 'hooks', 'pre-receive')], { stdio: 'ignore' });
      const fell = await run(dir, { url: baton.url, identity: keyFile() }, '--direct', '--title', 'Fifth', '--project', 'baton', '--depends-on', 'B-3');
      expect(fell.code).toBe(0);
      expect(fell.out).toEqual(['✓ tickets: file B-5 — Fifth', '  branch: baton-ticket/B-5 — pushed for a person to merge']);
      expect(fell.err.join('\n')).toMatch(/the default branch refused the push as protected — filing through a PR instead/);
      // The PR filing carries the ticket alone: the reverse mention never landed anywhere.
      expect(at(dir, 'main', 'tickets/B-5.mdx')).toBeNull();
      expect(at(dir, 'baton-ticket/B-5', 'tickets/B-5.mdx')).toContain('id: B-5');
      expect(at(dir, 'baton-ticket/B-5', 'tickets/B-3.mdx')).not.toContain('**Used by:** B-5');
    } finally {
      baton.close();
    }
  });

  it('Baton unreachable: the id is the scan\'s and the output says so, whichever way it lands', async () => {
    const dir = repo({ 'tickets/B-3.mdx': ticket('B-3') });
    const r = await run(dir, { url: 'http://127.0.0.1:1', identity: keyFile() }, '--title', 'Fourth', '--project', 'baton');
    expect(r.code).toBe(0);
    expect(r.err.join('\n')).toMatch(/^… id by the next-free scan — Baton did not answer/);
    expect(r.out).toEqual(['✓ tickets: file B-4 — Fourth', '  branch: baton-ticket/B-4 — pushed for a person to merge']);
    // The scanned id may collide: a branch that already holds it is the backstop's own moment.
    const again = await run(dir, { url: 'http://127.0.0.1:1', identity: keyFile() }, '--title', 'Again', '--project', 'baton');
    expect(again.code).toBe(2);
    expect(again.err.join('\n')).toMatch(/B-4: the filing branch baton-ticket\/B-4 was refused: .*the branch exists, so the scanned id is taken/);
  });
});

describe('R-BTN-190: no branch_pattern matches the reserved namespaces (B-176)', () => {
  const entry = (branch_pattern: string): unknown => ({
    id: 'c', version: 1, min_worker_version: 1, skill: 'next-ticket', step_kinds: ['implement'], course: {}, branch_pattern,
  });
  it('a pattern matching baton-ticket/*, baton-request/* or baton-legs/* is refused', () => {
    expect(() => checkRegistry([entry('baton-ticket/{ticket}-*')])).toThrow(/branch_pattern: must not match the reserved namespace baton-ticket\//);
    expect(() => checkRegistry([entry('baton-request/{ticket}')])).toThrow(/reserved namespace baton-request/);
    expect(() => checkRegistry([entry('baton-legs/{ticket}-*')])).toThrow(/reserved namespace baton-legs/);
    // A pattern that cannot reach a reserved namespace stands.
    expect(checkRegistry([entry('claude/{ticket}-*')])).toHaveLength(1);
    expect(checkRegistry([entry('ticket/{ticket}-*')])).toHaveLength(1);
  });
});
