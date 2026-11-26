// S-BTN-226 a pathless ticket's file for its legs (BATON_SPEC §4.2 R-BTN-74, §8 the leg's ctx;
// B-252), Node only: a real sync and a real runner over a real repository. A `custom` ticket
// source with `versions: "current"` posts tickets with no `path`; its `read` returns the ticket as
// markdown text, frontmatter first. The runner writes that text, mode 0600, into the claim's
// scratch directory and hands every leg its absolute path as `ctx.ticket.file`, gone when the claim
// ends. The scaffold's implement stub reads the ticket's `repos:` from that file — so its PR
// verification looks in the sibling repository the ticket names — and names the file to its
// agent in BATON_TICKET_FILE. A source whose `read` returns an object, and the markdown source,
// give the legs no `file`: the markdown source's ctx is what it was.
import { runnerApi, testRunner } from '../lib/runnerRig';
import { GitRepo } from '../lib/gitRepo';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { call as hostCall } from '#host';
import { initMain, parseSyncArgs, syncMain } from '../../src/defaults/cli';
import { Runner } from '../../src/runner/runner';
import { ORIGIN, TOKENS, cutover, setClock, syncToken } from '../helpers';

const T0 = Date.parse('2026-11-16T12:00:00Z');

/** The ticket as a tracker-backed source renders it for the legs: the markdown source's
 *  frontmatter keys, then the body. */
const markdownOf = (t: { id: string; title: string; body: string; repos?: string[] }): string =>
  `---\nid: ${t.id}\ntitle: ${JSON.stringify(t.title)}\nrepos:\n${(t.repos ?? []).map((r) => `  - ${r}\n`).join('')}prs: []\n---\n\n${t.body}\n`;

/** A `custom` source over a JSON file outside git, `versions: "current"`; its read returns the
 *  ticket as markdown text, or as the store's object when the store says `as: 'object'`. */
const trackerSource = (store: string): string => `import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const STORE = ${JSON.stringify(store)};
const markdownOf = ${markdownOf.toString()};
const readStore = () => JSON.parse(readFileSync(STORE, 'utf8'));
const digest = (t) => createHash('sha256').update(markdownOf(t)).digest('hex').slice(0, 16);
export default {
  versions: 'current',
  async tickets() {
    const store = readStore();
    return { tickets: store.tickets.map((t) => ({
      id: t.id, version: store.rev + ':' + digest(t), key: 'tracker:' + t.id, course_id: 'create-pr',
      title: t.title, tier: 'routine', requires: [], operator_only: false, expedite: false,
      depends_on: [], blocked_by: [], repos: [], rank: 0,
    })), closed: [] };
  },
  async read(id) {
    const store = readStore();
    const t = store.tickets.find((x) => x.id === id);
    if (t == null) return null;
    return { version: store.rev + ':' + digest(t), ticket: store.as === 'object' ? t : markdownOf(t) };
  },
};
`;

/** A leg that records what it was handed: ctx.ticket, and the file's text and mode when it has one. */
const RECORDING_LEG = `import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export async function run(ctx) {
  const t = ctx.ticket;
  const seen = { ticket: t, text: t.file ? readFileSync(t.file, 'utf8') : null, mode: t.file ? statSync(t.file).mode & 0o777 : null };
  writeFileSync(join(ctx.checkout, 'leg-saw.json'), JSON.stringify(seen));
  return { end: 'done', reached: 'filed' };
}
export async function close() { return 'https://example.test/close'; }
`;

const TICKET = { id: 'T-300', title: 'A ticket that lives in a tracker', body: 'Change the sibling repository.', repos: ['immediately-run/sibling'] };

class PathlessTickets extends GitRepo {
  readonly store: string;
  constructor(private readonly tracker: boolean) {
    super('baton-226-', { origin: 'https://github.com/immediately-run/docs.git' });
    this.store = join(this.root, 'store.json');
    mkdirSync(join(this.dir, 'tickets'), { recursive: true });
    if (tracker) writeFileSync(join(this.dir, 'tickets', 'README.md'), 'the tickets wiki\n');
    else writeFileSync(join(this.dir, 'tickets', 'one.mdx'), '---\nid: T-1\ntitle: One\ntier: routine\n---\nThe body.\n');
  }

  async setup(leg: string | null, store: Record<string, unknown> = { rev: 1, tickets: [TICKET] }): Promise<PathlessTickets> {
    expect(await initMain(['--own'], { root: this.dir, log: () => {} })).toBe(0);
    if (this.tracker) writeFileSync(join(this.dir, '.baton', 'tickets.mjs'), trackerSource(this.store));
    if (leg != null) writeFileSync(join(this.dir, '.baton', 'courses', 'create-pr', 'legs', 'implement.mjs'), leg);
    writeFileSync(this.store, JSON.stringify(store));
    this.commit();
    return this;
  }
  commit(message = 'wiki'): string { return super.commit(message); }
  async sync(): Promise<string> {
    const facts = join(this.dir, '.baton', 'facts.json');
    writeFileSync(facts, '[]');
    const token = await syncToken();
    const args = parseSyncArgs(['--root', this.dir, '--url', ORIGIN, '--facts', facts], {});
    const lines: string[] = [];
    const code = await syncMain({ ...args, auth: () => ({ Authorization: `Bearer ${token}` }), transport: (req) => hostCall(req), log: (l) => lines.push(l) });
    return `exit ${code}: ${lines.at(-1) ?? ''}`;
  }
  runner(session: string): Runner {
    const api = runnerApi();
    return testRunner({
      api, home: this.dir, session,
      courses: [{ course: 'create-pr', version: 2 }], stateFile: join(tmpdir(), `baton-s226-${session}.json`),
      beatEvery: 60_000, });
  }
  saw(): { ticket: Record<string, unknown>; text: string | null; mode: number | null } {
    return JSON.parse(readFileSync(join(this.dir, 'leg-saw.json'), 'utf8'));
  }
}

