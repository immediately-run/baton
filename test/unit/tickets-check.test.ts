// tickets-check.test.ts — `baton tickets check` and its parts (B-111, BATON_SPEC R-BTN-74,
// §4.4): a repository's ticket source read as `baton repo sync` reads it, and what a sync would
// refuse found before it posts — the source's own throw (a duplicate id, an unknown `repos` name,
// an `order` that is not a number), the board post's validation (the core's `checkPayload`, a
// dependency cycle among them), a `depends_on` naming nothing here, and, for the markdown source
// behind `check.depends_line`, each body's `**Depends on:**` line against its `depends_on`. Node
// only, with real fixture repositories: an ejected `.baton/tickets.mjs` is imported by path.
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bodyDependencies, checkPayload, dependsCycle } from '../../src/core/board';

import { checkTickets, checkTicketsMain, dependsLine } from '../../src/defaults/tickets-check';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** A ticket file's text: frontmatter fields and a body. */
const ticket = (fm: string, body = ''): string => `---\ntitle: A ticket\n${fm}\n---\n\n${body}`;

/** A fixture repository: git, `.baton/baton.json`, and the ticket files given, `path → text`. */
function repo(files: Record<string, string>, settings: Record<string, unknown> = {}, { git = true } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'baton-b111-'));
  dirs.push(dir);
  if (git) {
    execFileSync('git', ['init', '-q', '-b', 'main', dir], { stdio: 'ignore' });
    execFileSync('git', ['-C', dir, 'config', 'user.email', 't@t'], { stdio: 'ignore' });
    execFileSync('git', ['-C', dir, 'config', 'user.name', 't'], { stdio: 'ignore' });
  }
  mkdirSync(join(dir, '.baton'), { recursive: true });
  writeFileSync(join(dir, '.baton', 'baton.json'), JSON.stringify({ items: 'tickets', default_course: 'create-pr', repos: { docs: 'immediately-run/docs' }, ...settings }, null, 2));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  if (git) {
    execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' });
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'fixture'], { stdio: 'ignore' });
  }
  return dir;
}

/** A finding as the CLI prints it. */
const lines = (r: { findings: { path: string; message: string }[] }) => r.findings.map((f) => `${f.path}: ${f.message}`);

describe('checkTickets: a clean repository', () => {
  it('a set of tickets that depend on one another sanely has no findings', async () => {
    const dir = repo({
      'tickets/A-1.md': ticket('id: A-1'),
      'tickets/A-2.md': ticket('id: A-2\ndepends_on: [A-1]'),
      'tickets/A-3.md': ticket('id: A-3\nstatus: done'),
      'tickets/A-4.md': ticket('id: A-4\ndepends_on: [A-3]'), // a closed dependency is fine
      'tickets/README.md': 'not a ticket\n',
    });
    const r = await checkTickets(dir);
    expect(r.findings).toEqual([]);
    expect(r.counts).toEqual({ tickets: 3, closed: 1 });
  });
});

