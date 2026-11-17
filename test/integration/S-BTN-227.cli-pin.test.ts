// S-BTN-227 the runner says when its CLI is not a pinned commit (BATON_SPEC §15's scenario
// table; §8.3 R-BTN-72; B-253): the profile half of the rule, on both hosts. The runner's own
// heartbeat carries `profile` with its CLI's pinning under `cli: {commit, ref, pinned}` —
// stored opaque on the runner (§13.3's `profile_json`), shown on the Workers view, the latest
// beat winning — and nothing gates on it: an unpinned runner's claim is taken like any other.
// A malformed profile is refused as any malformed field is (`invalid-params`), never the
// runner: a beat that fails changes nothing. The start line and the reading of the CLI's own
// checkout are the runner half, on real git, in test/unit/runner-clipin.test.ts and
// test/unit/runner-main.test.ts's probe (Node only).
import { describe, it, expect, beforeEach } from 'vitest';
import { beat, claimItem, cutover, Git, placed, register, rows, setClock, withCore } from '../helpers';

const T0 = Date.parse('2026-11-17T12:00:00Z');
const ON_BRANCH = { cli: { commit: '5ff20c853a83d698bc5456317d46b2cf1435e8bb', ref: 'main', pinned: false } };
const AT_TAG = { cli: { commit: 'a7f8d9e0c1b2a3f4a5b6c7d8e9f0a1b2c3d4e5f6', ref: 'v0.1.3', pinned: true } };

const profileOf = async (id: number) =>
  (await rows<{ profile_json: string | null }>('SELECT profile_json FROM workers WHERE id = ?', id))[0].profile_json;

beforeEach(async () => {
  await setClock(T0);
  await new Git().add('R-1', {}, placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']])).post();
  await cutover();
});

describe('S-BTN-227 the runner\'s profile says how its CLI is pinned (B-253)', () => {
  it('a heartbeat\'s profile.cli is stored opaque on the runner and shown on the Workers view, latest wins', async () => {
    const w = await register('vm-a', { profile: ON_BRANCH });
    expect(JSON.parse((await profileOf(w.id))!)).toEqual(ON_BRANCH);
    // The owner's runner screen reads the same statement, parsed, from the Workers view.
    const state = await withCore((c) =>
      (c as unknown as { workers: { workersView: (now: number) => Record<string, unknown>[] } }).workers.workersView(c.now()));
    const mine = state.find((x) => x.id === w.id);
    expect(mine?.profile).toEqual(ON_BRANCH);
    // A later beat's profile replaces it — the runner's current word, never an accumulation.
    const { status } = await beat('vm-a', w.secret, { profile: AT_TAG });
    expect(status).toBe(200);
    expect(JSON.parse((await profileOf(w.id))!)).toEqual(AT_TAG);
  });

  it('a runner that sends no profile keeps none — NULL until a heartbeat carries one', async () => {
    const w = await register('vm-a');
    expect(await profileOf(w.id)).toBeNull();
    const { status } = await beat('vm-a', w.secret, { profile: ON_BRANCH });
    expect(status).toBe(200);
    expect(JSON.parse((await profileOf(w.id))!)).toEqual(ON_BRANCH);
  });

  it('a malformed profile is refused as a field, never the runner — the stored one stands', async () => {
    const w = await register('vm-a', { profile: ON_BRANCH });
    for (const bad of ['a string', { of: 'x'.repeat(5000) }, ['an', 'array']]) {
      const { status, json } = await beat('vm-a', w.secret, { profile: bad });
      expect(status).toBe(400);
      expect(json.code).toBe('invalid-params');
      expect(json.message).toContain('profile');
    }
    expect(JSON.parse((await profileOf(w.id))!)).toEqual(ON_BRANCH);
    // The refused beats cost the runner nothing: its next beat lands.
    const { status: ok } = await beat('vm-a', w.secret);
    expect(ok).toBe(200);
  });

  it('an unpinned runner claims a ready ticket — nothing gates on the field', async () => {
    const w = await register('vm-a', { profile: ON_BRANCH });
    const { status, json } = await claimItem('vm-a', w.secret);
    expect(status).toBe(200);
    expect(json.ticket_id).toBe('docs:R-1');
    expect(typeof json.claim_id).toBe('number');
  });
});
