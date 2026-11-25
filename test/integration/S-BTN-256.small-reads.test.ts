// S-BTN-256 three small reads (B-217; BATON_SPEC §4.6 R-BTN-86, §5.2 R-BTN-69, §5.5 R-BTN-108,
// R-BTN-112, §5.6 R-BTN-121, §14): a ticket's children, the repository's courses, and the
// registry's schemas by id — each for the repository reads' principals and a session. Must
// hold:
//   1. `ticket.children` lists a parent's children, open with station and blocked, closed with
//      their closure, to a session as to a key, in the shape it had;
//   2. `repo.courses` returns each course's accepted file with its capability types and roles,
//      what the Courses view drew of it, and the refused newer version, the accepted staying;
//   3. `repo.schemas` returns `std:decision@1` and a posted course schema with its view, omits
//      an unknown id, refuses more than 50 ids and none at all, and answers the same body to
//      every caller of the repository;
//   4. each is `forbidden` on a repository the caller cannot read.
// Owner sessions do not exist yet (B-76). Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { adminSession, course, cutover, Git, keyCall, ORIGIN, sessionCall, setAdminKeys, setClock, withCore } from '../helpers';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';
import { call as hostCall } from '#host';
import { stdSchema } from '../../src/shared/std.mjs';

const T0 = Date.parse('2026-11-20T12:00:00Z');
const FINDINGS = {
  type: 'object', additionalProperties: false, properties: { open: { type: 'integer', minimum: 0 } }, required: ['open'],
  'x-baton-view': { title: 'findings', summary: '{/open} open', fields: [{ label: 'open', pointer: '/open', as: 'text' }] },
};
const digest = (c: string) => c.repeat(64);

let admin: TestKey;
let owner: TestKey;
let granted: TestKey;
let git: Git;
let cookie: string;

type Json = Record<string, any>;
async function read(key: TestKey, path: string) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const res = await hostCall(await signedRequest(key, ORIGIN + path, { created }));
  return { status: res.status, json: (await res.json()) as Json, text: '' };
}
async function session(path: string) {
  const res = await sessionCall(cookie, path);
  return { status: res.status, json: (await res.json()) as Json };
}

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'docs-owner');
  granted = await makeKey('ssh-ed25519', 'granted');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  expect((await keyCall(owner, '/v1/owner/docs/grants', { public_key: granted.publicKey, hostname: 'granted-host', capabilities: ['agent-venue'] })).status).toBe(200);
  git = new Git();
  git.registry = [course(3, 3, { schemas: [{ id: 'roadmap-pr:findings@2', digest: digest('a'), schema: FINDINGS }] })];
  git.add('P').add('C1', { parent: 'P' }).add('C2', { parent: 'P' }).add('OTHER');
  expect((await git.post()).status).toBe(200);
  await cutover(T0);
  cookie = await adminSession(admin);
});

