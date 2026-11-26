// S-BTN-236 B-68's worker → runner dual-read window (BATON_SPEC §8.1 R-BTN-3/R-BTN-14,
// §5.7 R-BTN-22/R-BTN-65, §6.1–6.2): current and historical wire spellings work alike, while
// storage and replies use runner names. An old spelling records the last time that runner used
// one; disagreeing aliases are refused rather than guessed.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  call, course, Git, hbBody, HOST, payload, register, rows, runnerCall, setClock, syncCall, TOKENS,
  seedRunnerGrant,
} from '../helpers';

const T0 = Date.parse('2026-11-18T12:00:00Z');
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

beforeEach(async () => setClock(T0));

describe(`S-BTN-236 runner names (${HOST})`, () => {
  it('accepts both secret headers, records only the historical spelling, and replies with the temporary id alias', async () => {
    const runner = await register('vm-a');
    expect(runner.first).toMatchObject({ runner_id: runner.id, worker_id: runner.id });
    expect(await rows('SELECT legacy_names_at FROM runners WHERE id = ?', runner.id)).toEqual([{ legacy_names_at: null }]);

    const current = await runnerCall('/v1/runner/heartbeat', { cred: 'vm-a', secret: runner.secret, body: hbBody('vm-a') });
    expect(current.status).toBe(200);
    expect(await rows('SELECT legacy_names_at FROM runners WHERE id = ?', runner.id)).toEqual([{ legacy_names_at: null }]);

    await setClock(T0 + 1);
    const legacy = await call('/v1/runner/heartbeat', { method: 'POST', headers: {
      Authorization: `Bearer ${TOKENS['vm-a']}`, 'Content-Type': 'application/json', 'X-Worker-Secret': runner.secret,
    }, body: JSON.stringify(hbBody('vm-a')) });
    expect(legacy.status).toBe(200);
    expect(await rows('SELECT legacy_names_at FROM runners WHERE id = ?', runner.id)).toEqual([{ legacy_names_at: T0 + 1 }]);

    const differ = await call('/v1/runner/heartbeat', { method: 'POST', headers: {
      Authorization: `Bearer ${TOKENS['vm-a']}`, 'Content-Type': 'application/json',
      'X-Runner-Secret': runner.secret, 'X-Worker-Secret': 'different',
    }, body: JSON.stringify(hbBody('vm-a')) });
    expect([differ.status, (await differ.json() as { code: string }).code]).toEqual([400, 'invalid-params']);
  });

  it('accepts runner=me and worker=me alike, recording the old query spelling', async () => {
    expect((await new Git().add('T-404').post()).status).toBe(200);
    const runner = await register('vm-a');
    await seedRunnerGrant({ credential_id: 'vm-a', repository_id: 'docs', capabilities: '["agent-venue"]', granted_by: 'test', granted_at: T0 });
    const current = await runnerCall('/v1/repositories/docs/tickets/T-404/blocks?runner=me', { secret: runner.secret });
    const legacy = await runnerCall('/v1/repositories/docs/tickets/T-404/blocks?worker=me', { secret: runner.secret });
    expect(current.status).toBe(200);
    expect(legacy.status).toBe(current.status);
    expect(await legacy.json()).toEqual(await current.json());
    expect((await rows<{ legacy_names_at: number | null }>('SELECT legacy_names_at FROM runners WHERE id = ?', runner.id))[0].legacy_names_at).toBe(T0);
  });

  it('accepts min_worker_version beside min_runner_version, and refuses disagreement', async () => {
    const current = course();
    const { min_runner_version, ...rest } = current;
    const old = { ...rest, min_worker_version: min_runner_version };
    const first = await syncCall('/v1/sync/board', payload(A, null, { items: [], ready: [] }, { registry: [old] }));
    expect(first.status).toBe(200);
    expect(await rows('SELECT min_runner_version FROM courses WHERE repository_id = ? AND id = ?', 'docs', 'roadmap-pr'))
      .toEqual([{ min_runner_version }]);

    const conflict = await syncCall('/v1/sync/board', payload(B, A, { items: [], ready: [] }, {
      registry: [{ ...current, min_worker_version: min_runner_version - 1 }],
    }));
    expect([conflict.status, (await conflict.json() as { code: string }).code]).toEqual([400, 'invalid-params']);
  });
});
