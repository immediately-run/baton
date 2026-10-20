// S-BTN-66 entry requirements (BATON_SPEC §13a, §2m.2 R-BTN-109; B-3): `reviewed` requires
// `findings` of `roadmap-pr:findings@2`; a leg reaches it with no `findings`, then with an inline
// value, then with a pointer. Must hold: the first advance is refused, rule `entry`; the second is
// accepted and validated in full. The third is accepted here; the sync's posting it invalid, the
// `output-invalid` discrepancy and its consumer waiting on `input-missing` are B-53's (the sync's
// pointer check, after B-39's inputs). An end arriving there is held to the same entry.
// Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import roadmapPr from '../fixtures/courses/roadmap-pr/course.json';
import { advance, claimItem, course, cutover, endClaim, Git, placed, register, setClock } from '../helpers';

const T0 = Date.parse('2026-10-20T09:00:00Z');
const FINDINGS = { type: 'object', additionalProperties: false, properties: { open: { type: 'integer', minimum: 0 }, url: { type: 'string', maxLength: 256 } }, required: ['open'] };
const ENTRY = { ...roadmapPr, stations: { ...roadmapPr.stations, reviewed: { ...roadmapPr.stations.reviewed, entry: [{ output: 'findings', schema: 'roadmap-pr:findings@2' }] } } };
const AT_PR_OPEN = placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]);
const SHA = 'c'.repeat(40);
let git: Git;

beforeEach(async () => {
  await setClock(T0);
  git = new Git();
  git.registry = [course(3, 3, { course: ENTRY, schemas: [
    { id: 'roadmap-pr:findings@2', digest: 'a'.repeat(64), schema: FINDINGS },
    { id: 'roadmap-pr:notes@1', digest: 'b'.repeat(64), schema: { type: 'object', properties: { text: { type: 'string' } } } },
    { id: 'roadmap-pr:code@1', digest: 'c'.repeat(64), schema: { type: 'string', maxLength: 8, enum: Array.from({ length: 1500 }, (_, i) => `c${i}`) } },
    { id: 'roadmap-pr:codes@1', digest: 'd'.repeat(64), schema: { type: 'array', maxItems: 500, items: { $ref: 'roadmap-pr:code@1' } } },
  ] })];
  git.add('T-1', {}, AT_PR_OPEN).add('T-2', {}, AT_PR_OPEN);
  expect((await git.post()).status).toBe(200);
  await cutover();
});

async function reviewing(ticket: string) {
  const w = await register('vm-a');
  const { json: c } = await claimItem('vm-a', w.secret, { ticket_id: ticket });
  expect((await advance('vm-a', w.secret, c.claim_id, { leg: 'review' })).status).toBe(200);
  return { secret: w.secret, claim: c.claim_id as number };
}

