// S-BTN-222 an interaction request (BATON_SPEC §15, §7.1 R-BTN-195, R-BTN-160, R-BTN-163,
// §7.5 R-BTN-90, §8.3 R-BTN-113; B-234), the API half, on both hosts: a run with a deadline and
// a stored session link raises `interact` — Baton sets the condition's url from the link it
// holds and ignores the runner's — then again in the same run; a binding of `interact` is
// ignored and no handler ticket filed; the condition is listed on Needs you and read by a
// delivery runner from `GET …/conditions?open=1&type=interact`; the second raise closes the
// first `superseded`, the run's end closes the last; a run with no link is refused; a link no
// session host allows is dropped, never refused; the claim's `deadline_s` arms
// `claims.deadline_at`, the alarm releases the claim at it `leg-timeout` and the run's open
// `interact` closes with it; a course file with `autonomous` beside a `conditions` list naming
// `hitl.x` is refused naming the leg. A subtype raise is an `interact` on both sides of the
// one-open-per-run rule (R-BTN-160's hierarchy), and §7.5's finishing half holds here too:
// `leg_finished` re-arms the armed deadline once per run, a still-pending `leg-timeout` release
// is withdrawn before the beat delivers it, and one already delivered stands. The runner half —
// the channel's raise checks, the joinable session's posted end, the finish beats and the
// unjoined one's `leg-timeout` — is S-BTN-222.runner-half.test.ts.
import { describe, it, expect, beforeEach } from 'vitest';
import roadmapPr from '../fixtures/courses/roadmap-pr/course.json';
import { advance, claimItem, course, cutover, endClaim, Git, keyCall, ORIGIN, placed, register, rows, setAdminKeys, setClock, tick, withCore, workerCall } from '../helpers';
import { beat } from '../helpers';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';
import { call as hostCall } from '#host';

const T0 = Date.parse('2026-11-14T09:00:00Z');
const MIN = 60_000;
const LINK = 'https://claude.ai/s/r_0000000000000000000000000';

/** The course: `implement` runs with a `deadline_s` (the file's `max_duration`), `review`
 * without one, and a course `suspend` type declared (`ask.owner`). */
const INTERACT = {
  ...roadmapPr,
  conditions: { 'ask.owner': { disposition: 'suspend', restarts: { retry: 'run it again', park: 'hold it' }, default: 'retry' } },
  legs: {
    ...roadmapPr.legs,
    implement: { ...roadmapPr.legs.implement, max_duration: 600 },
    review: { from: ['pr-open', 'fixed'], to: 'reviewed' }, // no deadline: the channel check's own refusal
  },
};

let owner: TestKey;
let reader: TestKey;
let git: Git;

/** `POST /v1/runner/claims/{id}/conditions` as the claiming worker. */
async function raise1(cred: 'vm-a' | 'vm-b', secret: string, claimId: number, body: Record<string, unknown>) {
  const res = await workerCall(`/v1/runner/claims/${claimId}/conditions`, { cred, secret, body });
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

/** `GET path`, signed by `key` (the delivery runner's reader grant, R-BTN-163). */
async function readAs(key: TestKey, path: string) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const res = await hostCall(await signedRequest(key, ORIGIN + path, { created }));
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

const conditionRows = () => rows<{ id: number; type: string; disposition: string; severity: string; url: string | null; outcome: string; closed_how: string | null; leg: string; run_id: string }>(
  'SELECT id, type, disposition, severity, url, outcome, closed_how, leg, run_id FROM conditions ORDER BY id');
const needsYou = () => withCore((core) => core.conditions.needsYou());

beforeEach(async () => {
  await setClock(T0);
  const admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'docs-owner');
  reader = await makeKey('ssh-ed25519', 'docs-reader');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  // R-BTN-163: the delivery runner's key — granted on docs, its tags barred, delivery courses
  // alone. The read needs the grant alone; nothing else is asked of it here.
  expect((await keyCall(owner, '/v1/owner/docs/grants', { public_key: reader.publicKey, hostname: 'docs-deliver', capabilities: ['agent-venue'] })).status).toBe(200);
  git = new Git().add('A');
  git.registry = [course(3, 3, { course: INTERACT })];
  expect((await git.post()).status).toBe(200);
  await cutover();
});

