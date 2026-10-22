// S-BTN-65 refinement (BATON_SPEC §15, §5.5 R-BTN-108; B-3): a course schema refines
// `std:forge.change@1` but drops `head_sha` from `required`; a second keeps it; a leg reports a
// value missing `url` against the second. Must hold: the value fails both its schema and the base,
// and the leg ends `released:cannot-finish:contract-output`. (`baton course test` reporting the
// first, naming `required`, is the refinement check's — test/unit/schema.test.ts — and its place
// in the kit is B-52's.) Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import roadmapPr from '../fixtures/courses/roadmap-pr/course.json';
import { STD } from '../../src/shared/std.mjs';
import { advance, claimItem, claimRow, course, cutover, endClaim, Git, register, rows, setClock } from '../helpers';

const T0 = Date.parse('2026-10-20T09:00:00Z');
const base = STD['std:forge.change@1'];
// Keeps every required field of the base but url — the base still requires it.
const CHANGE = { ...base, 'x-baton-base': 'std:forge.change@1', required: ['repository', 'number', 'head_sha', 'state'] };
const ENTRY = { ...roadmapPr, stations: { ...roadmapPr.stations, 'pr-open': { ...roadmapPr.stations['pr-open'], entry: [{ output: 'change', schema: 'std:forge.change@1' }] } } };
let git: Git;

beforeEach(async () => {
  await setClock(T0);
  git = new Git();
  git.registry = [course(3, 3, { course: ENTRY, schemas: [{ id: 'roadmap-pr:change@1', digest: 'a'.repeat(64), schema: CHANGE }] })];
  git.add('T-1');
  expect((await git.post()).status).toBe(200);
  await cutover();
});

describe('S-BTN-65 refinement', () => {
  it('a value missing url fails the base though its refinement allows it; with url it meets the entry through its refinement', async () => {
    const w = await register('vm-a');
    const { json: c } = await claimItem('vm-a', w.secret, { ticket_id: 'docs:T-1' });
    expect((await advance('vm-a', w.secret, c.claim_id, { leg: 'implement' })).status).toBe(200);
    const value = { repository: 'immediately-run/docs', number: 12, head_sha: 'd'.repeat(40), state: 'open' };
    const refused = await advance('vm-a', w.secret, c.claim_id, { reached: 'pr-open', leg: 'review', outputs: [{ name: 'change', schema: 'roadmap-pr:change@1', value }] });
    expect(refused).toMatchObject({ status: 409, json: { code: 'not-eligible', rule: 'entry', rule_code: 'output-invalid' } });
    expect(refused.json.message).toMatch(/\/url is required/);
    expect((await advance('vm-a', w.secret, c.claim_id, { reached: 'pr-open', leg: 'review', outputs: [{ name: 'change', schema: 'roadmap-pr:change@1', value: { ...value, url: 'https://github.com/immediately-run/docs/pull/12' } }] })).json)
      .toMatchObject({ ok: true, station: 'pr-open' });
  });

  it('a leg that cannot meet it is given up: released cannot-finish:contract-output', async () => {
    const w = await register('vm-a');
    const { json: c } = await claimItem('vm-a', w.secret, { ticket_id: 'docs:T-1' });
    expect((await advance('vm-a', w.secret, c.claim_id, { leg: 'implement' })).status).toBe(200);
    // The runner gives the leg up (protocol.refusalKind): a failed attempt under the retry policy.
    expect((await endClaim('vm-a', w.secret, c.claim_id, { end_reason: 'released:cannot-finish:contract-output' })).status).toBe(200);
    expect(await claimRow(c.claim_id)).toMatchObject({ status: 'released', end_reason: 'released:cannot-finish:contract-output' });
    // A failed attempt (R-BTN-82, R-BTN-23): the default policy's first backoff, an hour.
    expect(await rows(`SELECT retry_after FROM ticket_overrides WHERE ticket_id = 'docs:T-1'`)).toEqual([{ retry_after: T0 + 3_600_000 }]);
  });
});
