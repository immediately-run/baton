// S-BTN-106 a ticket's PRs in other repositories (BATON_SPEC §15 S-BTN-106, R-BTN-74, R-BTN-96,
// R-BTN-131; B-29, B-35): a repository whose ticket names two other repositories in `repos:` — its
// home (docs) gets no PR — syncs against a recorded GitHub. Must hold: the sync reads the home
// and the two repositories the live ticket names, and no other; the ticket is placed from their
// PRs; a verdict written on one PR moves the whole change to `reviewed`; one PR merged leaves it
// short of `merged`; both merged ends it. Node only: it writes a real repository and runs git.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { call as hostCall } from '#host';
import { initMain, parseSyncArgs, syncMain } from '../../src/defaults/cli';
import { ORIGIN, rows, setClock, syncToken } from '../helpers';
import { githubFake } from '../githubFake';

const T0 = Date.parse('2026-10-18T12:00:00Z');
let dir: string;
let minutes = 0;
const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
const commit = () => {
  git('add', '-A');
  git('commit', '--allow-empty', '-qm', 'step');
};

/** A recorded GitHub: each repository's PR list, and each read PR's detail. */
let github: Record<string, unknown> = {};
const asked: string[] = [];
const pull = (number: number, merged = false) => ({ number, head: { ref: 'claude/A-1-x', sha: `s${number}` }, state: merged ? 'closed' : 'open', merged_at: merged ? '2026-10-18T13:00:00Z' : null });
const detail = (repo: string, number: number, comments: unknown[] = []) => ({
  [`/repos/${repo}/commits/s${number}/check-runs`]: { check_runs: [{ conclusion: 'success' }] },
  [`/repos/${repo}/pulls/${number}/commits`]: [{ commit: { committer: { date: '2026-10-18T11:00:00Z' } } }],
  [`/repos/${repo}/pulls/${number}/reviews`]: [],
  [`/repos/${repo}/issues/${number}/comments`]: comments,
});
const verdict = { user: { login: 'baton' }, author_association: 'MEMBER', body: '<!-- baton:verdict approve -->\nbaton: docs:A-1 review', created_at: '2026-10-18T12:30:00Z' };

const sync = async () => {
  setClock(T0 + (minutes += 11) * 60_000);
  const token = await syncToken();
  const args = parseSyncArgs(['--root', dir, '--url', ORIGIN], {});
  await syncMain({ ...args, auth: () => ({ Authorization: `Bearer ${token}` }), transport: (req) => hostCall(req), log: () => {} });
};
const at = async () => (await rows<{ station: string; next_leg: string | null }>('SELECT station, next_leg FROM ticket_stations WHERE ticket_id = ?', 'docs:A-1'))[0];

beforeEach(async () => {
  minutes = 0;
  await setClock(T0);
  dir = mkdtempSync(join(tmpdir(), 'baton-s106-'));
  for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 's106@test'], ['config', 'user.name', 's106'], ['remote', 'add', 'origin', 'https://github.com/o/docs.git']]) git(...a);
  expect(await initMain([], { root: dir, log: () => {} })).toBe(0);
  mkdirSync(join(dir, 'tickets'), { recursive: true });
  writeFileSync(join(dir, 'tickets', 'a1.md'), '---\nid: A-1\ntitle: Change the site and the SDK\nrepos: [o/site, o/sdk]\n---\n');
  writeFileSync(join(dir, 'tickets', 'b1.md'), '---\nid: B-1\ntitle: Done long ago\nstatus: done\nrepos: [o/old]\n---\n');
  commit();
  process.env.GITHUB_TOKEN = 't';
  asked.length = 0;
  // REST lists, and the owned PRs' detail over GraphQL answered from the same routes (B-35).
  vi.stubGlobal('fetch', (url: string, init?: { body?: string }) => githubFake(github, asked)(url, init));
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GITHUB_TOKEN;
  rmSync(dir, { recursive: true, force: true });
});

describe('S-BTN-106 a ticket\'s PRs in other repositories', () => {
  it('reads the repositories the live ticket names, places it from their PRs, and reads them together as one change', async () => {
    github = { '/repos/o/docs/pulls?state=all': [], '/repos/o/site/pulls?state=all': [pull(3)], '/repos/o/sdk/pulls?state=all': [pull(3)], ...detail('o/site', 3), ...detail('o/sdk', 3) };
    await sync();
    expect(await at()).toMatchObject({ station: 'pr-open', next_leg: 'review' });
    // The home and the two repositories A-1 names — never the closed ticket's o/old.
    const repoOf = (k: string) => (k.startsWith('graphql ') ? k.split(' ')[1] : k.split('/').slice(2, 4).join('/'));
    expect([...new Set(asked.map(repoOf))].sort()).toEqual(['o/docs', 'o/sdk', 'o/site']);
    // Each owned PR's detail is one GraphQL query for its repository, never four REST reads (B-35).
    expect(asked.filter((k) => k.startsWith('graphql ')).sort()).toEqual(['graphql o/sdk 3', 'graphql o/site 3']);
    expect(asked.filter((k) => /\/(pulls|issues)\/3\/|\/check-runs/.test(k))).toEqual([]);

    // The review wrote its verdict line on the SDK's PR alone: the change is reviewed.
    github = { ...github, ...detail('o/sdk', 3, [verdict]) };
    await sync();
    expect(await at()).toMatchObject({ station: 'reviewed', next_leg: 'merge' });

    // The site's PR merged, the SDK's open: not yet merged.
    github = { ...github, '/repos/o/site/pulls?state=all': [pull(3, true)] };
    await sync();
    expect(await at()).toMatchObject({ station: 'reviewed', next_leg: 'merge' });

    // Both merged: the change is merged, the end station.
    github = { ...github, '/repos/o/sdk/pulls?state=all': [pull(3, true)] };
    await sync();
    expect(await at()).toMatchObject({ station: 'merged', next_leg: null });
  }, 120_000);
});
