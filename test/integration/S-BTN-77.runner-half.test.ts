// S-BTN-77's runner half (BATON_SPEC §15, §8.3 R-BTN-113; B-4), Node only: a runner whose
// executor names its leg session's link reports it not only on the beats (B-234's landing) but
// on the advance that finishes the leg and the end that finishes the claim — the last word for
// each finished run, stored on its `claim_legs` row whatever the beats did. The API side is
// S-BTN-77.host-allowlists.test.ts, on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import roadmapPr from '../fixtures/courses/roadmap-pr/course.json';
import { course as courseEntry, cutover, Git, keyCall, placed, register, rows, setAdminKeys, setClock, syncCall, ticket, TOKENS } from '../helpers';
import { makeKey } from '../lib/sshKeys';
import { Runner } from '../../src/runner/runner';
import { BatonApi } from '../../src/runner/api';
import { builtinExecutor, type Executor, type Handle } from '../../src/runner/executor';
import { call as hostCall } from '#host';

const T0 = Date.parse('2026-11-14T11:00:00Z');
const LINK = 'https://claude.ai/s/r_0000000000000000000000000';

/** The course under test: `implement` runs first, `review` ends the claim done. */
const COURSE = roadmapPr as Record<string, unknown>;

/** An executor whose leg sessions name a session link (R-BTN-113: the handle's `link` is the
 *  session's own — what a cloud-session executor reports; `builtin` names none). */
function linkingExecutor(link: string): Executor {
  const base = builtinExecutor();
  return {
    api: base.api, source: base.source, digest: base.digest, provides: base.provides,
    async start(o) { return { ...(await base.start(o)), ...(o.brief.kind === 'leg' ? { link } : {}) }; },
    exec: (h: Handle, a: string[], o: Parameters<Executor['exec']>[2]) => base.exec(h, a, o),
    stop: base.stop.bind(base),
    end: base.end.bind(base),
    salvage: base.salvage.bind(base),
  };
}

/** The leg scripts: plain results, no channel use — the link is the executor's, never the
 *  script's. Each exports all three calls, as the kit requires. */
const CLOSE = `export async function close() { return null; }\nexport async function handoff() { return null; }\n`;
const SCRIPTS: Record<string, string> = {
  implement: `export async function run(ctx) { return { reached: 'pr-open', next: 'review' }; }\n${CLOSE}`,
  review: `export async function run(ctx) { return { end: 'done', reached: 'reviewed' }; }\n${CLOSE}`,
};

/** A scratch home checkout: the course, its leg scripts, the settings naming them. */
function writeHome(): { home: string; sha: string } {
  const home = mkdtempSync(join(tmpdir(), 'baton-77-'));
  const g = (...a: string[]) => execFileSync('git', ['-C', home, ...a], { encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(home, path)), { recursive: true });
    writeFileSync(join(home, path), text);
  };
  write('.baton/courses/roadmap-pr/course.json', `${JSON.stringify(COURSE, null, 2)}\n`);
  write('.baton/baton.json', `${JSON.stringify({ courses: [{ id: 'roadmap-pr', version: 3 }] }, null, 2)}\n`);
  for (const [name, text] of Object.entries(SCRIPTS)) write(`.baton/courses/roadmap-pr/legs/${name}.mjs`, text);
  g('add', '-A');
  g('-c', 'user.email=b4@test', '-c', 'user.name=b4 test', 'commit', '--no-gpg-sign', '-qm', 'courses');
  return { home, sha: g('rev-parse', 'HEAD').trim() };
}

let git: Git;
let stateFile: string;
let boardSha: string | null = null;
let boardHead: string | null = null;
async function postBoard() {
  const res = await syncCall('/v1/sync/board', {
    registry: git.registry, sha: boardSha!, parent_sha: boardHead,
    tickets: [ticket('A')], closed: [], stations: { A: placed('filed', [], [['implement', 'ready']]) },
  });
  if (res.status !== 200) throw new Error(`the board post failed: ${res.status} ${await res.text()}`);
  boardHead = boardSha;
}

beforeEach(async () => {
  await setClock(T0);
  const admin = await makeKey('ssh-ed25519', 'admin');
  const owner = await makeKey('ssh-ed25519', 'docs-owner');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  git = new Git();
  git.registry = [courseEntry(3, 3)];
  boardSha = null;
  boardHead = null;
  await cutover(T0);
  stateFile = join(tmpdir(), `baton-77-${process.pid}-${Math.random().toString(16).slice(2)}.json`);
});

describe('S-BTN-77 (the runner half): the finishing calls carry the run\'s link (R-BTN-113)', () => {
  it('the advance that finishes a leg and the end that finishes the claim each carry the session link, and both runs\' rows hold it', async () => {
    const { home, sha } = writeHome();
    boardSha = sha;
    await postBoard();
    await register('vm-a');
    try {
      // The transport captures the advance and end bodies as the runner built them.
      const advances: Record<string, any>[] = [];
      const ends: Record<string, any>[] = [];
      const r = new Runner({
        api: new BatonApi({
          url: 'https://baton.test',
          transport: async (req) => {
            const p = new URL(req.url).pathname;
            if (p.endsWith('/advance')) advances.push(await req.clone().json() as Record<string, any>);
            if (p.endsWith('/end')) ends.push(await req.clone().json() as Record<string, any>);
            return hostCall(req);
          },
          auth: (_m, _u, _b, secret) => ({ Authorization: `Bearer ${TOKENS['vm-a']}`, ...(secret ? { 'X-Runner-Secret': secret } : {}) }),
        }),
        home, repository: 'docs', hostname: 'vm-a', harness: 'opencode', capabilities: ['key:zai'],
        session: `b4-${Math.random().toString(16).slice(2, 8)}`, courses: [{ course: 'roadmap-pr', version: 3 }],
        stateFile, beatEvery: 150, log: () => {}, executor: linkingExecutor(LINK), signalGraceMs: 500,
      });
      r.start();
      const outcome = await r.runOnce(); // implement → review, review ends the claim done
      r.stop();
      expect(outcome).toMatchObject({ ticket: 'docs:A', end_reason: 'done', reached: 'reviewed' });

      // The first advance (which starts `implement`, finishing nothing) carries no link — none
      // is known before the session starts — and the advance that finishes it carries the
      // session's, as the end does for the claim's last run.
      expect(advances.map((a) => [a.leg, a.session_url])).toEqual([['implement', undefined], ['review', LINK]]);
      expect(ends).toEqual([expect.objectContaining({ end_reason: 'done', session_url: LINK })]);
      expect(await rows<{ leg: string; session_url: string | null }>('SELECT leg, session_url FROM claim_legs ORDER BY seq'))
        .toEqual([{ leg: 'implement', session_url: LINK }, { leg: 'review', session_url: LINK }]);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(stateFile, { force: true });
      rmSync(`${stateFile}.spool.jsonl`, { force: true });
    }
  }, 240_000);
});