describe('checkTickets: dependencies', () => {
  it('a cycle is reported once, as its path', async () => {
    const dir = repo({
      'tickets/A-1.md': ticket('id: A-1\ndepends_on: [A-2]'),
      'tickets/A-2.md': ticket('id: A-2\ndepends_on: [A-1]'),
    });
    const r = await checkTickets(dir);
    expect(lines(r)).toEqual(['tickets/A-1.md: a dependency cycle: A-1 → A-2 → A-1']);
  });

  it('a longer cycle is reported once too, and a diamond is not a cycle', async () => {
    const cycle = repo({
      'tickets/A-1.md': ticket('id: A-1\ndepends_on: [A-2]'),
      'tickets/A-2.md': ticket('id: A-2\ndepends_on: [A-3]'),
      'tickets/A-3.md': ticket('id: A-3\ndepends_on: [A-1]'),
    });
    expect(lines(await checkTickets(cycle))).toEqual(['tickets/A-1.md: a dependency cycle: A-1 → A-2 → A-3 → A-1']);
    const diamond = repo({
      'tickets/A-1.md': ticket('id: A-1'),
      'tickets/A-2.md': ticket('id: A-2\ndepends_on: [A-1]'),
      'tickets/A-3.md': ticket('id: A-3\ndepends_on: [A-1]'),
      'tickets/A-4.md': ticket('id: A-4\ndepends_on: [A-2, A-3]'),
    });
    expect((await checkTickets(diamond)).findings).toEqual([]);
  });

  it('a self-dependency is a cycle of one: A-1 → A-1', async () => {
    const dir = repo({ 'tickets/A-1.md': ticket('id: A-1\ndepends_on: [A-1]') });
    expect(lines(await checkTickets(dir))).toEqual(['tickets/A-1.md: a dependency cycle: A-1 → A-1']);
  });

  it('a dependency a closed ticket takes part in is no cycle: it left the board', async () => {
    const dir = repo({
      'tickets/A-1.md': ticket('id: A-1\ndepends_on: [A-2]'),
      'tickets/A-2.md': ticket('id: A-2\nstatus: done\ndepends_on: [A-1]'),
    });
    // A-2 is closed, so the cycle is not in the live graph; the board sees the same.
    expect((await checkTickets(dir)).findings).toEqual([]);
  });

  it('a depends_on naming no ticket here is reported against its file', async () => {
    const dir = repo({
      'tickets/A-1.md': ticket('id: A-1\ndepends_on: [A-9]'),
      'tickets/A-2.md': ticket('id: A-2'),
    });
    expect(lines(await checkTickets(dir))).toEqual(['tickets/A-1.md: depends_on names A-9, which is neither live nor closed']);
  });

  it('a parent is not a dependency: a parent loop is not the check’s to refuse', async () => {
    // The markdown source makes a parent its children's `blocked_by`, never their `depends_on`.
    const dir = repo({
      'tickets/A-1.md': ticket('id: A-1\nparent: A-2'),
      'tickets/A-2.md': ticket('id: A-2\nparent: A-1'),
    });
    expect((await checkTickets(dir)).findings).toEqual([]);
  });
});

describe('checkTickets: the source’s own refusals', () => {
  it('a duplicate id is one finding, carrying the sync’s own message', async () => {
    const dir = repo({
      'tickets/A-1.md': ticket('id: A-1'),
      'tickets/A-1-copy.md': ticket('id: A-1'),
    });
    const r = await checkTickets(dir);
    // The markdown source names the folder's files as `readBoard` reads them, the sync's own
    // message verbatim (`tickets/A-1.md: id A-1 already appears in …`).
    expect(lines(r)).toEqual(['tickets: A-1.md: id A-1 already appears in A-1-copy.md']);
    expect(r.findings[0].message).toContain('id A-1 already appears in');
    expect(r.counts).toEqual({ tickets: 0, closed: 0 });
  });

  it('a repos short name with no mapping is one finding, naming the file', async () => {
    const dir = repo({ 'tickets/A-1.md': ticket('id: A-1\nrepos: [nowhere]') });
    expect(lines(await checkTickets(dir))).toEqual(['tickets: A-1.md: repos names nowhere, which the baton.json repos map does not resolve']);
  });

  it('an order that is not a number is one finding too, at the folder whose read it is', async () => {
    const dir = repo({ 'tickets/A-1.md': ticket('id: A-1\norder: soon') });
    expect(lines(await checkTickets(dir))).toEqual(['tickets: A-1.md: order "soon" is not a number']);
  });

  it('a root with no .baton/baton.json, and one whose baton.json is not JSON, throw', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'baton-b111-bare-'));
    dirs.push(bare);
    await expect(checkTickets(bare)).rejects.toThrow('has no .baton/baton.json');
    const bad = repo({});
    writeFileSync(join(bad, '.baton', 'baton.json'), '{not json');
    await expect(checkTickets(bad)).rejects.toThrow('.baton/baton.json is not JSON');
    await expect(checkTicketsMain(['--repo', bad], { log: () => {} })).rejects.toThrow('.baton/baton.json is not JSON');
  });
});