describe('S-BTN-256 three small reads (B-217)', () => {
  it('ticket.children: a parent’s children with station and blocked, closed ones with their closure', async () => {
    const open = await session('/v1/repositories/docs/tickets/P/children');
    expect(open.status).toBe(200);
    expect(open.json).toEqual({ children: [
      { ticket_id: 'docs:C1', station: 'filed', blocked: false },
      { ticket_id: 'docs:C2', station: 'filed', blocked: false },
    ] });
    // A child closes: listed still, with how and when.
    expect((await git.close('C2', 'done').post()).status).toBe(200);
    const after = await session('/v1/repositories/docs/tickets/P/children');
    expect(after.json.children).toEqual([
      { ticket_id: 'docs:C1', station: 'filed', blocked: false },
      { ticket_id: 'docs:C2', station: null, blocked: false, closed: { as: 'done', closed_at: T0 } },
    ]);
    // The same answer to each of the repository's readers (R-BTN-179).
    for (const key of [owner, granted, admin]) expect((await read(key, '/v1/repositories/docs/tickets/P/children')).json).toEqual(after.json);
    expect((await session('/v1/repositories/docs/tickets/OTHER/children')).json).toEqual({ children: [] });
    expect((await session('/v1/repositories/docs/tickets/ops:P/children')).json.code).toBe('invalid-params');
    expect((await session('/v1/repositories/nope/tickets/P/children')).json.code).toBe('forbidden');
  });

  it('repo.courses: the accepted file with its types and roles, and the refused newer version', async () => {
    const first = await session('/v1/repositories/docs/courses');
    expect(first.status).toBe(200);
    const [c] = first.json.courses as Json[];
    expect(first.json.courses.length).toBe(1);
    expect(Object.keys(c).sort()).toEqual(['capability_types', 'file', 'id', 'intake', 'min_runner_version', 'queues', 'refused', 'roles', 'skill', 'version']);
    expect(c).toMatchObject({ id: 'roadmap-pr', version: 3, min_runner_version: 3, skill: 'next-roadmap-item', intake: 'open', refused: null });
    // The file as last accepted — the course the sync posted, whole.
    const posted = (course() as { course: Json }).course;
    expect(c.file).toEqual(posted);
    expect(c.capability_types).toEqual(posted.capability_types ?? {});
    expect(c.roles).toEqual(posted.capability_roles ?? {});
    expect(Array.isArray(c.queues)).toBe(true);

    // A newer version Baton refuses (a schema outside the subset): the accepted one stays in
    // force, and the refusal rides with it (R-BTN-69).
    git.registry = [course(4, 3, { schemas: [{ id: 'roadmap-pr:either@1', digest: digest('c'), schema: { oneOf: [{ type: 'string' }, { type: 'integer' }] } }] })];
    expect((await git.post()).status).toBe(200);
    const [after] = (await session('/v1/repositories/docs/courses')).json.courses as Json[];
    expect(after.version).toBe(3);
    expect(after.file).toEqual(posted);
    expect(after.refused).toMatchObject({ version: 4, refused_at: T0 });
    expect(after.refused.reason).toMatch(/oneOf/);
    expect(after.refused.violations[0]).toMatchObject({ rule: 'schema' });
    for (const key of [owner, granted, admin]) expect((await read(key, '/v1/repositories/docs/courses')).json.courses).toEqual([after]);
    expect((await session('/v1/repositories/nope/courses')).json.code).toBe('forbidden');
    expect((await read(await makeKey('ssh-ed25519', 'stranger'), '/v1/repositories/docs/courses')).status).toBe(401);
  });

  it('repo.schemas: the library’s and the course’s, each with its view; unknown ids absent; at most 50', async () => {
    const res = await session('/v1/repositories/docs/schemas?ids=std:decision@1,roadmap-pr:findings@2,roadmap-pr:nope@9,not%20an%20id');
    expect(res.status).toBe(200);
    expect(Object.keys(res.json)).toEqual(['schemas']);
    expect(Object.keys(res.json.schemas).sort()).toEqual(['roadmap-pr:findings@2', 'std:decision@1']);
    expect(res.json.schemas['std:decision@1']).toEqual(JSON.parse(JSON.stringify(stdSchema('std:decision@1'))));
    expect(res.json.schemas['roadmap-pr:findings@2']).toEqual(FINDINGS);
    expect(res.json.schemas['roadmap-pr:findings@2']['x-baton-view']).toEqual(FINDINGS['x-baton-view']);
    // The same bytes for every caller of the repository.
    const path = '/v1/repositories/docs/schemas?ids=std:decision@1,roadmap-pr:findings@2';
    const bodies = new Set<string>();
    bodies.add(await (await sessionCall(cookie, path)).text());
    for (const key of [owner, granted, admin]) {
      const created = Math.floor((await withCore((c) => c.now())) / 1000);
      const keyed = await hostCall(await signedRequest(key, ORIGIN + path, { created }));
      expect(keyed.status).toBe(200);
      bodies.add(await keyed.text());
    }
    expect(bodies.size).toBe(1);
    // Fifty ids are read; fifty-one, none and no parameter are the caller's error.
    const many = (n: number) => Array.from({ length: n }, (_, i) => `roadmap-pr:x@${i + 1}`).join(',');
    expect((await session(`/v1/repositories/docs/schemas?ids=${many(50)}`)).json).toEqual({ schemas: {} });
    expect((await session(`/v1/repositories/docs/schemas?ids=${many(51)}`)).json.code).toBe('invalid-params');
    expect((await session('/v1/repositories/docs/schemas')).json.code).toBe('invalid-params');
    expect((await session('/v1/repositories/docs/schemas?ids=')).json.code).toBe('invalid-params');
    expect((await session('/v1/repositories/nope/schemas?ids=std:decision@1')).json.code).toBe('forbidden');
  });
});
