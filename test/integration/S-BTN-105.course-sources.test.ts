// S-BTN-105 a course from its source, one leg overridden (BATON_SPEC §15 S-BTN-105, R-BTN-131,
// R-BTN-51; B-33): a repository's `create-pr` names its source —
// `github/<owner>/<name>/<commit>/create-pr`, this CLI's repository at this CLI's commit — and
// replaces its `review` leg's run with `legs/review.run.mjs`. Must hold: the sync posts it and
// places the ticket; a claim's review runs the override at the snapshot and the standard close
// writes the verdict line, which moves the ticket to `reviewed` with `fix` queued; a course file
// that differs from the source's, a source at another commit or in another repository, and a
// `sync.mjs` beside a source are each refused, nothing posted; so are a source naming another
// course than its id and one naming no standard course; the repository's name in another case is
// the same repository. Node only: it writes a real
// repository and runs git.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { call as hostCall } from '#host';
import { initMain, parseSyncArgs, syncMain } from '../../src/defaults/cli';
import { ORIGIN, rows, setClock, syncToken } from '../helpers';

const T0 = Date.parse('2026-10-18T12:00:00Z');
const ROOT = resolve(import.meta.dirname, '../..');
const SHA = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

let dir: string;
let minutes = 0;
const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
const commit = (): string => {
  git('add', '-A');
  git('commit', '--allow-empty', '-qm', 'step');
  return git('rev-parse', 'HEAD');
};
const settingsFile = () => join(dir, '.baton', 'baton.json');
const facts = join(tmpdir(), `baton-s105-facts-${process.pid}.json`);
/** One sync through the local host, with the recorded PR facts. */
const sync = async () => {
  setClock(T0 + (minutes += 11) * 60_000);
  const token = await syncToken();
  const args = parseSyncArgs(['--root', dir, '--url', ORIGIN, '--facts', facts], {});
  await syncMain({ ...args, auth: () => ({ Authorization: `Bearer ${token}` }), transport: (req) => hostCall(req), log: () => {} });
};

beforeEach(async () => {
  minutes = 0;
  await setClock(T0);
  dir = mkdtempSync(join(tmpdir(), 'baton-s105-'));
  for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 's105@test'], ['config', 'user.name', 's105']]) git(...a);
  expect(await initMain(['--override', 'review'], { root: dir, log: () => {} })).toBe(0);
  mkdirSync(join(dir, 'tickets'), { recursive: true });
  writeFileSync(join(dir, 'tickets', 't1.md'), '---\nid: T-1\ntitle: Build it\n---\n');
  writeFileSync(facts, JSON.stringify([{ number: 7, head: 'claude/T-1-x', state: 'open', pushedAt: T0, pushes: [T0], checks: ['success'], reviews: [] }]));
  commit();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(facts, { force: true });
});

