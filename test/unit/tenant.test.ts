import { expect, it, vi } from 'vitest';
import { acceptTenant, boundTenant, matchesAuthority, objectId, servesHost } from '../../src/shell/tenant';
import { ORIGIN, withCore } from '../helpers';

it('names the original object and any subordinate object in its own namespace', () => {
  const namespace = { idFromName: vi.fn((name: string) => name) };
  expect(objectId(namespace, 'baton')).toBe('baton');
  expect(objectId(namespace, 'baton', { kind: 'stream', key: 'run' })).toBe('baton/stream/run');
});

it('normalizes case and default ports but rejects a different or malformed authority', () => {
  const origin = new URL('https://baton.example');
  expect(servesHost(new Request('https://BATON.EXAMPLE:443/'), origin.href)).toBe(true);
  expect(servesHost(new Request('https://BATON.EXAMPLE:80/'), origin.href)).toBe(false);
  expect(matchesAuthority('BATON.EXAMPLE:443', origin)).toBe(true);
  for (const bad of [undefined, 'baton.example:80', 'x@baton.example', 'baton.example/path']) {
    expect(matchesAuthority(bad, origin)).toBe(false);
  }
});

it('refuses absent and foreign ids, including on the first request, without rebinding', async () => {
  await withCore(async ({ store }) => {
    const request = (id?: string) => new Request(ORIGIN, { headers: id ? { 'X-Baton-Tenant': id } : {} });
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const id of [undefined, 'another']) {
        const res = acceptTenant(store, request(id), 'baton');
        expect(res).toBeInstanceOf(Response);
        expect(await (res as Response).json()).toMatchObject({ code: 'forbidden' });
        expect(boundTenant(store)).toBeUndefined();
      }
      expect(acceptTenant(store, request('baton'), 'baton')).toBe('new');
      expect(acceptTenant(store, request('baton'), 'baton')).toBe('existing');
      expect(acceptTenant(store, request('another'), 'another')).toBeInstanceOf(Response);
      expect(boundTenant(store)).toBe('baton');
      expect(log.mock.calls).toEqual([['tenant-mismatch'], ['tenant-mismatch'], ['tenant-mismatch']]);
    } finally {
      log.mockRestore();
    }
  });
});
