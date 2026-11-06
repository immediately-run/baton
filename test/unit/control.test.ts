// control.test.ts — B-126's pure half (BATON_SPEC §4.4 R-BTN-194): the control-input patterns
// and their matcher, the settings' list check, and the frontmatter fields a changed row is
// judged by. The store's half — the chain, the notice and the provenance — is S-BTN-204's, on
// both hosts.
import { describe, it, expect } from 'vitest';
import { CONTROL_PATTERNS, controlPattern, checkControlPaths, CONTROL_PATHS_MAX, isControlPath } from '../../src/core/control';
import { BatonError } from '../../src/core/http';

describe('the control-input patterns (B-126 item 1)', () => {
  it('every pattern is of the grammar and compiles', () => {
    for (const p of CONTROL_PATTERNS) expect(controlPattern(p)).not.toBeNull();
    expect(new Set(CONTROL_PATTERNS).size).toBe(CONTROL_PATTERNS.length);
  });

  it.each([
    ['.baton/baton.json', true], ['.baton/courses/create-pr/course.json', true], ['.baton', false],
    ['goals/q3.mdx', true], ['docs/goals/q3.mdx', true], ['goals.md', false],
    ['.github/workflows/baton-sync.yml', true], ['.github/workflows/deep/nested.yml', true], ['.github/CODEOWNERS', false],
    ['.claude/settings.json', true], ['.claude/skills/x/SKILL.md', true], ['CLAUDE.md', true], ['docs/AGENTS.md', true], ['README.md', false],
    ['.mcp.json', true], ['web/.mcp.json', true], ['.opencode/plugin/x.ts', true], ['opencode.json', true],
    ['package.json', true], ['web/app/package.json', true], ['package-lock.json', true], ['pnpm-lock.yaml', true],
    ['requirements.txt', true], ['requirements-dev.txt', true], ['pyproject.toml', true], ['poetry.lock', true],
    ['go.mod', true], ['go.sum', true], ['Cargo.lock', true], ['Gemfile.lock', true], ['composer.json', true],
    ['src/index.ts', false], ['tickets/B-1.mdx', false], ['docs/package.md', false],
  ])('%s is a control input: %s', (path, want) => {
    expect(isControlPath(path)).toBe(want);
  });

  it('the owners\u2019 added paths join the fixed list (R-BTN-66)', () => {
    expect(isControlPath('src/gen/schema.ts')).toBe(false);
    expect(isControlPath('src/gen/schema.ts', ['src/gen/**'])).toBe(true);
    expect(isControlPath('.github/CODEOWNERS', ['.github/CODEOWNERS'])).toBe(true);
  });

  it('a pattern\u2019s matcher: `**` spans directories, `*` and `?` stay within a segment', () => {
    expect(controlPattern('a/**/b')!.test('a/x/y/b')).toBe(true);
    expect(controlPattern('a/**/b')!.test('a/x/b')).toBe(true);
    expect(controlPattern('a/**/b')!.test('a/b')).toBe(true);
    expect(controlPattern('a/**/b')!.test('x/a/b')).toBe(false);
    expect(controlPattern('src/*.ts')!.test('src/a.ts')).toBe(true);
    expect(controlPattern('src/*.ts')!.test('src/a/b.ts')).toBe(false);
    expect(controlPattern('a?c')!.test('abc')).toBe(true);
    expect(controlPattern('a?c')!.test('a/c')).toBe(false);
    expect(controlPattern('x[0-9].y')!.test('x7.y')).toBe(true);
    expect(controlPattern('x[0-9].y')!.test('xa.y')).toBe(false);
    // Outside the grammar: no pattern, never a guess.
    expect(controlPattern('!skip/**')).toBeNull();
    expect(controlPattern('a b')).toBeNull();
    expect(controlPattern('')).toBeNull();
    expect(controlPattern(`x${'/'.repeat(201)}y`)).toBeNull();
  });
});

describe('control_paths as the settings carry it (R-BTN-66)', () => {
  it('takes at most 64 patterns of the grammar, none twice', () => {
    expect(checkControlPaths(['src/gen/**', '.github/CODEOWNERS'])).toEqual(['src/gen/**', '.github/CODEOWNERS']);
    expect(checkControlPaths([])).toEqual([]);
    expect(() => checkControlPaths('src/**')).toThrow(BatonError);
    expect(() => checkControlPaths(['!x'])).toThrow('control_paths');
    expect(() => checkControlPaths(Array.from({ length: CONTROL_PATHS_MAX + 1 }, (_, i) => `p${i}`))).toThrow(`${CONTROL_PATHS_MAX}`);
    expect(() => checkControlPaths(['a/**', 'a/**'])).toThrow('twice');
  });
});
