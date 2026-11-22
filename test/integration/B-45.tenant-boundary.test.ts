// R-BTN-135: the origin and handshake parts of S-BTN-111 and G-BTN-131 on both hosts.
import { expect, it } from 'vitest';
import { call, ORIGIN, rawCall, rows, syncToken } from '../helpers';

const binding = () => rows("SELECT value FROM baton_settings WHERE key = 'tenant_id'");

it('refuses the foreign URL authority even when Host and proxy headers name the configured one', async () => {
  const token = await syncToken();
  const host = new URL(ORIGIN).host;
  const res = await rawCall(new Request('https://other.example/v1/sync/head', { headers: {
    Host: host, 'X-Forwarded-Host': host, Forwarded: `host=${host}`,
    Authorization: `Bearer ${token}`,
  } }));
  expect(res.status).toBe(404);
  expect(await res.json()).toMatchObject({ code: 'not-found' });
  expect(await binding()).toEqual([]);
});

it('sets its own id even if the request brings a foreign id', async () => {
  const res = await call('/v1/sync/head', { headers: {
    Authorization: `Bearer ${await syncToken()}`, 'X-Baton-Tenant': 'another',
  } });
  expect(res.status).toBe(200);
  expect(await binding()).toEqual([{ value: 'baton' }]);
});
