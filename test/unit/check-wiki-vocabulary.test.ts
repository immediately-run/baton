// check-wiki.mjs's component-vocabulary rule (B-114): a bundle that declares its own components
// is checked against them; a bundle that names a viewer app takes the whole vocabulary from that
// viewer, so the rule is off — except that a viewer-named bundle may not also keep a components
// map (the copy B-114 forbids). Node only: it runs the real script against throwaway bundles.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'check-wiki.mjs');

/** A one-page bundle with `marker` as its immediately.run.json; returns the script's result. */
function bundle(marker: Record<string, unknown>, page = '# Page\n\n<RoadmapBoard />\n'): { code: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'baton-wiki-'));
  try {
    writeFileSync(join(dir, 'immediately.run.json'), JSON.stringify(marker));
    writeFileSync(join(dir, 'home.mdx'), `---\ntitle: Home\ndescription: A page.\n---\n\n${page}`);
    try {
      const out = execFileSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8', stdio: 'pipe' });
      return { code: 0, out };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const WIKI = { kind: 'wiki' };

describe('check-wiki: the component vocabulary (B-114)', () => {
  it('a bundle with no viewer app fails an unregistered component, and a misspelling of a Grove one', () => {
    const plain = bundle({ ...WIKI, opensWith: { task: 'open-wiki', version: '1.0' } });
    expect(plain.code).toBe(1);
    expect(plain.out).toMatch(/<RoadmapBoard> is neither a Grove component nor registered/);
    const typo = bundle({ ...WIKI, opensWith: { task: 'open-wiki', version: '1.0' }, components: { RoadmapBoard: './components/RoadmapBoard.tsx' } }, '# Page\n\n<Calout>hi</Calout>\n');
    expect(typo.code).toBe(1);
    expect(typo.out).toMatch(/<Calout> is neither a Grove component/);
  });

  it('a bundle with its own components map accepts the names it lists', () => {
    const r = bundle({ ...WIKI, opensWith: { task: 'open-wiki', version: '1.0' }, components: { RoadmapBoard: './components/RoadmapBoard.tsx' } });
    expect(r.code).toBe(0);
  });

  it('a bundle naming a viewer app takes the viewer’s whole vocabulary — no local map, and the app’s names pass', () => {
    const r = bundle({ ...WIKI, opensWith: { app: 'github:immediately-run/baton-board', version: '^1' } });
    expect(r.code).toBe(0);
  });

  it('a bundle naming a viewer app AND keeping a components map is refused: a component belongs to the viewer', () => {
    const r = bundle({ ...WIKI, opensWith: { app: 'github:immediately-run/baton-board', version: '^1' }, components: { RoadmapBoard: './components/RoadmapBoard.tsx' } });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/names a viewer app \(opensWith\.app\) and a components map/);
  });
});
