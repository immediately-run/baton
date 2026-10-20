// S-BTN-79 schemas refused (BATON_SPEC §13a, §2m.2 R-BTN-108; B-3): a sync posts
// `roadmap-pr:findings@2` again with a changed digest; a schema using `oneOf`; one whose `pattern`
// has a back-reference; two that `$ref` each other; a `std:object@1` of its own; another
// repository posts its own `roadmap-pr:findings@2`. Must hold: the first four are refused with the
// course file, which stays as it was, and listed under Needs you; the `std:` post is refused; the
// other repository's schema is accepted, keyed to it. (The spec's course `roadmap` is docs'
// `roadmap-pr` here, the fixture's.) Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { course, cutover, Git, keyCall, rows, setAdminKeys, setClock, syncToken } from '../helpers';
import { makeKey } from '../lib/sshKeys';

const T0 = Date.parse('2026-10-20T09:00:00Z');
const FINDINGS = { type: 'object', additionalProperties: false, properties: { open: { type: 'integer', minimum: 0 } }, required: ['open'] };
const digest = (c: string) => c.repeat(64);
const posted = (schemas: unknown[], version = 4) => [course(version, 3, { schemas })];
let git: Git;

const refusal = async () => (await rows<{ course_id: string; violations: string }>(`SELECT course_id, violations FROM course_refusals WHERE repository_id = 'docs'`))
  .map((r) => ({ course: r.course_id, messages: (JSON.parse(r.violations) as { rule: string; message: string }[]).map((v) => `${v.rule}: ${v.message}`) }));
const held = async (repo = 'docs') => rows<{ id: string; digest: string }>('SELECT id, digest FROM course_schemas WHERE repository_id = ? ORDER BY id', repo);
const version = async () => (await rows<{ version: number }>(`SELECT version FROM courses WHERE repository_id = 'docs' AND id = 'roadmap-pr'`))[0].version;

beforeEach(async () => {
  await setClock(T0);
  git = new Git();
  git.registry = posted([{ id: 'roadmap-pr:findings@2', digest: digest('a'), schema: FINDINGS }], 3);
  git.add('T-1');
  expect((await git.post()).status).toBe(200);
  await cutover();
  expect(await held()).toEqual([{ id: 'roadmap-pr:findings@2', digest: digest('a') }]);
});

describe('S-BTN-79 schemas refused', () => {
  it.each([
    ['a held version posted with a changed digest', [{ id: 'roadmap-pr:findings@2', digest: digest('b'), schema: { ...FINDINGS, description: 'changed' } }], /immutable/],
    ['a schema using oneOf', [{ id: 'roadmap-pr:either@1', digest: digest('c'), schema: { oneOf: [{ type: 'string' }, { type: 'integer' }] } }], /"oneOf" is outside the subset/],
    ['a pattern with a back-reference', [{ id: 'roadmap-pr:twice@1', digest: digest('d'), schema: { type: 'string', pattern: '(a)\\1' } }], /back-reference/],
    ['two schemas that $ref each other', [
      { id: 'roadmap-pr:a@1', digest: digest('e'), schema: { $ref: 'roadmap-pr:b@1' } },
      { id: 'roadmap-pr:b@1', digest: digest('f'), schema: { $ref: 'roadmap-pr:a@1' } },
    ], /cycle/],
    ['a std: id of its own', [{ id: 'std:object@1', digest: digest('0'), schema: { type: 'object' } }], /std: schemas come only from Baton's library/],
    ['another course\'s prefix', [{ id: 'chore:x@1', digest: digest('1'), schema: { type: 'object' } }], /only its own schemas/],
  ])('%s: refused with the course file, which stays as it was, and listed under Needs you', async (_what, schemas, why) => {
    git.registry = posted(schemas);
    expect((await git.post()).status).toBe(200);
    expect(await version()).toBe(3);
    const [r] = await refusal();
    expect(r.course).toBe('roadmap-pr');
    expect(r.messages.some((m) => m.startsWith('schema: ') && why.test(m))).toBe(true);
    // Nothing of the refused post is stored.
    expect(await held()).toEqual([{ id: 'roadmap-pr:findings@2', digest: digest('a') }]);
  });

  it('the same version posted again with its digest is kept; a new version is added; the course moves on', async () => {
    git.registry = posted([{ id: 'roadmap-pr:findings@2', digest: digest('a'), schema: FINDINGS }, { id: 'roadmap-pr:findings@3', digest: digest('9'), schema: { ...FINDINGS, 'x-baton-base': 'roadmap-pr:findings@2' } }]);
    expect((await git.post()).status).toBe(200);
    expect(await refusal()).toEqual([]);
    expect(await version()).toBe(4);
    expect(await held()).toEqual([{ id: 'roadmap-pr:findings@2', digest: digest('a') }, { id: 'roadmap-pr:findings@3', digest: digest('9') }]);
  });

  it('another repository\'s roadmap-pr:findings@2 is its own: accepted, keyed to it', async () => {
    const admin = await makeKey('ssh-ed25519', 'admin');
    await setAdminKeys(admin);
    expect((await keyCall(admin, '/v1/admin/repositories', { id: 'ops', github: 'immediately-run/ops', default_branch: 'main',
      sync_workflow: '.github/workflows/baton-sync.yml', owner_keys: [(await makeKey('ssh-ed25519', 'ops-owner')).publicKey] })).status).toBe(200);
    const ops = new Git(await syncToken({ repository: 'immediately-run/ops', job_workflow_ref: 'immediately-run/ops/.github/workflows/baton-sync.yml@refs/heads/main' }));
    ops.registry = posted([{ id: 'roadmap-pr:findings@2', digest: digest('b'), schema: { ...FINDINGS, description: 'ops' } }], 3);
    ops.add('O');
    expect((await ops.post()).status).toBe(200);
    expect(await held('ops')).toEqual([{ id: 'roadmap-pr:findings@2', digest: digest('b') }]);
    expect(await held('docs')).toEqual([{ id: 'roadmap-pr:findings@2', digest: digest('a') }]);
  });

  it('a course file naming a schema nobody posted is refused too', async () => {
    const { default: roadmapPr } = await import('../fixtures/courses/roadmap-pr/course.json');
    const named = { ...roadmapPr, stations: { ...roadmapPr.stations, reviewed: { ...roadmapPr.stations.reviewed, entry: [{ output: 'findings', schema: 'roadmap-pr:findings@7' }] } } };
    git.registry = [course(4, 3, { course: named })];
    expect((await git.post()).status).toBe(200);
    expect((await refusal())[0].messages).toEqual(['schema: roadmap-pr:findings@7 is not posted, held or in the std: library']);
  });
});