describe('S-BTN-105 a course from its source, one leg overridden', () => {
  it('posts the sourced course, runs the override at the snapshot, and the standard close moves the ticket', async () => {
    const settings = JSON.parse(readFileSync(settingsFile(), 'utf8'));
    expect(settings.courses[0].source).toMatch(new RegExp(`^github/[^/]+/[^/]+/${SHA}/create-pr$`));
    await sync();
    const at = async () => (await rows<{ station: string; next_leg: string | null }>('SELECT station, next_leg FROM ticket_stations WHERE ticket_id = ?', 'docs:T-1'))[0];
    expect(await at()).toMatchObject({ station: 'pr-open', next_leg: 'review' });

    // The repository's review: its own check, then the course's run with an agent that asks for changes.
    const agent = join(dir, 'agent.sh');
    writeFileSync(agent, '#!/bin/sh\necho reviewing\necho changes\n');
    chmodSync(agent, 0o755);
    writeFileSync(settingsFile(), JSON.stringify({ ...settings, agent_command: agent }, null, 2));
    writeFileSync(join(dir, '.baton', 'courses', 'create-pr', 'legs', 'review.run.mjs'), `import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
export async function run(ctx, standard) {
  writeFileSync(join(ctx.checkout, 'gate.log'), 'two blind reviewers, then the matcher');
  return standard(ctx);
}
`);
    const sha = commit();
    // A fake gh records the comment the standard close posts.
    const bin = mkdtempSync(join(tmpdir(), 'baton-s105-gh-'));
    writeFileSync(join(bin, 'gh'), `#!/bin/sh\nprintf '%s' "$4" > "${join(bin, 'body')}"\necho https://github.com/o/r/pull/7#issuecomment-1\n`);
    chmodSync(join(bin, 'gh'), 0o755);
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
    try {
      const leg = await import(`${pathToFileURL(join(dir, '.baton', 'courses', 'create-pr', 'legs', 'review.mjs')).href}?t=${Date.now()}`);
      const ctx = { ticket: { id: 'docs:T-1', path: 'tickets/t1.md', home: 'docs' }, checkout: dir, snapshot: { sha }, leg: 'review', claim: { nonce: 'n1' } };
      const result = await leg.run(ctx);
      expect(result).toEqual({ reached: 'reviewed', next: 'fix', verdict: 'changes' });
      expect(readFileSync(join(dir, 'gate.log'), 'utf8')).toContain('two blind reviewers');
      expect(await leg.close(ctx, result)).toBe('https://github.com/o/r/pull/7#issuecomment-1');
      const body = readFileSync(join(bin, 'body'), 'utf8');
      expect(body.split('\n')[0]).toBe('<!-- baton:verdict changes -->');
      // The forge now carries that comment: the next sync reads it as the review's verdict.
      writeFileSync(facts, JSON.stringify([{ number: 7, head: 'claude/T-1-x', state: 'open', pushedAt: T0, pushes: [T0], checks: ['success'], reviews: [{ author: 'baton', state: 'COMMENTED', submittedAt: T0 + 60_000, body }] }]));
    } finally {
      process.env.PATH = path;
      rmSync(bin, { recursive: true, force: true });
    }
    await sync();
    expect(await at()).toMatchObject({ station: 'reviewed', next_leg: 'fix' });
  }, 120_000);

  it('refuses a course file that differs from the source’s, a source at another commit or in another repository, and a sync.mjs beside a source', async () => {
    const settings = JSON.parse(readFileSync(settingsFile(), 'utf8'));
    const source: string = settings.courses[0].source;
    const courseFile = join(dir, '.baton', 'courses', 'create-pr', 'course.json');
    const graph = readFileSync(courseFile, 'utf8');
    const withSource = (s: string) => writeFileSync(settingsFile(), JSON.stringify({ ...settings, courses: [{ ...settings.courses[0], source: s }] }, null, 2));

    writeFileSync(courseFile, graph.replace('"max_runs": 3', '"max_runs": 5'));
    commit();
    await expect(sync()).rejects.toThrow(/course\.json differs from the source's — a sourced course keeps its graph exactly; `baton repo init --course create-pr --force` restores it/);
    writeFileSync(courseFile, graph);

    withSource(source.replace(SHA, '1'.repeat(40)));
    commit();
    await expect(sync()).rejects.toThrow(`is at 1111111111, and this CLI is at ${SHA.slice(0, 10)}`);

    withSource(`github/someone/else/${SHA}/create-pr`);
    commit();
    await expect(sync()).rejects.toThrow('a course from someone/else is not supported yet');

    withSource(source.replace(/\/create-pr$/, '/review-pr'));
    commit();
    await expect(sync()).rejects.toThrow('names course review-pr; a source names the course of its own id');

    // A course of the CLI's repository that is no standard course of it.
    mkdirSync(join(dir, '.baton', 'courses', 'mine'), { recursive: true });
    writeFileSync(join(dir, '.baton', 'courses', 'mine', 'course.json'), graph);
    writeFileSync(settingsFile(), JSON.stringify({ ...settings, courses: [...settings.courses, { id: 'mine', version: 1, source: source.replace(/\/create-pr$/, '/mine') }] }, null, 2));
    commit();
    await expect(sync()).rejects.toThrow(/mine is not a standard course of .+ at /);
    rmSync(join(dir, '.baton', 'courses', 'mine'), { recursive: true, force: true });

    withSource(source);
    writeFileSync(join(dir, '.baton', 'courses', 'create-pr', 'sync.mjs'), 'export default { async stations() { return { stations: {}, markers: [], course_data: {} }; } };\n');
    commit();
    await expect(sync()).rejects.toThrow("sync.mjs would replace the source's station function");
    expect(await rows('SELECT ticket_id FROM ticket_stations')).toEqual([]); // nothing was ever posted

    rmSync(join(dir, '.baton', 'courses', 'create-pr', 'sync.mjs'));
    commit();
    await sync();
    expect(await rows('SELECT ticket_id FROM ticket_stations')).toEqual([{ ticket_id: 'docs:T-1' }]);

    // GitHub's names ignore case: the same repository in another case is no other repository.
    const [provider, owner, name, ...rest] = source.split('/');
    withSource([provider, owner.toUpperCase(), name.toUpperCase(), ...rest].join('/'));
    commit();
    await sync();
  }, 120_000);
});
