import { describe, expect, it } from 'vitest';
import { decodeMarkerField, gitPointer, pointerAllowed } from '../../src/core/contractPointers';
import { resolveInputs } from '../../src/core/contracts';
import { graphOf } from '../../src/core/graph';
import { checkOutputs } from '../../src/core/validate';

describe('S-BTN-48 contract resolution', () => {
  const graph = graphOf({ start: 'filed', start_leg: 'plan', end: ['done'], stations: { filed: {}, planned: {}, done: {} }, legs: {
    plan: { from: ['filed'], to: 'planned', version: 2 },
    take: { from: ['planned'], to: 'done', inputs: { artifact: { from: 'plan.artifact' }, optional: { from: 'plan.extra', required: false } } },
  } });
  const output = { run: 3, schema: 'std:url@1', uri: null, digest: null, value_json: '{"url":"https://example.test"}', leg_version: 2, course_version: 5 };

  it('uses the latest producer version, skipping absent optional inputs', () => {
    expect(resolveInputs(graph, 'take', () => undefined).wait).toBe('input-missing');
    expect(resolveInputs(graph, 'take', () => ({ ...output, leg_version: 1 })).wait).toBe('input-version');
    expect(resolveInputs(graph, 'take', (_leg, name) => name === 'artifact' ? output : undefined).inputs).toEqual([
      { name: 'artifact', schema: output.schema, from_leg: 'plan', from_run: 3, leg_version: 2, course_version: 5, value: { url: 'https://example.test' } },
    ]);
  });

  it('checks pointer shapes, digests and repository or owner bucket reach', () => {
    const root = `git:owner/repo@${'a'.repeat(40)}:`;
    for (const path of ['../a', 'a//b', '/a', 'a/./b', 'a/%2e%2e/b', 'a'.repeat(513)]) expect(gitPointer(root + path)).toBeNull();
    const reach = { git: ['owner/repo'], web: ['https://forge.test/owner/repo'], buckets: ['artifacts'] };
    expect(pointerAllowed(root + 'a/b.json', reach)).toBe(true);
    expect(pointerAllowed('https://forge.test/owner/repo-other/a', reach)).toBe(false);
    expect(pointerAllowed('s3://artifacts/a?versionId=1', reach)).toBe(true);
    expect(pointerAllowed('s3://foreign/a?versionId=1', reach)).toBe(false);
    expect(() => checkOutputs([{ name: 'artifact', schema: output.schema, uri: 's3://artifacts/a?versionId=1' }])).toThrow(/digest/);
  });

  it('decodes marker fields without accepting unescaped delimiters', () => {
    expect(decodeMarkerField('git%3Aowner%2Frepo%23blob%3Dabc')).toBe('git:owner/repo#blob=abc');
    for (const field of ['a b', 'a"b', '-->', '%ZZ']) expect(() => decodeMarkerField(field)).toThrow();
  });
});
