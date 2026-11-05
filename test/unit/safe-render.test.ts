// R3-1340 — every page of a `render: safe` bundle parses under the safe renderer.
//
// A bundle whose root page declares `render: safe` (tickets/home.mdx, B-114) is rendered by Grove
// through the SDK's safe parser, which has no expression extension: `{/* … */}` is plain text there,
// and a `<Word>` written inside it is an unclosed tag. `parseSafeMdast` then rejects the file, and
// the page renders nothing (R3-1341). check-wiki.mjs compiles pages with @mdx-js, the other grammar,
// so it cannot see this; this test runs the renderer's own parser over every page of such a bundle
// — `.md` as well as `.mdx`, Grove's entry rule (`/\.mdx?$/`) — and over the "How tickets work" page
// `baton repo init` writes into every repository's items folder (an HTML comment there was rejected
// too). Node only: it reads the working tree.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { parseSafeMdast } from '@immediately-run/safe-content';
import { ticketsPage } from '../../src/defaults/tickets-page';

const ROOT = resolve(import.meta.dirname, '..', '..');

/** The frontmatter block Grove strips before it hands a page body to the parser. */
const FRONTMATTER = /^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/;

/** The bundle folders package.json's "immediately.run".content lists. */
function bundleFolders(): string[] {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { 'immediately.run'?: { content?: string[] } };
  return (pkg['immediately.run']?.content ?? []).map((d) => join(ROOT, d));
}

/** True when the bundle's root page declares `render: safe`, read the way Grove reads it: the
 *  frontmatter parsed as YAML, then `render === 'safe'` (so a quoted value counts too). */
function isSafe(dir: string): boolean {
  const home = join(dir, 'home.mdx');
  if (!existsSync(home)) return false;
  const block = readFileSync(home, 'utf8').match(FRONTMATTER)?.[0] ?? '';
  const meta = parseYaml(block.replace(/^\uFEFF?---\r?\n/, '').replace(/\r?\n---[ \t]*\r?\n?$/, '')) as { render?: unknown } | null;
  return meta?.render === 'safe';
}

/** Every page under `dir` — a `.md` or `.mdx` file, Grove's entry rule — archive/ included. */
function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'node_modules' ? [] : pages(p);
    return /\.mdx?$/.test(name) ? [p] : [];
  });
}

/** The parser's verdict on one page body: null when it parses, else its message. */
async function rejection(source: string): Promise<string | null> {
  try {
    await parseSafeMdast(source.replace(FRONTMATTER, ''));
    return null;
  } catch (e) {
    return String((e as Error).message ?? e);
  }
}

describe('render: safe bundles parse under the safe renderer (R3-1340)', () => {
  const safe = bundleFolders().filter(isSafe);

  it('finds the tickets bundle, so the walk below is not vacuous', () => {
    expect(safe.map((d) => relative(ROOT, d))).toContain('tickets');
  });

  it('rejects a `<Word>` inside a {/* */} comment — the shape this test exists to catch', async () => {
    expect(await rejection('{/*\n  <RoadmapMeta> renders only for tickets.\n*/}\n\n<GroveNav />\n')).toMatch(/closing tag/);
    expect(await rejection('{/* a plain comment */}\n\n# Title\n')).toBeNull();
    expect(await rejection('# Page\n\n<!-- an HTML comment -->\n')).toMatch(/Unexpected character/);
  });

  it('the walk includes `.md` pages (tickets/HOW-TICKETS-WORK.md is one)', () => {
    expect(safe.flatMap(pages).map((f) => relative(ROOT, f))).toContain(join('tickets', 'HOW-TICKETS-WORK.md'));
  });

  it('the "How tickets work" page baton repo init writes parses, for any repository', async () => {
    const page = ticketsPage({ items: 'tickets', ticket_prefix: 'B', legacy_ids: [], prefixes: { 'B-': '\\d+' }, tags: ['roadmap-item'], projects: 'projects' });
    expect(await rejection(page)).toBeNull();
  });

  it('every page of every render: safe bundle parses', async () => {
    const failures: string[] = [];
    for (const dir of safe) {
      for (const file of pages(dir)) {
        const why = await rejection(readFileSync(file, 'utf8'));
        if (why) failures.push(`${relative(ROOT, file)}: ${why}`);
      }
    }
    expect(failures, `pages the safe renderer rejects (they render blank):\n${failures.join('\n')}`).toEqual([]);
  });
});