describe('checkTickets: the board post’s validation, run locally', () => {
  it('what the board refuses is a finding, at `board`, the validator naming its field', async () => {
    // An id the board's grammar refuses (a space) is the source's ticket, not the source's throw.
    const dir = repo({ 'tickets/A-1.md': ticket('id: A 1') });
    const r = await checkTickets(dir);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].path).toBe('board');
    expect(r.findings[0].message).toMatch(/must be a local id/);
    // The same object the route validates: the payload below throws exactly as the post does.
    expect(() => checkPayload({ sha: '0'.repeat(40), parent_sha: null, observation: 1, tickets: [{ id: 'A 1', course_id: 'create-pr', path: 'tickets/A-1.md', title: 'A', requires: [], operator_only: false, expedite: false, depends_on: [], blocked_by: [], repos: [] }] })).toThrow('must be a local id');
  });

  it('and a cycle the board refuses is that one finding', async () => {
    const dir = repo({
      'tickets/A-1.md': ticket('id: A-1\ndepends_on: [A-2]'),
      'tickets/A-2.md': ticket('id: A-2\ndepends_on: [A-1]'),
    });
    const r = await checkTickets(dir);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].message).toBe('a dependency cycle: A-1 → A-2 → A-1');
  });
});


describe('checkTickets: the markdown source’s **Depends on:** line (check.depends_line)', () => {
  const on = { check: { depends_line: true } };

  it('reads a wiki link as its ticket, and a requirement or scenario id as prose (round 4, 4-r2-0/-1)', async () => {
    // docs writes the line as a wiki link; requirement ids (R-BTN-83) and scenario ids
    // (S-BTN-62) are cited on the line too but are not this repository's dependencies.
    const dir = repo({
      'tickets/A-1.md': ticket('id: A-1\ndepends_on: [B-2]', '**Depends on:** [[B-2.mdx]] (R-BTN-83, S-BTN-62).\n'),
      'tickets/B-2.md': ticket('id: B-2'),
    }, on);
    expect((await checkTickets(dir, {}, { depends_line: true })).findings).toEqual([]);
    // The link's id is read: a link to a ticket the field omits is a finding.
    const bad = repo({
      'tickets/A-1.md': ticket('id: A-1', '**Depends on:** [[B-2.mdx]]\n'),
      'tickets/B-2.md': ticket('id: B-2'),
    }, on);
    expect((await checkTickets(bad, {}, { depends_line: true })).findings.map((x) => x.message))
      .toEqual(['**Depends on:** names B-2, which depends_on does not']);
  });

  it('a line naming an id depends_on does not, and depends_on naming one the line does not, are both findings', async () => {
    const dir = repo({
      'tickets/A-1.md': ticket('id: A-1\ndepends_on: [A-2]', 'Prose, with a **Depends on:** mention in it — not the line.\n\n**Depends on:** A-3, A-4\n\nMore prose.\n'),
      'tickets/A-2.md': ticket('id: A-2'),
      'tickets/A-3.md': ticket('id: A-3'),
      'tickets/A-4.md': ticket('id: A-4'),
    }, on);
    expect(lines(await checkTickets(dir, {}, { depends_line: true }))).toEqual([
      'tickets/A-1.md: **Depends on:** names A-3, which depends_on does not',
      'tickets/A-1.md: **Depends on:** names A-4, which depends_on does not',
      'tickets/A-1.md: depends_on names A-2, which **Depends on:** does not',
    ]);
  });

  it('a multi-line line is read whole, to the next blank line or **Label:** line; **Used by:** is never read', async () => {
    const dir = repo({
      'tickets/A-1.md': ticket('id: A-1\ndepends_on: [A-2, A-3, A-4]', '**Depends on:** A-2\nA-3,\nA-4\n\n**Used by:** A-5\n'),
      'tickets/A-2.md': ticket('id: A-2'),
      'tickets/A-3.md': ticket('id: A-3'),
      'tickets/A-4.md': ticket('id: A-4'),
      'tickets/A-5.md': ticket('id: A-5'),
      // A `**Label:**` line ends a line of its own, naming nothing that would leak in.
      'tickets/A-6.md': ticket('id: A-6\ndepends_on: [A-2]', '**Depends on:** A-2\n**Why:** A-7 is a different matter\n'),
      'tickets/A-7.md': ticket('id: A-7'),
      // A ticket with no such line is not compared, whatever its depends_on.
      'tickets/A-8.md': ticket('id: A-8\ndepends_on: [A-2]', 'No line here.\n'),
    }, on);
    expect(lines(await checkTickets(dir, {}, { depends_line: true }))).toEqual([]);
  });

  it('the setting is off by default: the same repository has no findings without it', async () => {
    const dir = repo({
      'tickets/A-1.md': ticket('id: A-1\ndepends_on: [A-2]', '**Depends on:** A-3\n'),
      'tickets/A-2.md': ticket('id: A-2'),
      'tickets/A-3.md': ticket('id: A-3'),
    }, on);
    expect((await checkTickets(dir)).findings).toEqual([]);
    expect((await checkTickets(dir, {}, {})).findings).toEqual([]);
    // And the command reads the setting from .baton/baton.json alone.
    const said: string[] = [];
    expect(await checkTicketsMain(['--repo', dir], { log: (l) => said.push(l) })).toBe(1);
    expect(said).toEqual([
      'tickets/A-1.md: **Depends on:** names A-3, which depends_on does not',
      'tickets/A-1.md: depends_on names A-2, which **Depends on:** does not',
      'baton tickets check: 3 ticket(s), 2 finding(s)',
    ]);
  });

  it('the ejected source is not compared, and the setting says so instead of silently doing nothing', async () => {
    const dir = repo({
      'tickets/A-1.md': ticket('id: A-1', '**Depends on:** A-9\n'),
      '.baton/tickets.mjs': `export default { async tickets() { return { tickets: [${JSON.stringify(tkt('A-1'))}], closed: [] }; } };\n`,
    }, on);
    // Round 1, 1-A-6: one note, never the markdown comparison (which would compare a file the
    // source does not read).
    const found = (await checkTickets(dir, {}, { depends_line: true })).findings;
    expect(found.map((f) => f.path)).toEqual(['.baton/tickets.mjs']);
    expect(found[0].message).toMatch(/check.depends_line is on, but this repository's tickets come from its own source/);
  });
});

/** A posted ticket the ejected sources below return, in the board's shape. */
function tkt(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, course_id: 'create-pr', path: `tickets/${id}.md`, title: id, requires: [], operator_only: false, expedite: false, depends_on: [], blocked_by: [], repos: [], rank: null, ...over };
}

