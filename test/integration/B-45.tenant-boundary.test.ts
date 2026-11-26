// R-BTN-135: the origin and handshake parts of S-BTN-111 and G-BTN-131 on both hosts.
import { expect, inject, it } from 'vitest';
import { config, tickHost } from '#host';
import { call, claimItem, claimRow, clearSetting, cutover, ORIGIN, payload, rawCall, register, rows, setClock, syncCall, syncToken } from '../helpers';
import { servedClientVersions, VERSIONS_HEADER } from '../../src/core/http';
import { clientVersionsValue } from '../../src/shared/versions.mjs';

const binding = () => rows("SELECT value FROM baton_settings WHERE key = 'tenant_id'");

it('refuses the foreign URL authority even when Host and proxy headers name the configured one', async () => {
  const token = await syncToken();
  const host = new URL(ORIGIN).host;
  const res = await rawCall(new Request('https://other.example/v1/sync/head', { headers: {
    Host: host, 'X-Forwarded-Host': host, Forwarded: `host=${host}`,
    Authorization: `Bearer ${token}`,
  } }));
  expect(res.status).toBe(404);
  expect(res.headers.get(VERSIONS_HEADER)).toBe(clientVersionsValue(servedClientVersions(config)));
  expect(await res.json()).toMatchObject({ code: 'not-found' });
  expect(await binding()).toEqual([]);
});

it('does not bind an empty store when its first alarm fires', async () => {
  await tickHost();
  expect(await binding()).toEqual([]);
});

it('reaps on the first post-upgrade alarm, before traffic binds the store (S-BTN-2)', async () => {
  const board = inject('board');
  const now = Date.parse('2099-01-01T00:00:00Z');
  await setClock(now);
  await syncCall('/v1/sync/board', payload(board.shas.A, null, board.states.A));
  await cutover();
  const runner = await register();
  const claim = await claimItem('vm-a', runner.secret, { ticket_id: 'docs:R3-9001' });
  expect(claim.status).toBe(200);
  // Represent storage as it was on the pre-handshake deployment, with a lease already live.
  await clearSetting('tenant_id');
  await clearSetting('tenant_handshake_required');
  await setClock(now + 900_000);
  await tickHost();
  expect(await binding()).toEqual([{ value: 'baton' }]);
  expect(await claimRow(claim.json.claim_id)).toMatchObject({ status: 'reaped', end_reason: 'reaped:silent' });
});

it('sets its own id even if the request brings a foreign id', async () => {
  const res = await call('/v1/sync/head', { headers: {
    Authorization: `Bearer ${await syncToken()}`, 'X-Baton-Tenant': 'another',
  } });
  expect(res.status).toBe(200);
  expect(await binding()).toEqual([{ value: 'baton' }]);
});
