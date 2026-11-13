// source-gate.test.ts — Decision 6a (B-193), the gate as tests: the source tree passes, a
// fixture carrying any refused API fails, and the built bundle answers the origin rule alone
// (§12.3, G-BTN-13 — react-dom itself contains `innerHTML`).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MARKUP_APIS, gateBundle, gateSource, readDashboardSource } from './sourceGate';

describe('the dashboard source gate (Decision 6a, §12.3)', () => {
  it('passes on the tree: no markup-parsing API, nothing from another origin', () => {
    const files = readDashboardSource();
    expect(files.map((f) => f.name)).toContain('main.tsx');
    expect(files.flatMap((f) => gateSource(f.name, f.text))).toEqual([]);
  });

  it.each(MARKUP_APIS.map(([label]) => label))('refuses a fixture containing %s', (label) => {
    expect(gateSource('fixture.tsx', `const out = use(${label});\n`)).toEqual(['fixture.tsx:1: ' + label]);
  });

  it('refuses a fixture with a remote src, and one with a remote import', () => {
    expect(gateSource('fixture.tsx', '<img src="https://evil.example/x.png" />\n')).toEqual(['fixture.tsx:1: src']);
    expect(gateSource('fixture.ts', "import x from 'https://evil.example/x.js';\n")).toEqual(['fixture.ts:1: import']);
  });
});

describe('the dashboard bundle origin rule (§12.3)', () => {
  it('passes on the built bundle', () => {
    const bundle = readFileSync(resolve(import.meta.dirname, '../../src/dashboard/dist/app.js'), 'utf8');
    expect(gateBundle('dist/app.js', bundle)).toEqual([]);
  });

  it('refuses a fixture with a remote src', () => {
    expect(gateBundle('fixture.js', 'el.src = "https://evil.example/x.js";\n')).toEqual(['fixture.js:1: src']);
  });
});