describe('S-BTN-222: an interaction request (R-BTN-195)', () => {
  it('a linked run raises interact: Baton\'s url is the stored session link, the runner\'s ignored; no handler is filed; it is listed; a second raise supersedes; the run\'s end closes it', async () => {
    const w = await register('vm-a');
    const { json: c } = await claimItem('vm-a', w.secret, { ticket_id: 'docs:A' });
    const a = await advance('vm-a', w.secret, c.claim_id, { leg: 'implement' });
    expect(a.status).toBe(200);
    // R-BTN-113: the link is reported on a heartbeat and kept on the run's row.
    expect((await beat('vm-a', w.secret, { session_url: LINK })).status).toBe(200);
    expect(await rows<{ session_url: string | null }>('SELECT session_url FROM claim_legs WHERE run_id = ?', a.json.run_id)).toEqual([{ session_url: LINK }]);

    // The raise's report — the body carrying a url of the runner's own and a binding's handler,
    // both ignored: `interact` is delivered from Baton's list, never through a ticket.
    const r1 = await raise1('vm-a', w.secret, c.claim_id, { type: 'interact', disposition: 'notify', url: 'https://runner.example/a-link-the-leg-made', handler: 'ask', severity: 'high' });
    expect(r1.status).toBe(200);
    expect(r1.json).toMatchObject({ ok: true, disposition: 'notify' });
    expect(r1.json.condition_id).toEqual(expect.any(Number));
    expect('handler_id' in r1.json).toBe(false);
    expect((await conditionRows()).map((x) => [x.type, x.url, x.outcome, x.severity])).toEqual([
      ['interact', LINK, 'open', 'high'], // the stored link, not the runner's; no subject or body anywhere
    ]);

    // Needs you lists it with its link (R-BTN-163), and the delivery runner reads the list
    // (R-BTN-195): the entry carries the ticket, the leg and the url, and no leg text.
    expect(await needsYou()).toEqual([expect.objectContaining({ ticket_id: 'docs:A', leg: 'implement', type: 'interact', url: LINK, run_id: a.json.run_id })]);
    const list = await readAs(reader, '/v1/repositories/docs/conditions?open=1&type=interact');
    expect(list.status).toBe(200);
    expect(list.json.conditions).toEqual([expect.objectContaining({ ticket_id: 'docs:A', leg: 'implement', url: LINK })]);

    // A second raise of the same run closes the open one `superseded` and opens the new.
    const r2 = await raise1('vm-a', w.secret, c.claim_id, { type: 'interact', disposition: 'notify' });
    expect(r2.status).toBe(200);
    expect((await conditionRows()).map((x) => [x.id, x.outcome, x.closed_how])).toEqual([
      [r1.json.condition_id, 'superseded', 'superseded'],
      [r2.json.condition_id, 'open', null],
    ]);

    // The run ends — the advance that finishes it closes the run's open `interact`.
    expect((await advance('vm-a', w.secret, c.claim_id, { reached: 'pr-open', leg: 'review' })).status).toBe(200);
    expect((await conditionRows()).map((x) => x.outcome)).toEqual(['superseded', 'closed']);
    expect(await needsYou()).toEqual([]);
    // The delivery runner's list is empty with it, and it alone: the reader stays granted.
    expect((await readAs(reader, '/v1/repositories/docs/conditions?open=1&type=interact')).json.conditions).toEqual([]);
    expect((await readAs(reader, '/v1/repositories/docs/conditions?open=1')).json.conditions).toEqual([]);
  });

  it('a run with no stored link is refused; a link no session host allows is dropped, never a refused beat; baton and unknown types are refused', async () => {
    const w = await register('vm-a');
    const { json: c } = await claimItem('vm-a', w.secret, { ticket_id: 'docs:A' });
    expect((await advance('vm-a', w.secret, c.claim_id, { leg: 'implement' })).status).toBe(200);

    // No link stored: the report is refused, nothing recorded.
    const none = await raise1('vm-a', w.secret, c.claim_id, { type: 'interact', disposition: 'notify' });
    expect(none.status).toBe(400);
    expect(none.json.code).toBe('invalid-params');
    expect(await conditionRows()).toEqual([]);

    // A link whose host the instance does not allow (R-BTN-113: `session_hosts`, claude.ai the
    // default) is dropped and logged — the beat answers 200 and says so.
    const dropped = await beat('vm-a', w.secret, { session_url: 'https://sessions.example/not-allowed' });
    expect(dropped.status).toBe(200);
    expect(dropped.json.session_url_dropped).toContain('sessions.example');
    expect(await rows<{ session_url: string | null }>('SELECT session_url FROM claim_legs WHERE claim_id = ?', c.claim_id)).toEqual([{ session_url: null }]);
    expect((await rows(`SELECT 1 FROM events WHERE kind = 'discrepancy' AND json_extract(detail_json, '$.sub') = 'session-url'`)).length).toBe(1);
    // A link over the bound is dropped the same way, never refused.
    expect((await beat('vm-a', w.secret, { session_url: `https://claude.ai/${'x'.repeat(600)}` })).status).toBe(200);

    // The runner-check refusals the core holds too: baton is core's alone; an unknown type is
    // neither standard nor declared.
    expect((await raise1('vm-a', w.secret, c.claim_id, { type: 'baton.retries', disposition: 'notify' })).json.code).toBe('invalid-params');
    expect((await raise1('vm-a', w.secret, c.claim_id, { type: 'unheard-of', disposition: 'notify' })).json.code).toBe('invalid-params');
    // The heartbeat carried a good link meanwhile: hitl records open (unbound: the debugger's,
    // R-BTN-163), an unbound notify only records, and a suspend's url is kept only under
    // R-BTN-92's link bases — one outside them is dropped, never refused.
    expect((await beat('vm-a', w.secret, { session_url: LINK })).status).toBe(200);
    expect((await raise1('vm-a', w.secret, c.claim_id, { type: 'hitl', disposition: 'suspend', url: 'https://example.com/not-a-base', restarts: { retry: 'again' } })).status).toBe(200);
    expect((await raise1('vm-a', w.secret, c.claim_id, { type: 'warning', disposition: 'notify' })).status).toBe(200);
    expect((await conditionRows()).map((x) => [x.type, x.disposition, x.outcome, x.url])).toEqual([
      ['hitl', 'suspend', 'open', null], // not under a link base of the ticket: not kept
      ['warning', 'notify', 'recorded', null], // an unbound notify is only recorded (R-BTN-160)
    ]);
  });

  it('the claim\'s deadline arms, clears, releases the holder at it (leg-timeout), and the run\'s open interact closes with the end', async () => {    const w = await register('vm-a');
    const { json: c } = await claimItem('vm-a', w.secret, { ticket_id: 'docs:A' });
    expect((await advance('vm-a', w.secret, c.claim_id, { leg: 'implement' })).status).toBe(200); // max_duration 600
    expect(await rows<{ deadline_at: number | null }>('SELECT deadline_at FROM claims WHERE id = ?', c.claim_id)).toEqual([{ deadline_at: T0 + 600_000 }]);

    // The ask is open when the deadline takes the claim back.
    expect((await beat('vm-a', w.secret, { session_url: LINK })).status).toBe(200);
    expect((await raise1('vm-a', w.secret, c.claim_id, { type: 'interact', disposition: 'notify' })).status).toBe(200);

    await setClock(T0 + 601_000);
    await tick(); // R-BTN-90: the alarm queues the holder a release with reason leg-timeout
    expect((await rows(`SELECT 1 FROM events WHERE kind = 'leg-timeout' AND claim_id = ?`, c.claim_id)).length).toBe(1);
    const beat1 = await beat('vm-a', w.secret, {});
    expect(beat1.json.messages).toEqual([expect.objectContaining({ kind: 'release', payload: { ticket_id: 'docs:A', reason: 'leg-timeout', deadline_at: T0 + 600_000 } })]);

    // The runner ends the claim as the release says; a deadline end is a failed attempt and
    // closes the run's open interact (the unjoined ask's own end).
    expect((await endClaim('vm-a', w.secret, c.claim_id, { end_reason: 'released:leg-timeout', reached: 'filed', next: 'implement' })).status).toBe(200);
    expect(await rows<{ status: string; end_reason: string; deadline_at: number | null }>('SELECT status, end_reason, deadline_at FROM claims WHERE id = ?', c.claim_id))
      .toEqual([{ status: 'released', end_reason: 'released:leg-timeout', deadline_at: null }]);
    expect((await conditionRows()).map((x) => [x.type, x.outcome, x.closed_how])).toEqual([['interact', 'closed', 'run-ended']]);
    expect(await withCore((core) => core.claims.failedAttempts('docs:A').length)).toBe(1);

    // A leg with no deadline leaves the claim unarmed; the next advance into one re-arms it.
    const second = await claimItem('vm-b', (await register('vm-b')).secret, { ticket_id: 'docs:A' });
    expect(second.status).toBe(409); // the backoff holds the ticket off (a failed attempt)
  });

  it('a subtype raise is an interact (R-BTN-160: the dots form the hierarchy): it supersedes the run\'s open one, is superseded, and closes at its run\'s end', async () => {
    const w = await register('vm-a');
    const { json: c } = await claimItem('vm-a', w.secret, { ticket_id: 'docs:A' });
    expect((await advance('vm-a', w.secret, c.claim_id, { leg: 'implement' })).status).toBe(200);
    expect((await beat('vm-a', w.secret, { session_url: LINK })).status).toBe(200);
    // One open `interact` per run (R-BTN-195), whatever side of the dots the raises fall: each
    // raise — subtype or plain — closes the open one before it records its own.
    expect((await raise1('vm-a', w.secret, c.claim_id, { type: 'interact', disposition: 'notify' })).status).toBe(200);
    expect((await raise1('vm-a', w.secret, c.claim_id, { type: 'interact.review', disposition: 'notify' })).status).toBe(200);
    expect((await raise1('vm-a', w.secret, c.claim_id, { type: 'interact', disposition: 'notify' })).status).toBe(200);
    expect((await raise1('vm-a', w.secret, c.claim_id, { type: 'interact.x', disposition: 'notify' })).status).toBe(200);
    expect((await conditionRows()).map((x) => [x.type, x.outcome, x.closed_how])).toEqual([
      ['interact', 'superseded', 'superseded'],
      ['interact.review', 'superseded', 'superseded'], // the subtype raise closed the plain one…
      ['interact', 'superseded', 'superseded'], // …and was closed by the plain raise after it
      ['interact.x', 'open', null],
    ]);
    // The delivery runner's poll (type=interact) and Needs you carry the run's one open ask.
    expect((await needsYou()).map((x) => x.type)).toEqual(['interact.x']);
    expect((await readAs(reader, '/v1/repositories/docs/conditions?open=1&type=interact')).json.conditions).toEqual([
      expect.objectContaining({ type: 'interact.x', url: LINK }),
    ]);
    // The run's end closes the open one, a subtype like any interact.
    expect((await advance('vm-a', w.secret, c.claim_id, { reached: 'pr-open', leg: 'review' })).status).toBe(200);
    expect((await conditionRows()).map((x) => x.outcome)).toEqual(['superseded', 'superseded', 'superseded', 'closed']);
  });

  it('§7.5 R-BTN-90: leg_finished re-arms the armed deadline once per run, and a still-pending leg-timeout release is withdrawn before the beat delivers it', async () => {
    // The clock crosses 40 minutes while the run's finishing holds the claim: a lease wide
    // enough that no alarm in that window reads the holder silent (the fake clock sits behind
    // the real one on the Workers host, so a background alarm may tick at any moved instant).
    const alive = { lease_timeout_s: 3600 };
    const w = await register('vm-a', alive);
    const { json: c } = await claimItem('vm-a', w.secret, { ticket_id: 'docs:A' });
    const a = await advance('vm-a', w.secret, c.claim_id, { leg: 'implement' });
    expect(a.status).toBe(200);
    expect(a.json.seq).toBe(1); // the advance names the run it started: its claim_legs.seq
    expect(await rows<{ deadline_at: number | null }>('SELECT deadline_at FROM claims WHERE id = ?', c.claim_id)).toEqual([{ deadline_at: T0 + 600_000 }]);

    // The script returned inside its deadline: the finish beat re-arms to now + 40 minutes,
    // once per leg run — a repeated beat (a retry) and one naming no running run change nothing.
    await setClock(T0 + 60_000);
    expect((await beat('vm-a', w.secret, { ...alive,  leg_finished: 1 })).status).toBe(200);
    expect(await rows<{ deadline_at: number | null }>('SELECT deadline_at FROM claims WHERE id = ?', c.claim_id)).toEqual([{ deadline_at: T0 + 60_000 + 40 * MIN }]);
    expect((await beat('vm-a', w.secret, { ...alive,  leg_finished: 1 })).status).toBe(200);
    expect((await beat('vm-a', w.secret, { ...alive,  leg_finished: 9 })).status).toBe(200);
    expect(await rows<{ deadline_at: number | null }>('SELECT deadline_at FROM claims WHERE id = ?', c.claim_id)).toEqual([{ deadline_at: T0 + 60_000 + 40 * MIN }]);
    expect(await rows<{ n: number }>('SELECT COUNT(*) AS n FROM claim_legs WHERE claim_id = ? AND seq = 1 AND deadline_rearmed_at IS NOT NULL', c.claim_id)).toEqual([{ n: 1 }]);

    // The original instant passes while the close still runs (the runner beating on): no
    // release — the run finished inside its own clock, and finishing is not the end.
    await setClock(T0 + 601_000);
    await tick();
    expect((await rows(`SELECT 1 FROM events WHERE kind = 'leg-timeout'`)).length).toBe(0);
    expect((await beat('vm-a', w.secret, { ...alive, })).json.messages).toEqual([]);

    // The re-armed instant passes the same way: the release the alarm queues is still pending
    // when the run's (late, retried) finish beat lands — withdrawn before that beat delivers
    // anything, so the finishing run is never failed at an instant it beat.
    await setClock(T0 + 60_000 + 40 * MIN - 500);
    expect((await beat('vm-a', w.secret, { ...alive, })).status).toBe(200); // alive at the instant
    await setClock(T0 + 60_000 + 40 * MIN + 1_000);
    await tick();
    const beat1 = await beat('vm-a', w.secret, { ...alive,  leg_finished: 1 });
    expect(beat1.status).toBe(200);
    expect(beat1.json.messages).toEqual([]); // withdrawn first, delivered never
    expect(await rows<{ status: string; withdrawn: string | null }>(`SELECT status, withdrawn FROM messages WHERE kind = 'release' AND json_extract(payload_json, '$.ticket_id') = 'docs:A'`))
      .toEqual([{ status: 'expired', withdrawn: 'leg-finished' }]);
    const evs = await rows<{ d: string }>(`SELECT detail_json AS d FROM events WHERE kind = 'leg-timeout' AND claim_id = ? ORDER BY seq`, c.claim_id);
    expect(evs.map((e) => (JSON.parse(e.d) as { withdrawn?: boolean }).withdrawn === true)).toEqual([false, true]);
    expect(await rows<{ deadline_at: number | null }>('SELECT deadline_at FROM claims WHERE id = ?', c.claim_id)).toEqual([{ deadline_at: null }]); // spent, not re-armed

    // The claim lives on: the advance that finishes the run starts the next leg free of the
    // spent release — nothing stops it later — and the undeadlined review leaves the claim unarmed.
    expect((await advance('vm-a', w.secret, c.claim_id, { reached: 'pr-open', leg: 'review' })).status).toBe(200);
    expect((await beat('vm-a', w.secret, { ...alive, })).json.messages).toEqual([]);
    expect(await rows<{ deadline_at: number | null }>('SELECT deadline_at FROM claims WHERE id = ?', c.claim_id)).toEqual([{ deadline_at: null }]);
  });

  it('§7.5 R-BTN-90: a leg-timeout release already delivered stands — leg_finished withdraws only what is still pending', async () => {
    const alive = { lease_timeout_s: 3600 }; // as above: the clock crosses minutes at a leap
    expect((await git.add('B').post()).status).toBe(200);
    const w = await register('vm-a', alive);
    const { json: c } = await claimItem('vm-a', w.secret, { ticket_id: 'docs:B' });
    expect((await advance('vm-a', w.secret, c.claim_id, { leg: 'implement' })).status).toBe(200);
    await setClock(T0 + 590_000);
    expect((await beat('vm-a', w.secret, { ...alive, })).status).toBe(200); // alive at the instant
    await setClock(T0 + 601_000);
    await tick(); // the alarm queues the release
    // A beat without the finish word delivers it; only then does the script return.
    const beat1 = await beat('vm-a', w.secret, { ...alive, });
    expect(beat1.json.messages).toEqual([expect.objectContaining({ kind: 'release', payload: { ticket_id: 'docs:B', reason: 'leg-timeout', deadline_at: T0 + 600_000 } })]);
    const beat2 = await beat('vm-a', w.secret, { ...alive,  leg_finished: 1 });
    expect(beat2.json.messages).toEqual([expect.objectContaining({ kind: 'release' })]); // still delivered, resent
    expect(await rows<{ status: string; withdrawn: string | null }>(`SELECT status, withdrawn FROM messages WHERE kind = 'release' AND json_extract(payload_json, '$.ticket_id') = 'docs:B'`))
      .toEqual([{ status: 'delivered', withdrawn: null }]);
    expect(await rows<{ deadline_at: number | null }>('SELECT deadline_at FROM claims WHERE id = ?', c.claim_id)).toEqual([{ deadline_at: null }]);
    expect((await rows(`SELECT 1 FROM events WHERE kind = 'leg-timeout' AND json_extract(detail_json, '$.withdrawn') = 1`)).length).toBe(0);
    // The delivered release ends the claim as §6.5 says: a failed attempt.
    expect((await endClaim('vm-a', w.secret, c.claim_id, { end_reason: 'released:leg-timeout', reached: 'filed', next: 'implement' })).status).toBe(200);
    expect(await rows<{ failed_attempt: number }>('SELECT failed_attempt FROM claims WHERE id = ?', c.claim_id)).toEqual([{ failed_attempt: 1 }]);
  });

  it('past twenty open conditions on a claim the report is refused quota', async () => {
    const w = await register('vm-a');
    const { json: c } = await claimItem('vm-a', w.secret, { ticket_id: 'docs:A' });
    expect((await advance('vm-a', w.secret, c.claim_id, { leg: 'implement' })).status).toBe(200);
    expect((await beat('vm-a', w.secret, { session_url: LINK })).status).toBe(200);
    for (let i = 0; i < 20; i++) {
      expect((await raise1('vm-a', w.secret, c.claim_id, { type: 'hitl', disposition: 'suspend', severity: i === 0 ? 'critical' : 'normal' })).status).toBe(200);
    }
    const past = await raise1('vm-a', w.secret, c.claim_id, { type: 'hitl', disposition: 'suspend' });
    expect(past.status).toBe(429);
    expect(past.json.code).toBe('quota');
    // Needs you orders by severity, then age (R-BTN-163): the critical ask first.
    expect((await needsYou()).map((x) => x.severity)).toEqual(['critical', ...Array<string>(19).fill('normal')]);
  });

  it('a course file with autonomous beside a conditions list naming hitl.x is refused naming the leg', async () => {
    const bad = {
      ...INTERACT,
      legs: { ...INTERACT.legs, autonomous: { from: ['reviewed'], to: 'merged', autonomous: true, conditions: ['hitl.x'], max_runs: 1 } },
    };
    git.registry = [course(4, 4, { course: bad })];
    expect((await git.post()).status).toBe(200); // the post stands; the course is refused, the previous in force
    const refusals = await withCore((core) => core.courses.refusals());
    expect(refusals).toEqual([expect.objectContaining({ course_id: 'roadmap-pr' })]);
    expect(JSON.stringify(refusals[0].violations)).toContain('legs.autonomous.autonomous');
    expect(JSON.stringify(refusals[0].violations)).toContain('hitl.x');
    expect(JSON.stringify(refusals[0].violations)).toContain('R-BTN-195');
  });
});