const cleanup: string[] = [];
const repos: GitRepo[] = [];
beforeEach(async () => {
  await setClock(T0);
  await cutover();
});
afterEach(() => {
  while (repos.length) repos.pop()!.dispose();
  for (const d of cleanup) rmSync(d, { recursive: true, force: true });
  cleanup.length = 0;
});
const repoOf = (tracker: boolean): PathlessTickets => {
  const r = new PathlessTickets(tracker);
  repos.push(r);
  return r;
};

describe('S-BTN-226 a pathless ticket\'s file for its legs', () => {
  it('a pathless ticket whose read returns markdown: the leg gets ctx.ticket.file, mode 0600 in the claim\'s scratch, holding the read\'s text, gone after the claim', async () => {
    const repo = await repoOf(true).setup(RECORDING_LEG);
    expect(await repo.sync()).toMatch(/^exit 0: /);
    expect(await repo.runner(`s226a-${process.pid}`).runOnce()).not.toBeNull();
    const saw = repo.saw();
    expect(saw.ticket.path ?? '').toBe(''); // the claim names no path (an empty one)
    const file = saw.ticket.file as string;
    expect(file).toMatch(/[/\\]baton-claim-[^/\\]+[/\\]ticket\.md$/);
    expect(saw.text).toBe(markdownOf(TICKET));
    expect(saw.mode).toBe(0o600);
    // The claim's scratch went with the claim: the file is not left behind.
    expect(existsSync(file)).toBe(false);
  });

  it('a source whose read returns an object gives the leg no file', async () => {
    const repo = await repoOf(true).setup(RECORDING_LEG, { rev: 1, as: 'object', tickets: [TICKET] });
    expect(await repo.sync()).toMatch(/^exit 0: /);
    expect(await repo.runner(`s226b-${process.pid}`).runOnce()).not.toBeNull();
    const saw = repo.saw();
    expect(saw.ticket.path ?? '').toBe(''); // the claim names no path (an empty one)
    expect('file' in saw.ticket).toBe(false);
  });

  it('the markdown source\'s leg ctx is unchanged: its path, no file', async () => {
    const repo = await repoOf(false).setup(RECORDING_LEG);
    expect(await repo.sync()).toMatch(/^exit 0: /);
    expect(await repo.runner(`s226c-${process.pid}`).runOnce()).not.toBeNull();
    const saw = repo.saw();
    expect(Object.keys(saw.ticket).sort()).toEqual(['home', 'id', 'path', 'version']);
    expect(saw.ticket.path).toBe('tickets/one.mdx');
  });

  it('the implement stub reads repos: from ctx.ticket.file, looks for the PR in the sibling, and names the file in BATON_TICKET_FILE', async () => {
    const repo = await repoOf(true).setup(null);
    const bin = mkdtempSync(join(tmpdir(), 'baton-s226-bin-'));
    const scratch = mkdtempSync(join(tmpdir(), 'baton-s226-legs-'));
    cleanup.push(bin, scratch);
    // The agent records the ticket file it was told about; gh answers a PR only in the sibling.
    const told = join(bin, 'told.txt');
    writeFileSync(join(bin, 'agent.sh'), `#!/bin/sh\nprintf '%s' "$BATON_TICKET_FILE" > ${JSON.stringify(told)}\n`);
    const sibling = join(bin, 'sibling.json');
    writeFileSync(join(bin, 'gh'), `#!/bin/sh\ncase "$*" in *"--repo immediately-run/sibling"*) cat ${JSON.stringify(sibling)} ;; *) echo '[]' ;; esac\n`);
    chmodSync(join(bin, 'gh'), 0o755);
    const settingsFile = join(repo.dir, '.baton', 'baton.json');
    writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(readFileSync(settingsFile, 'utf8')), agent_command: `sh ${join(bin, 'agent.sh')}` }));
    const snapshot = { sha: repo.commit('agent') };
    // The ticket file as the runner writes it: outside the checkout, the source's markdown.
    const file = join(scratch, 'ticket.md');
    writeFileSync(file, markdownOf(TICKET), { mode: 0o600 });
    copyFileSync(join(repo.dir, '.baton', 'courses', 'create-pr', 'legs', 'implement.mjs'), join(scratch, 'implement.mjs'));
    const stub = await import(`${pathToFileURL(join(scratch, 'implement.mjs')).href}?t=${Math.random()}`);
    const ctx = { ticket: { id: 'docs:T-300', path: null, home: 'docs', file }, checkout: repo.dir, snapshot };
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
    try {
      // The PR is in the sibling the file's repos: names, not in the home: the leg passes.
      writeFileSync(sibling, JSON.stringify([{ number: 4, headRefName: 'claude/T-300-tracker', headRefOid: '0123456789abcdef0123456789abcdef01234567' }]));
      expect(await stub.run(ctx)).toEqual({ reached: 'pr-open', next: 'run-tests' });
      expect(readFileSync(told, 'utf8')).toBe(file);
      // No PR in the sibling either: the failure names the sibling it looked in.
      writeFileSync(sibling, '[]');
      await expect(stub.run(ctx)).rejects.toThrow(/immediately-run\/sibling/);
    } finally {
      process.env.PATH = path;
    }
  });
});
