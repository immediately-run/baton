// S-BTN-174 the create-spec course (BATON_SPEC §15 S-BTN-174, R-BTN-131, R-BTN-72, R-BTN-74; B-96):
// a fresh repository runs `baton repo init --course create-spec`, with one request. Must hold: the
// ticket starts at `requested` with `converse` queued and ready (a claim runs it: the owner's
// session); the claim suspends (`{ suspend: true, reached: 'requested', next: 'converse' }`) and
// the leg's `close` commits and pushes the marker line to `.baton/markers.jsonl`, so the next sync
// places the ticket at `requested` with `converse` waiting on the `owner` and never offers it again
// — the owner's session is one, not one per sync — and the path stays empty (a marker is no step of
// the graph: no `off-graph` is logged); the conversation's PR, on the course's branch pattern,
// places the ticket at `spec-open` with `review` ready (waiting on `ci` while its checks run); a
// `changes` verdict places `reviewed` with `address` ready, the round's suspension holds it waiting
// on the `owner` — a second sync does not re-offer it — and the push a round leaves sends it back
// to `spec-open`; once its three address rounds are spent, a round still asking for changes queues
// `adjudicate` rather than a fourth `address`, an `owner` adjudication waits on the owner and a
// `merge` one queues `merge`; an `approve` queues `merge`; and the merged PR is the end, `merged`.
// The runs mirror create-pr's (review 4, three address rounds): the fourth review is the one that
// finds the rounds spent, and it is reachable.
// Node only: it writes a real repository and runs git.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { call as hostCall } from '#host';
import { initMain, parseSyncArgs, syncMain } from '../../src/defaults/cli';
import type { PrFact } from '../../src/defaults/course-pr';
import { BUILT_INS } from '../../src/defaults/courses';
import { MARKERS_FILE, parseMarkers } from '../../src/defaults/course-markers';
import { prClose } from '../../src/defaults/pr-close';
import { ORIGIN, rows, setClock, syncToken } from '../helpers';

const T0 = Date.parse('2026-10-27T12:00:00Z');
// No --pin: the CLI pins its own commit, the one its courses' sources name (B-33).
const init = (root: string, ...argv: string[]) => initMain(argv, { root, log: () => {} });

class Repo {
  readonly dir = mkdtempSync(join(tmpdir(), 'baton-s174-'));
  facts: PrFact[] = [];
  constructor() {
    const g = (...a: string[]) => execFileSync('git', ['-C', this.dir, ...a], { encoding: 'utf8', stdio: 'ignore' });
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 's174@test');
    g('config', 'user.name', 's174 test');
    mkdirSync(join(this.dir, 'tickets'), { recursive: true });
  }
  write(path: string, text: string): void {
    writeFileSync(join(this.dir, path), text);
  }
  commit(): void {
    execFileSync('git', ['-C', this.dir, 'add', '-A'], { stdio: 'ignore' });
    execFileSync('git', ['-C', this.dir, 'commit', '--allow-empty', '-qm', 'step'], { stdio: 'ignore' });
  }
  git(...args: string[]): string {
    return execFileSync('git', ['-C', this.dir, ...args], { encoding: 'utf8' }).trim();
  }
  /** A leg's `close` as the stub calls it (B-96's review round 1): `prClose` writes the marker
   *  line from the leg's result, the ticket bare, commits that file alone and pushes it — the
   *  default branch, which is what the sync reads. The origin is this repository's own bare
   *  clone, so the push is a real one and its commit is what the next sync parses. */
  async close(leg: string, result: { reached: string; next: string | null }): Promise<void> {
    await prClose({ checkout: this.dir, ticket: { id: 'docs:SPEC-1', home: 'docs' }, leg, claim: { nonce: 'n1' } }, result);
  }
  /** The markers the checkout's default branch carries, as the sync parses them. */
  markers(): { ticket: string; leg: string; reached: string; next?: string | null; claim?: string | null }[] {
    return parseMarkers(readFileSync(join(this.dir, MARKERS_FILE), 'utf8'));
  }
  /** One sync: recorded facts, the harness's sync credential and the local host's transport. */
  async sync(): Promise<void> {
    const facts = join(this.dir, '.baton', 'facts.json');
    writeFileSync(facts, JSON.stringify(this.facts));
    const token = await syncToken();
    const args = parseSyncArgs(['--root', this.dir, '--url', ORIGIN, '--facts', facts], {});
    const log: string[] = [];
    const code = await syncMain({ ...args, auth: () => ({ Authorization: `Bearer ${token}` }), transport: (req) => hostCall(req), log: (l) => log.push(l) });
    if (code !== 0) throw new Error(`sync exited ${code}: ${log.join('\n')}`);
  }
}

