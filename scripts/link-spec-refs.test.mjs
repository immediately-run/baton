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

const links = (text) => [...text.matchAll(/\[(BATON_SPEC )?(§[\d.]+|[RSG]-BTN-\d+)\]\(([^)#]+)#([^)]+)\)/g)]
  .map((m) => ({ ref: m[2], path: m[3], anchor: m[4] }));

// tickets/B-150.mdx's Spec line as filed: rule ids only, no `§`. R-BTN-173 is retired.
const B150 = [
  '---', 'title: "B-150"', 'description: "D."', '---', '',
  '**Spec:** `spec/BATON_SPEC.md` R-BTN-35, R-BTN-116, R-BTN-161, R-BTN-165, R-BTN-171, R-BTN-173.',
  '',
].join('\n');

// tickets/B-52.mdx's Spec line as filed: a code span with a `/` in the middle of the run.
const B52 = [
  '---', 'title: "B-52"', 'description: "D."', '---', '',
  "**Spec:** `spec/BATON_SPEC.md` §5.1 R-BTN-134 (`schemas/<name>@<n>.json` in the course directory); §5.5 R-BTN-108 (the static refinement check `baton course test` runs), R-BTN-109's last bullet (every `entry` schema posted; every arriving leg's contract can meet it), R-BTN-111 (a course's signature, `spawns` with `lifetime`); §5.7 (the test kit); §14 (`GET …/stats`); §15 S-BTN-65's kit half, S-BTN-80's signatures; `spec/BATON_SPEC_HISTORY.md`, \"Migrations the implementation still carries\": Legacy schema forms (R-BTN-108).",
  '',
].join('\n');

/** The index row (a section's or a subsection's) whose heading starts with `number`. */
function indexRow(number) {
  const index = readFileSync(join(ROOT, 'spec/BATON_SPEC.md'), 'utf8').split('\n');
  return index.find((l) => l.startsWith(`| | ${number} `) || l.includes(`| **${number}. `));
}

describe('link-spec-refs (B-180)', () => {
  const targets = specTargets(ROOT);

  it("turns B-10's Spec line into links whose files exist and whose anchors are Grove's for the heading", () => {
    const { text, linked, unmapped } = rewrite(B10, PAGE, targets);
    expect(unmapped).toEqual([]);
    const found = links(text);
    expect(found.map((l) => l.ref)).toEqual(['§6.1', 'R-BTN-120', '§5.6', 'R-BTN-121', '§6.2', 'R-BTN-75', '§6.6', '§13.6']);
    expect(linked.map((l) => l.ref)).toEqual(found.map((l) => l.ref));
    for (const l of found.filter((x) => x.ref.startsWith('§'))) {
      const file = join(dirname(join(ROOT, PAGE)), l.path);
      expect(existsSync(file), l.path).toBe(true);
      const rel = file.slice(ROOT.length + 1);
      expect(rel).toMatch(/^spec\/BATON_SPEC\/\d\d-[a-z0-9-]+\.md$/);
      expect(l.anchor).toBe(headingId(headingInFile(rel, l.ref.slice(1))));
    }
    expect(text).toContain('**Spec:** [BATON_SPEC §6.1](../spec/BATON_SPEC/06-prerequisites-blocks-advice.md#sec-6-1) ([R-BTN-120](../spec/BATON_SPEC/06-prerequisites-blocks-advice.md#sec-6-1)), [§5.6](');
    expect(text).not.toContain('`spec/BATON_SPEC.md`');
    // The frontmatter and everything that is not a citation are as they were.
    expect(text.split('---\n')[1]).toBe(B10.split('---\n')[1]);
    expect(text).toContain('§6.6](../spec/BATON_SPEC/06-prerequisites-blocks-advice.md#sec-6-6) rules 1 and 4');
    expect(text).toContain("`ticket_blocks`; history, Migrations: the `ROLES`\nwindow.");
  });

  it('a second run changes nothing', () => {
    for (const page of [B10, B150, B52]) {
      const once = rewrite(page, PAGE, targets).text;
      const twice = rewrite(once, PAGE, targets);
      expect(twice.text).toBe(once);
      expect(twice.linked).toEqual([]);
    }
  });

  it("links B-150's rule ids to the section the index defines each in, and drops the dead code span", () => {
    const { text, linked, unmapped } = rewrite(B150, 'tickets/B-150.mdx', targets);
    const found = links(text);
    expect(found.map((l) => l.ref)).toEqual(['R-BTN-35', 'R-BTN-116', 'R-BTN-161', 'R-BTN-165', 'R-BTN-171']);
    expect(linked.map((l) => l.ref)).toEqual(found.map((l) => l.ref));
    for (const l of found) {
      const rel = join('tickets', l.path).replace(/^spec/, 'spec');
      const file = join(ROOT, 'tickets', l.path);
      expect(existsSync(file), l.path).toBe(true);
      const heading = readFileSync(file, 'utf8').split('\n').map((x) => x.replace(/^#+ /, '').replace(/\*/g, ''))
        .find((h) => headingId(h) === l.anchor && /^\d/.test(h));
      expect(heading, `${l.ref} → ${rel}#${l.anchor}`).toBeTruthy();
      expect(indexRow(/^(\d+(?:\.\d+)?)/.exec(heading)[1])).toContain(l.ref);
    }
    // The retired rule is reported and stays plain; with the rest linked, the span is the name.
    expect(unmapped).toEqual([{ line: 6, ref: 'R-BTN-173' }]);
    expect(text).toContain('**Spec:** BATON_SPEC [R-BTN-35](../spec/BATON_SPEC/01-what-baton-is.md#sec-1), ');
    expect(text).toContain(', R-BTN-173.');
    expect(text).not.toContain('`spec/BATON_SPEC.md`');
  });

  it("goes on past a code span that names no spec (B-52's `schemas/…`), and stops at one that does", () => {
    const { text } = rewrite(B52, 'tickets/B-52.mdx', targets);
    expect(text).toContain('[§5.5](../spec/BATON_SPEC/05-courses.md#sec-5-5) [R-BTN-108](../spec/BATON_SPEC/05-courses.md#sec-5-5)');
    expect(text).toContain('[§15](../spec/BATON_SPEC/15-verification.md#sec-15) [S-BTN-65](../spec/BATON_SPEC/15-verification.md#scenarios)');
    expect(text).toContain('`spec/BATON_SPEC_HISTORY.md`, "Migrations the implementation still carries": Legacy schema forms (R-BTN-108).');
  });

  it('reports a section the index does not list and leaves it as it is', () => {
    const page = B10.replace("§13.6's", "§99's");
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
  it('renames a span only for the citation right after it: a second span in the paragraph stays (B-73)', () => {
    const page = [
      '---', 'title: T', 'description: D.', '---', '',
      '**Spec:** `spec/BATON_SPEC.md` R-BTN-35. Defining R-BTN-172 in `spec/BATON_SPEC.md` is what lets',
      'code cite it: `check-spec` reads only that file.',
      '',
    ].join('\n');
    const { text } = rewrite(page, 'tickets/B-73.mdx', targets);
    expect(text).toContain('**Spec:** BATON_SPEC [R-BTN-35](../spec/BATON_SPEC/01-what-baton-is.md#sec-1). Defining R-BTN-172 in `spec/BATON_SPEC.md` is what lets');
  });

  it('keeps a span that names the file, though a later sentence of the paragraph is linked', () => {
    const page = [
      '---', 'title: T', 'description: D.', '---', '',
      // docs/compared-to-gastown.mdx, its line 14 as filed, with a citation later in the paragraph.
      'durable execution. The rules referred to (`R-BTN-n`) are in `spec/BATON_SPEC/`; the index `spec/BATON_SPEC.md` names each one\'s file. What this',
      'page says comes from BATON_SPEC §6.1.',
      '',
      'Regenerate `spec/BATON_SPEC.md` with `npm run spec:index`; see BATON_SPEC §6.1.',
      '',
    ].join('\n');
    const { text } = rewrite(page, 'docs/compared-to-gastown.mdx', targets);
    expect(text).toContain("the index `spec/BATON_SPEC.md` names each one's file.");
    expect(text).toContain('Regenerate `spec/BATON_SPEC.md` with `npm run spec:index`; see [BATON_SPEC §6.1](../spec/BATON_SPEC/06-prerequisites-blocks-advice.md#sec-6-1).');
    expect(rewrite(text, 'docs/compared-to-gastown.mdx', targets).text).toBe(text);
  });
  it('the span that opens a **Spec:** line, after a **Brief:** line, is the spec name when what follows is linked (B-14)', () => {
    const page = [
      '---', 'title: T', 'description: D.', '---', '',
      '**Brief:** the owner, 2026-10-18.',
      '**Spec:** `spec/BATON_SPEC.md` §2m.6b (R-BTN-125), R-BTN-78, R-BTN-80 and R-BTN-103 as amended.',
      '',
    ].join('\n');
    const { text, unmapped } = rewrite(page, 'tickets/B-14.mdx', targets);
    expect(text).toContain('**Spec:** BATON_SPEC §2m.6b ([R-BTN-125](../spec/BATON_SPEC/07-conditions.md#sec-7-1)), R-BTN-78,');
    expect(unmapped.map((u) => u.ref)).toEqual(['§2m.6b', 'R-BTN-78', 'R-BTN-80', 'R-BTN-103']);
  });
});
