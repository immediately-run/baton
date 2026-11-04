// link-spec-refs (B-180): a ticket's BATON_SPEC section citations become relative links into the
// spec bundle, each to the section's own file and Grove's anchor for its heading.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { headingId } from '@immediately-run/mdx-plugins';
import { rewrite, specTargets } from './link-spec-refs.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const PAGE = 'tickets/B-10.mdx';

// tickets/B-10.mdx as it was filed (before this rewrite ran on it): its frontmatter cut to the
// keys the rewrite must leave alone, and its body's Brief and Spec lines verbatim.
const B10 = [
  '---',
  'title: "B-10 — Prerequisites and blocks"',
  'id: B-10',
  'description: "Build BATON_SPEC §6.1 in core."',
  '---',
  '',
  '**Brief:** the owner, 2026-10-16 and 2026-10-17, as specified by B-1 (baton#43).',
  "**Spec:** `spec/BATON_SPEC.md` §6.1 (R-BTN-120), §5.6 (R-BTN-121), §6.2 (R-BTN-75's `ticket` and",
  "`capability` rows), §6.6 rules 1 and 4, §13.6's `ticket_blocks`; history, Migrations: the `ROLES`",
  'window.',
  '',
  '### Requires',
  '',
].join('\n');

/** The heading of `§n[.m]` as its section file has it, read straight from the file. */
function headingInFile(file, number) {
  const raw = readFileSync(join(ROOT, file), 'utf8');
  const line = raw.split('\n').find((l) => new RegExp(`^#{2,3} ${number.replace('.', '\\.')}[. ]`).test(l));
  return line.replace(/^#+ /, '').replace(/\*/g, '');
}

const links = (text) => [...text.matchAll(/\[(BATON_SPEC )?(§[\d.]+)\]\(([^)#]+)#([^)]+)\)/g)]
  .map((m) => ({ ref: m[2], path: m[3], anchor: m[4] }));

describe('link-spec-refs (B-180)', () => {
  const targets = specTargets(ROOT);

  it("turns B-10's Spec line into links whose files exist and whose anchors are Grove's for the heading", () => {
    const { text, linked, unmapped } = rewrite(B10, PAGE, targets);
    expect(unmapped).toEqual([]);
    const found = links(text);
    expect(found.map((l) => l.ref)).toEqual(['§6.1', '§5.6', '§6.2', '§6.6', '§13.6']);
    expect(linked.map((l) => l.ref)).toEqual(found.map((l) => l.ref));
    for (const l of found) {
      const file = join(dirname(join(ROOT, PAGE)), l.path);
      expect(existsSync(file), l.path).toBe(true);
      const rel = file.slice(ROOT.length + 1);
      expect(rel).toMatch(/^spec\/BATON_SPEC\/\d\d-[a-z0-9-]+\.md$/);
      expect(l.anchor).toBe(headingId(headingInFile(rel, l.ref.slice(1))));
    }
    expect(text).toContain('**Spec:** [BATON_SPEC §6.1](../spec/BATON_SPEC/06-prerequisites-blocks-advice.md#sec-6-1) (R-BTN-120), [§5.6](');
    expect(text).not.toContain('`spec/BATON_SPEC.md`');
    // The frontmatter and everything that is not a citation are as they were.
    expect(text.split('---\n')[1]).toBe(B10.split('---\n')[1]);
    expect(text).toContain('§6.6](../spec/BATON_SPEC/06-prerequisites-blocks-advice.md#sec-6-6) rules 1 and 4');
    expect(text).toContain("`ticket_blocks`; history, Migrations: the `ROLES`\nwindow.");
  });

  it('a second run changes nothing', () => {
    const once = rewrite(B10, PAGE, targets).text;
    const twice = rewrite(once, PAGE, targets);
    expect(twice.text).toBe(once);
    expect(twice.linked).toEqual([]);
  });

  it('reports a section the index does not list and leaves it as it is', () => {
    const page = B10.replace('§13.6\'s', '§99\'s');
    const { text, unmapped } = rewrite(page, PAGE, targets);
    expect(unmapped).toEqual([{ line: 9, ref: '§99' }]);
    expect(text).toContain("§99's `ticket_blocks`");
    expect(text).not.toContain('[§99]');
  });

  it("leaves a § that is another spec's, or comes before any BATON_SPEC citation, and code", () => {
    const page = [
      '---', 'title: T', 'description: D.', '---', '',
      'Per `REPO_CONTENT_DISPATCH_SPEC` §9, and §6.1 before any citation.',
      '',
      'BATON_SPEC §12.8 and §6.1, then BATON_MCP_OAUTH_SPEC §6; `BATON_SPEC §6.1` stays code.',
      '',
      '```',
      'BATON_SPEC §6.1',
      '```',
      '',
    ].join('\n');
    const { text } = rewrite(page, 'docs/context/x.mdx', targets);
    expect(text).toContain('Per `REPO_CONTENT_DISPATCH_SPEC` §9, and §6.1 before any citation.');
    expect(text).toContain('[BATON_SPEC §12.8](../../spec/BATON_SPEC/12-security.md#sec-12-8) and [§6.1](../../spec/BATON_SPEC/06-prerequisites-blocks-advice.md#sec-6-1), then BATON_MCP_OAUTH_SPEC §6;');
    expect(text).toContain('`BATON_SPEC §6.1` stays code.');
    expect(text).toContain('```\nBATON_SPEC §6.1\n```');
  });
});