describe('checkTickets: an ejected .baton/tickets.mjs', () => {
  it('the check runs IT, not the markdown: a source that throws is one finding with its own message', async () => {
    const dir = repo({
      // The markdown alone would be clean; the source refuses.
      'tickets/A-1.md': ticket('id: A-1'),
      '.baton/tickets.mjs': `export default { async tickets() { throw new Error('tickets/B-4.mdx: id B-4 already appears in tickets/B-4-copy.mdx'); } };\n`,
    });
    const r = await checkTickets(dir);
    // The source's own message, passed through as it came: it opens with the file it names.
    expect(r.findings).toEqual([{ path: 'tickets', message: 'tickets/B-4.mdx: id B-4 already appears in tickets/B-4-copy.mdx' }]);
  });

  it('one returning good tickets is checked as the markdown’s are: its depends_on, its cycles, no report of the folder', async () => {
    const dir = repo({
      // In the folder, unread by the ejected source: a cycle the check must not see.
      'tickets/A-1.md': ticket('id: A-1\ndepends_on: [A-2]'),
      'tickets/A-2.md': ticket('id: A-2\ndepends_on: [A-1]'),
      '.baton/tickets.mjs': `export default { async tickets(ctx) { return { tickets: [${JSON.stringify(tkt('X-1'))}, ${JSON.stringify(tkt('X-2', { depends_on: ['X-1'] }))}], closed: [${JSON.stringify({ id: 'X-3', as: 'done' })}] }; } };\n`,
    });
    const r = await checkTickets(dir);
    expect(r.findings).toEqual([]);
    expect(r.counts).toEqual({ tickets: 2, closed: 1 });
  });

  it('and its own cycle, and a dependency it names that nothing has, are findings', async () => {
    const dir = repo({
      '.baton/tickets.mjs': `export default { async tickets() { return { tickets: [${JSON.stringify(tkt('X-1', { depends_on: ['X-2', 'X-9'] }))}, ${JSON.stringify(tkt('X-2', { depends_on: ['X-1'] }))}], closed: [] }; } };\n`,
    });
    const r = await checkTickets(dir);
    expect(lines(r)).toEqual([
      'tickets/X-1.md: a dependency cycle: X-1 → X-2 → X-1',
      'tickets/X-1.md: depends_on names X-9, which is neither live nor closed',
    ]);
  });

  it('a source that default-exports no tickets(ctx) is the finding', async () => {
    const dir = repo({ '.baton/tickets.mjs': 'export default {};\n' });
    expect(lines(await checkTickets(dir))).toEqual(['.baton/tickets.mjs: .baton/tickets.mjs default-exports no tickets(ctx)']);
  });
});

