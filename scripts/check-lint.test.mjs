import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: resolve(import.meta.dirname, '..') });

async function rules(filePath, source) {
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages.map((message) => message.ruleId);
}

describe('ESLint policy (B-282)', () => {
  it('rejects a direct clock read in core, not in a test clock fixture (R-BTN-32)', async () => {
    expect(await rules('src/core/example.ts', "Date.now(); Date['now']();")).toEqual(['no-restricted-syntax', 'no-restricted-syntax']);
    expect(await rules('test/unit/example.test.ts', 'Date.now();')).toEqual([]);
  });

  it('rejects markup APIs, explicit any, loose equality, var and unreassigned let', async () => {
    expect(await rules('src/dashboard/example.tsx', 'el.innerHTML; el["innerHTML"]; <div dangerouslySetInnerHTML={x} />;')).toEqual([
      'no-restricted-syntax', 'no-restricted-syntax', 'no-restricted-syntax',
    ]);
    expect(await rules('src/core/example.ts', 'var x: any; let y = 1; x == y;')).toEqual([
      'no-var', '@typescript-eslint/no-explicit-any', 'prefer-const', 'eqeqeq',
    ]);
  });

  it('requires directory-specific names, but accepts scenario and component names', async () => {
    expect(await rules('src/core/bad-name.ts', '')).toEqual(['baton/file-name']);
    expect(await rules('src/defaults/badName.ts', '')).toEqual(['baton/file-name']);
    expect(await rules('test/integration/S-BTN-31.two-hosts.test.ts', '')).toEqual([]);
    expect(await rules('src/dashboard/screens/GoodName.tsx', '')).toEqual([]);
  });
});