describe('S-BTN-66 entry requirements', () => {
  it('an advance into reviewed: refused without findings, refused with an invalid value, accepted with a valid one', async () => {
    const { secret, claim } = await reviewing('docs:T-1');
    expect(await advance('vm-a', secret, claim, { reached: 'reviewed', leg: 'fix' }))
      .toMatchObject({ status: 409, json: { code: 'not-eligible', rule: 'entry', rule_code: 'entry' } });
    // Validated in full: a negative count fails the schema.
    const invalid = await advance('vm-a', secret, claim, { reached: 'reviewed', leg: 'fix', outputs: [{ name: 'findings', schema: 'roadmap-pr:findings@2', value: { open: -1 } }] });
    expect(invalid).toMatchObject({ status: 409, json: { code: 'not-eligible', rule: 'entry', rule_code: 'output-invalid' } });
    expect(invalid.json.message).toMatch(/\/open must be at least 0/);
    // The wrong schema, even a valid value of it, does not meet the requirement.
    expect((await advance('vm-a', secret, claim, { reached: 'reviewed', leg: 'fix', outputs: [{ name: 'findings', schema: 'std:url@1', value: { url: 'https://x.test/' } }] })).json)
      .toMatchObject({ code: 'not-eligible', rule: 'entry', rule_code: 'entry' });
    expect((await advance('vm-a', secret, claim, { reached: 'reviewed', leg: 'fix', outputs: [{ name: 'findings', schema: 'roadmap-pr:findings@2', value: { open: 2 } }] })).json)
      .toMatchObject({ ok: true, station: 'reviewed' });
  });

  it('a large valid value through the stored schemas is accepted: each schema read once per request (3-r3-1)', async () => {
    const { secret, claim } = await reviewing('docs:T-1');
    const codes = Array.from({ length: 500 }, (_, i) => `c${i % 1500}`);
    expect((await advance('vm-a', secret, claim, { reached: 'reviewed', leg: 'fix', outputs: [
      { name: 'findings', schema: 'roadmap-pr:findings@2', value: { open: 1 } }, { name: 'codes', schema: 'roadmap-pr:codes@1', value: codes },
    ] })).json).toMatchObject({ ok: true, station: 'reviewed' });
  });

  it('a pointer meets the requirement by name and schema; its contents are the sync\'s to check', async () => {
    const { secret, claim } = await reviewing('docs:T-1');
    expect((await advance('vm-a', secret, claim, { reached: 'reviewed', leg: 'fix', outputs: [{ name: 'findings', schema: 'roadmap-pr:findings@2', uri: `git:immediately-run/docs@${SHA}:reviews/T-1.json` }] })).json)
      .toMatchObject({ ok: true, station: 'reviewed' });
  });

  it('an end that finishes review at reviewed is held to the same entry; a release is not', async () => {
    const { secret, claim } = await reviewing('docs:T-2');
    expect((await endClaim('vm-a', secret, claim, { end_reason: 'suspended:reviewed', reached: 'reviewed', next: 'fix' })).json)
      .toMatchObject({ code: 'not-eligible', rule: 'entry' });
    expect((await endClaim('vm-a', secret, claim, { end_reason: 'suspended:reviewed', reached: 'reviewed', next: 'fix', outputs: [{ name: 'findings', schema: 'roadmap-pr:findings@2', value: { open: 0 } }] })).status)
      .toBe(200);
  });

  it('a runner that cannot meet the entry gives the leg up: released cannot-finish:contract-output, a failed attempt', async () => {
    const { secret, claim } = await reviewing('docs:T-2');
    expect((await endClaim('vm-a', secret, claim, { end_reason: 'released:cannot-finish:contract-output' })).status).toBe(200);
  });

  it('the envelope\'s shape is checked before anything else: one of uri and value, a bounded value, a digest off git', async () => {
    const { secret, claim } = await reviewing('docs:T-1');
    const outputsOf = async (outputs: unknown) => (await advance('vm-a', secret, claim, { reached: 'reviewed', leg: 'fix', outputs })).json;
    expect(await outputsOf([{ name: 'findings', schema: 'roadmap-pr:findings@2' }])).toMatchObject({ code: 'invalid-params' });
    expect(await outputsOf([{ name: 'findings', schema: 'roadmap-pr:findings@2', value: { open: 1 }, uri: `git:o/r@${SHA}:x` }])).toMatchObject({ code: 'invalid-params' });
    expect(await outputsOf([{ name: 'findings', schema: 'roadmap-pr:findings@2', value: { open: 1, url: 'x'.repeat(5000) } }])).toMatchObject({ code: 'invalid-params' });
    expect(await outputsOf([{ name: 'findings', schema: 'roadmap-pr:findings@2', uri: 'https://github.com/o/r/pull/1' }])).toMatchObject({ code: 'invalid-params' });
    expect(await outputsOf([{ name: 'findings', schema: 'findings.json', value: { open: 1 } }])).toMatchObject({ code: 'invalid-params' });
    // An inline value whose schema does not bound it is given by pointer instead (R-BTN-108).
    const notes = { name: 'notes', schema: 'roadmap-pr:notes@1', value: { text: 'short' } };
    expect(await outputsOf([notes, { name: 'findings', schema: 'roadmap-pr:findings@2', value: { open: 1 } }])).toMatchObject({ code: 'invalid-params' });
    expect(await outputsOf([{ name: 'notes', schema: 'roadmap-pr:notes@1', uri: `git:o/r@${SHA}:notes.md` }, { name: 'findings', schema: 'roadmap-pr:findings@2', value: { open: 1 } }]))
      .toMatchObject({ ok: true });
  });
});