describe('checkTicketsMain: exit codes, the count line, --quiet', () => {
  it('0 with a count when clean, 1 with one line per finding otherwise, 2 by throwing on a bad flag', async () => {
    const clean = repo({ 'tickets/A-1.md': ticket('id: A-1') });
    const said: string[] = [];
    expect(await checkTicketsMain(['--repo', clean], { log: (l) => said.push(l) })).toBe(0);
    expect(said).toEqual(['baton tickets check: 1 ticket(s), ✓ no findings']);
    const loop = repo({
      'tickets/A-1.md': ticket('id: A-1\ndepends_on: [A-2]'),
      'tickets/A-2.md': ticket('id: A-2\ndepends_on: [A-1]'),
    });
    said.length = 0;
    expect(await checkTicketsMain(['--repo', loop], { log: (l) => said.push(l) })).toBe(1);
    expect(said).toEqual(['tickets/A-1.md: a dependency cycle: A-1 → A-2 → A-1', 'baton tickets check: 2 ticket(s), 1 finding(s)']);
    said.length = 0;
    expect(await checkTicketsMain(['--repo', clean, '--quiet'], { log: (l) => said.push(l) })).toBe(0);
    expect(said).toEqual([]);
    await expect(checkTicketsMain(['--repo'], { log: () => {} })).rejects.toThrow('--repo needs a value');
    await expect(checkTicketsMain(['--bogus'], { log: () => {} })).rejects.toThrow('not a flag of baton tickets check');
    await expect(checkTicketsMain(['--repo', '/nonexistent/b111'], { log: () => {} })).rejects.toThrow('no such directory');
  });
});