let repo: Repo;
let minutes = 0;
/** Each sync takes an observation number; the next is refused until ten minutes pass (R-BTN-62). */
const later = () => setClock(T0 + (minutes += 11) * 60_000);
beforeEach(async () => {
  minutes = 0;
  await setClock(T0);
  repo = new Repo();
});
afterEach(() => rmSync(repo.dir, { recursive: true, force: true }));

type StationRow = { station: string; next_leg: string | null; next_source: string; path_len: number };
const stationOf = async (id: string): Promise<StationRow> => (await rows<StationRow>('SELECT station, next_leg, next_source, path_len FROM ticket_stations WHERE ticket_id = ?', `docs:${id}`))[0];
const nextOf = (id: string) => rows<{ leg: string; state: string; waiting_on: string | null }>('SELECT leg, state, waiting_on FROM ticket_next_legs WHERE ticket_id = ? ORDER BY leg', `docs:${id}`);
/** The board's own reading of the posted path: every step is an edge, or the sync logs `off-graph`
 *  (§2e). A marker is a signal, never a step, so none is ever logged for this ticket. */
const offGraph = (id: string) => rows<{ why: string }>(`SELECT json_extract(detail_json, '$.why') AS why FROM events WHERE ticket_id = ? AND kind = 'off-graph'`, `docs:${id}`);

/** The ticket's one spec request. */
const request = '---\nid: SPEC-1\ntitle: Specify the export format\ncourse: create-spec\n---\n\nWrite down what an export file must contain, so two implementations agree.\n';

/** One fact in the shape R-BTN-96's adapter records, on the course's branch pattern. */
function fact(state: PrFact['state'], checks: (string | null)[], reviews: PrFact['reviews'], pushes?: number[]): PrFact {
  return { number: 7, head: 'claude/SPEC-1-export-format', state, pushedAt: pushes?.at(-1) ?? reviews.at(-1)?.submittedAt ?? T0, ...(pushes ? { pushes } : {}), checks, reviews };
}
const verdict = (v: 'approve' | 'changes', at: number): PrFact['reviews'][number] =>
  ({ author: 'r1', state: 'COMMENTED', submittedAt: at, body: `<!-- baton:verdict ${v} -->` });
const adjudicated = (v: 'merge' | 'owner', at: number): PrFact['reviews'][number] =>
  ({ author: 'a1', state: 'COMMENTED', submittedAt: at, body: `<!-- baton:adjudicated ${v} -->` });

describe('S-BTN-174 the create-spec course', () => {
  it('converse suspends with its pair; the conversation’s PR advances the board; the address round-trip to merged', async () => {
    expect(await init(repo.dir, '--course', 'create-spec')).toBe(0);
    // A bare origin, so a leg's close can push the marker it writes — the branch the sync reads.
    const bare = mkdtempSync(join(tmpdir(), 'baton-s174-origin-'));
    try {
      execFileSync('git', ['clone', '-q', '--bare', repo.dir, bare], { stdio: 'ignore' });
      repo.git('remote', 'add', 'origin', bare);
      repo.write('tickets/spec-1.md', request);
      repo.commit();
      execFileSync('git', ['-C', repo.dir, 'push', '-q', 'origin', 'HEAD:main'], { stdio: 'ignore' });
      await repo.sync();

      // No PR, no marker: `requested`, `converse` queued and ready — a claim runs it, which is the
      // owner's design session.
      expect(await rows('SELECT id, course_id FROM tickets')).toEqual([{ id: 'docs:SPEC-1', course_id: 'create-spec' }]);
      expect(await stationOf('SPEC-1')).toMatchObject({ station: 'requested', next_leg: 'converse', next_source: 'course', path_len: 0 });
      expect(await nextOf('SPEC-1')).toEqual([{ leg: 'converse', state: 'ready', waiting_on: null }]);

      // A claim takes `converse`. Its stub prints the session's command and prompt and returns
      // `{ suspend: true, reached: 'requested', next: 'converse' }` (BUILT_INS): the claim ends at
      // `requested` and nothing else moves; the one record the leg leaves is its close's marker.
      const spec = BUILT_INS.find((b) => b.id === 'create-spec')!;
      const stub = new Function('answer', `return (${spec.legs.converse.position});`)(undefined) as { suspend: boolean; reached: string; next: string };
      expect(stub).toEqual({ suspend: true, reached: 'requested', next: 'converse' });
      await repo.close('converse', { reached: 'requested', next: 'review' });
      // The line the close wrote is the one `parseMarkers` reads back — the ticket bare, at the
      // station it opened, `review` queued — and the checkout's branch is level with the origin.
      expect(repo.markers()).toEqual([{ ticket: 'SPEC-1', leg: 'converse', reached: 'requested', next: 'review', claim: 'n1' }]);
      expect(repo.git('rev-parse', 'HEAD')).toBe(execFileSync('git', ['-C', bare, 'rev-parse', 'main'], { encoding: 'utf8' }).trim());

      // The marker is committed and pushed, the PR still is not: still `requested` with `converse`
      // queued, now waiting on the owner — and a second sync does not offer it again: one
      // conversation, not one per sync. The path stays empty: the marker is no step of the graph.
      await later();
      await repo.sync();
      expect(await stationOf('SPEC-1')).toMatchObject({ station: 'requested', next_leg: 'converse', next_source: 'course', path_len: 0 });
      expect(await nextOf('SPEC-1')).toEqual([{ leg: 'converse', state: 'waiting', waiting_on: 'owner' }]);
      await later();
      await repo.sync();
      expect(await stationOf('SPEC-1')).toMatchObject({ station: 'requested', next_leg: 'converse', path_len: 0 });
      expect(await nextOf('SPEC-1')).toEqual([{ leg: 'converse', state: 'waiting', waiting_on: 'owner' }]);
      expect(await offGraph('SPEC-1')).toEqual([]);

      // The conversation's work lands as a PR: `spec-open`, `review` queued — waiting on ci while
      // the head's checks run, ready once they finish.
      repo.facts = [fact('open', [null], [])];
      await later();
      await repo.sync();
      expect(await stationOf('SPEC-1')).toMatchObject({ station: 'spec-open', next_leg: 'review', next_source: 'course', path_len: 1 });
      expect(await nextOf('SPEC-1')).toEqual([{ leg: 'review', state: 'waiting', waiting_on: 'ci' }]);
      repo.facts = [fact('open', ['success'], [])];
      await later();
      await repo.sync();
      expect(await stationOf('SPEC-1')).toMatchObject({ station: 'spec-open', next_leg: 'review' });
      expect(await nextOf('SPEC-1')).toEqual([{ leg: 'review', state: 'ready', waiting_on: null }]);

      // A round asks for changes: `reviewed`, `address` queued — the owner's conversation, whose
      // claim ends with `{ suspend: true, reached: 'reviewed', next: 'address' }` (BUILT_INS).
      repo.facts = [fact('open', ['success'], [verdict('changes', T0 - 100)])];
      await later();
      await repo.sync();
      expect(await stationOf('SPEC-1')).toMatchObject({ station: 'reviewed', next_leg: 'address', path_len: 2 });
      expect(await nextOf('SPEC-1')).toEqual([{ leg: 'address', state: 'ready', waiting_on: null }]);
      const addressStub = new Function('answer', `return (${spec.legs.address.position});`)(undefined) as { suspend: boolean; reached: string; next: string };
      expect(addressStub).toEqual({ suspend: true, reached: 'reviewed', next: 'address' });

      // The round's claim ends and its close writes the round's marker: `address` waits on the
      // owner, and a second sync without a push does not re-offer it — one conversation per round,
      // not one per sync (B-96's review round 1). Nothing is pushed between rounds but the rounds'
      // own work, so the timeline still holds one `address` step while the markers hold one.
      await repo.close('address', { reached: 'reviewed', next: 'address' });
      expect(repo.markers().map((m) => [m.leg, m.reached])).toEqual([['converse', 'requested'], ['address', 'reviewed']]);
      await later();
      await repo.sync();
      expect(await stationOf('SPEC-1')).toMatchObject({ station: 'reviewed', next_leg: 'address', path_len: 2 });
      expect(await nextOf('SPEC-1')).toEqual([{ leg: 'address', state: 'waiting', waiting_on: 'owner' }]);
      await later();
      await repo.sync();
      expect(await nextOf('SPEC-1')).toEqual([{ leg: 'address', state: 'waiting', waiting_on: 'owner' }]);
      expect(await offGraph('SPEC-1')).toEqual([]);

      // The amendment is pushed: the timeline's `address` step catches the marker up, back to
      // `spec-open`, the next round ready. `pushes` is every commit's date, as R-BTN-96's adapter
      // reads it (the PR's base commit and each amendment), so a round's push is one more entry.
      repo.facts = [fact('open', ['success'], [verdict('changes', T0 - 100)], [T0 - 200, T0 - 50])];
      await later();
      await repo.sync();
      expect(await stationOf('SPEC-1')).toMatchObject({ station: 'spec-open', next_leg: 'review', path_len: 3 });
      expect(await nextOf('SPEC-1')).toEqual([{ leg: 'review', state: 'ready', waiting_on: null }]);
      repo.facts = [fact('open', ['success'], [verdict('changes', T0 - 100), verdict('changes', T0 - 40)], [T0 - 200, T0 - 50])];
      await later();
      await repo.sync();
      expect(await stationOf('SPEC-1')).toMatchObject({ station: 'reviewed', next_leg: 'address', path_len: 4 });
      expect(await nextOf('SPEC-1')).toEqual([{ leg: 'address', state: 'ready', waiting_on: null }]);
      await repo.close('address', { reached: 'reviewed', next: 'address' });
      await later();
      await repo.sync();
      expect(await nextOf('SPEC-1')).toEqual([{ leg: 'address', state: 'waiting', waiting_on: 'owner' }]);
      repo.facts = [fact('open', ['success'], [verdict('changes', T0 - 100), verdict('changes', T0 - 40)], [T0 - 200, T0 - 50, T0 - 30])];
      await later();
      await repo.sync();
      expect(await stationOf('SPEC-1')).toMatchObject({ station: 'spec-open', next_leg: 'review', path_len: 5 });

      // A third round asks for changes: `reviewed`, `address` queued.
      repo.facts = [fact('open', ['success'], [verdict('changes', T0 - 100), verdict('changes', T0 - 40), verdict('changes', T0 - 10)], [T0 - 200, T0 - 50, T0 - 30])];
      await later();
      await repo.sync();
      expect(await stationOf('SPEC-1')).toMatchObject({ station: 'reviewed', next_leg: 'address', path_len: 6 });
      expect(await nextOf('SPEC-1')).toEqual([{ leg: 'address', state: 'ready', waiting_on: null }]);
      await repo.close('address', { reached: 'reviewed', next: 'address' });
      repo.facts = [fact('open', ['success'], [verdict('changes', T0 - 100), verdict('changes', T0 - 40), verdict('changes', T0 - 10)], [T0 - 200, T0 - 50, T0 - 30, T0 - 5])];
      await later();
      await repo.sync();
      expect(await stationOf('SPEC-1')).toMatchObject({ station: 'spec-open', next_leg: 'review', path_len: 7 });

      // The fourth review round — the one the runs leave for exactly this — still asks for changes,
      // with all three address rounds spent: the board queues `adjudicate`, not a fourth `address`.
      const fourChanges = [verdict('changes', T0 - 100), verdict('changes', T0 - 40), verdict('changes', T0 - 10), verdict('changes', T0 - 3)];
      const kept = [T0 - 200, T0 - 50, T0 - 30, T0 - 5];
      repo.facts = [fact('open', ['success'], fourChanges, kept)];
      await later();
      await repo.sync();
      expect(await stationOf('SPEC-1')).toMatchObject({ station: 'reviewed', next_leg: 'adjudicate', path_len: 8 });
      expect(await nextOf('SPEC-1')).toEqual([{ leg: 'adjudicate', state: 'ready', waiting_on: null }]);

      // An adjudication that reproduces a finding waits on the owner; `merge` queues the merge.
      repo.facts = [fact('open', ['success'], [...fourChanges, adjudicated('owner', T0 - 1)], kept)];
      await later();
      await repo.sync();
      expect(await stationOf('SPEC-1')).toMatchObject({ station: 'adjudicated', next_leg: 'merge' });
      expect(await nextOf('SPEC-1')).toEqual([{ leg: 'merge', state: 'waiting', waiting_on: 'owner' }]);
      repo.facts = [fact('open', ['success'], [...fourChanges, adjudicated('merge', T0 - 1)], kept)];
      await later();
      await repo.sync();
      expect(await stationOf('SPEC-1')).toMatchObject({ station: 'adjudicated', next_leg: 'merge' });
      expect(await nextOf('SPEC-1')).toEqual([{ leg: 'merge', state: 'ready', waiting_on: null }]);

      // A fresh review approves: `reviewed` with `merge` ready — the stub queues it from the verdict.
      repo.facts = [fact('open', ['success'], [verdict('approve', T0 - 1)], [T0 - 200, T0 - 20])];
      await later();
      await repo.sync();
      expect(await stationOf('SPEC-1')).toMatchObject({ station: 'reviewed', next_leg: 'merge', path_len: 2 });
      expect(await nextOf('SPEC-1')).toEqual([{ leg: 'merge', state: 'ready', waiting_on: null }]);

      // Merged: the end.
      repo.facts = [fact('merged', ['success'], [verdict('approve', T0 - 1)], [T0 - 200, T0 - 20])];
      await later();
      await repo.sync();
      expect(await stationOf('SPEC-1')).toMatchObject({ station: 'merged', next_leg: null });
      expect(await nextOf('SPEC-1')).toEqual([]);
      expect(await offGraph('SPEC-1')).toEqual([]);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  }, 180_000);

  it('a conversation’s PR closed unmerged counts as none: the ticket waits on the owner, never re-offered', async () => {
    expect(await init(repo.dir, '--course', 'create-spec')).toBe(0);
    const bare = mkdtempSync(join(tmpdir(), 'baton-s174-origin-'));
    try {
      execFileSync('git', ['clone', '-q', '--bare', repo.dir, bare], { stdio: 'ignore' });
      repo.git('remote', 'add', 'origin', bare);
      repo.write('tickets/spec-1.md', request);
      repo.commit();
      execFileSync('git', ['-C', repo.dir, 'push', '-q', 'origin', 'HEAD:main'], { stdio: 'ignore' });
      await later();
      await repo.sync();
      await repo.close('converse', { reached: 'requested', next: 'review' });

      // A PR opens and its checks pass, then the owner closes it without merging — the marker is
      // closed, the round is not: the board reads no PR and the ticket waits on the owner.
      repo.facts = [fact('open', ['success'], [])];
      await later();
      await repo.sync();
      expect(await stationOf('SPEC-1')).toMatchObject({ station: 'spec-open' });
      repo.facts = [fact('closed', ['success'], [])];
      await later();
      await repo.sync();
      expect(await stationOf('SPEC-1')).toMatchObject({ station: 'requested', next_leg: 'converse', path_len: 0 });
      expect(await nextOf('SPEC-1')).toEqual([{ leg: 'converse', state: 'waiting', waiting_on: 'owner' }]);
      await later();
      await repo.sync();
      expect(await nextOf('SPEC-1')).toEqual([{ leg: 'converse', state: 'waiting', waiting_on: 'owner' }]);
      expect(await offGraph('SPEC-1')).toEqual([]);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  }, 120_000);
});