describe('dependsLine and bodyDependencies: the line’s bounds', () => {
  it('runs to the next blank line or the next **Label:** line, joins its lines, and de-duplicates (ported from fieldhouse’s check-wiki)', () => {
    const id = /[A-Z]+-\d+/;
    expect(bodyDependencies('intro\n**Depends on:** A-1, B-2\nand A-1 again\nmore\n\n**Used by:** C-3\n', id)).toEqual(['A-1', 'B-2']);
    expect(bodyDependencies('**Depends on:** A-1\n**Label:** B-2\n', id)).toEqual(['A-1']);
    expect(bodyDependencies('**Depends on:**\nA-1\nA-2\n', id)).toEqual(['A-1', 'A-2']);
    expect(bodyDependencies('no line at all\n', id)).toBeNull();
    // Only a line that opens the paragraph is read: a mention mid-prose is not the line.
    expect(bodyDependencies('see **Depends on:** A-1\n', id)).toBeNull();
  });

  it('reads the body past the frontmatter, by the id grammar prose uses — never a bare word, never a partial id', () => {
    // A whole token only: `R-BTN-83` is never `BTN-83`; a dotted sub-id (`B-4.1`) is not its
    // parent `B-4` (2-r0-1); and a sentence-final full stop is punctuation, not part of the id
    // (3-r1-1 — this repository's own B-38 writes `R3-1254.`).
    expect(dependsLine('**Depends on:** R-BTN-83, B-4.1, see B-2.\n')).toEqual(['R-BTN-83', 'B-2']);
    const file = '---\nid: B-111\ntitle: A ticket with depends_on in prose\n---\n\n**Depends on:** B-1, R3-1205 and B-2.\n\n**Used by:** B-3\n';
    // The line is prose: an id-SHAPED token (`B-1`, `R3-1205`) is a dependency, and "and" is
    // not (round 1, 1-A-0: the board's `LOCAL_ID` un-anchored read `none.`, `the` and `and`).
    // A sentence-final full stop is punctuation: `B-2.` is the id `B-2` (3-r1-1).
    expect(dependsLine(file)).toEqual(['B-1', 'R3-1205', 'B-2']);
    // 'none' is the empty list, as `depends_on: []` is.
    expect(dependsLine('**Depends on:** none\n')).toEqual([]);
    // There is no separator after the marker: a first id keeps its first letter (`B-1`, never `1`).
    expect(dependsLine('**Depends on:** B-1\n')).toEqual(['B-1']);
    expect(dependsLine('---\nid: B-1\n---\n\nno line\n')).toBeNull();
    // Never the frontmatter's own keys: `depends_on: ...` is a field, not a `**Depends on:**` line.
    expect(dependsLine('---\nid: B-1\ndepends_on: [B-2]\n---\n\nprose\n')).toBeNull();
  });

  it('finds the line that opens a paragraph, not a mention of it inside prose', () => {
    expect(dependsLine('The introduction, which mentions **Depends on:** in passing.\n\n**Depends on:** A-1\n')).toEqual(['A-1']);
  });

  it('names a cycle once as its path, a self-edge as A → A, and nothing for a diamond or an unknown id', () => {
    expect(dependsCycle([{ id: 'B-1', depends_on: ['B-2'] }, { id: 'B-2', depends_on: ['B-1'] }])).toEqual(['B-1', 'B-2', 'B-1']);
    expect(dependsCycle([{ id: 'A', depends_on: ['A'] }])).toEqual(['A', 'A']);
    expect(dependsCycle([{ id: 'A', depends_on: [] }, { id: 'B', depends_on: ['A'] }, { id: 'C', depends_on: ['A'] }, { id: 'D', depends_on: ['B', 'C'] }])).toBeNull();
    // An id that is not in the graph is not an edge: naming it is the check's, not the board's.
    expect(dependsCycle([{ id: 'A', depends_on: ['Z'] }])).toBeNull();
    expect(dependsCycle([])).toBeNull();
  });

  it('finds the cycle whatever the order the tickets arrive in, and only one', () => {
    const a = { id: 'B-1', depends_on: ['B-3'] };
    const b = { id: 'B-2', depends_on: ['B-1'] };
    const c = { id: 'B-3', depends_on: ['B-2'] };
    expect(dependsCycle([c, b, a])).toEqual(dependsCycle([a, b, c]));
    expect(dependsCycle([c, b, a])).toEqual(['B-1', 'B-3', 'B-2', 'B-1']);
    // The cycle is the path from the dependency's own visit, even when the walk reached it twice.
    expect(dependsCycle([{ id: 'A', depends_on: [] }, { id: 'B', depends_on: ['C'] }, { id: 'C', depends_on: ['A', 'B'] }])).toEqual(['B', 'C', 'B']);
  });

  it('a shared, acyclic dependency is no loop: visiting a chain twice reads the same ids', () => {
    expect(dependsCycle([{ id: 'A', depends_on: ['B', 'C'] }, { id: 'B', depends_on: ['C'] }, { id: 'C', depends_on: [] }])).toBeNull();
  });
});
