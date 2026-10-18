// tickets-markdown.test.ts — the CLI's default ticket source (BATON_SPEC §2f R-BTN-74;
// R3-1249): every field, the closed statuses, depends_on and open-children readiness, the
// unknown field ignored, a duplicate id and an unmapped repos name refused loudly. Pure and
// host-neutral.
import { describe, it, expect } from 'vitest';
import { parseFrontmatter, ticketsMarkdown, type MarkdownFile } from '../../src/defaults/tickets-markdown';

const file = (path: string, fm: string, body = 'prose\n'): MarkdownFile => ({ path, text: `---\n${fm}\n---\n\n${body}` });

describe('parseFrontmatter', () => {
  it('reads scalars as text, inline and block lists; a fence-less file is nothing', () => {
    expect(parseFrontmatter(file('a.md', 'id: A\ntitle: "A ticket"\norder: 3\ntags: [EXPEDITE, OP]\ndepends_on:\n  - B\n  - C').text)).toEqual({ id: 'A', title: 'A ticket', order: '3', tags: ['EXPEDITE', 'OP'], depends_on: ['B', 'C'] });
    expect(parseFrontmatter('no fence here\n')).toBeNull();
    expect(parseFrontmatter('---\ntitle: no id\n---\n')).toEqual({ title: 'no id' });
  });
});

describe('ticketsMarkdown', () => {
  it('reads every field: course default and override, tier, requires, tags, order, prs, parent, not_before', () => {
    const { tickets, closed } = ticketsMarkdown([
      file('one.md', 'id: T-1\ntitle: One\ntier: routine\nrequires: [agent-venue]\norder: 2\ntags: [EXPEDITE]\nprs: [7]\nparent: T-0\nnot_before: 1792152000000\nmystery: ignored'),
      file('two.md', 'id: T-2\ncourse: ops'),
    ], { items: 'wiki', default_course: 'pr', repos: { docs: 'immediately-run/docs' } });
    expect(closed).toEqual([]);
    expect(tickets[0]).toMatchObject({ id: 'T-1', course_id: 'pr', path: 'wiki/one.md', title: 'One', tier: 'routine', requires: ['agent-venue'], expedite: true, operator_only: false, rank: 2, course: { prs: ['7'] }, parent: 'T-0', not_before: '1792152000000' });
    expect(tickets[1]).toMatchObject({ id: 'T-2', course_id: 'ops', rank: null });
    expect('mystery' in (tickets[0] as unknown as Record<string, unknown>)).toBe(false); // unknown fields ignored
  });

  it('closed statuses close: done as done, withdrawn/superseded/deferred as withdrawn', () => {
    const { tickets, closed } = ticketsMarkdown([
      file('a.md', 'id: A\nstatus: done'),
      file('b.md', 'id: B\nstatus: withdrawn'),
      file('c.md', 'id: C\nstatus: superseded'),
      file('d.md', 'id: D\nstatus: deferred'),
      file('e.md', 'id: E\nstatus: in-progress'),
    ]);
    expect(closed).toEqual([{ id: 'A', as: 'done' }, { id: 'B', as: 'withdrawn' }, { id: 'C', as: 'withdrawn' }, { id: 'D', as: 'withdrawn' }]);
    expect(tickets.map((t) => t.id)).toEqual(['E']); // any other value is live and shown
    expect(tickets[0].display).toEqual({ status: 'in-progress' });
  });

  it('every *.md or *.mdx file is read, whatever its name: spaces, non-ASCII letters, an upper-case extension', () => {
    const { tickets } = ticketsMarkdown([file('my ticket.md', 'id: S'), file('über.md', 'id: U'), file('C.MD', 'id: C'), file('archive/old.Mdx', 'id: O')]);
    expect(tickets.map((t) => t.id).sort()).toEqual(['C', 'O', 'S', 'U']);
  });

  it('a file without an id, or not markdown, is not a ticket', () => {
    const { tickets } = ticketsMarkdown([file('no-id.md', 'title: nothing'), { path: 'img.png', text: '---\nid: X\n---\n' }]);
    expect(tickets).toEqual([]);
  });

  it('depends_on readiness is the course’s to show; a ticket’s open children — by parent — block it', () => {
    const { tickets } = ticketsMarkdown([
      file('parent.md', 'id: P'),
      file('child.md', 'id: K\nparent: P'),
      file('closed-child.md', 'id: C\nparent: P\nstatus: done'),
      file('dependent.md', 'id: D\ndepends_on: [P]'),
    ]);
    // The open child blocks its parent; the done child and the dependent do not — a ticket
    // waits for what it depends on, never for what depends on it.
    expect(tickets.find((t) => t.id === 'P')!.blocked_by).toEqual(['K']);
    expect(tickets.find((t) => t.id === 'K')!).toMatchObject({ parent: 'P', blocked_by: [] });
    expect(tickets.find((t) => t.id === 'D')!).toMatchObject({ depends_on: ['P'], blocked_by: [] });
  });

  it('reads the YAML shapes a wiki writes: a numeric id, a scalar for a list, quoted items, a decimal or quoted order', () => {
    const { tickets } = ticketsMarkdown([
      file('n.md', 'id: 1042\ndepends_on: S0\ntags: EXPEDITE\nprs: 12\norder: 3.5'),
      file('q.md', 'id: Q\ndepends_on: ["S0", \'S1\']\nrequires:\n  - "agent-venue"\norder: "7"'),
    ]);
    // Every value is the text the file wrote: a zero-padded id stays padded, so its dependents,
    // which name it the same way, resolve.
    const padded = ticketsMarkdown([file('p.md', 'id: 0042'), file('d.md', 'id: D\ndepends_on: [0042]')]).tickets;
    expect(padded.map((t) => [t.id, t.depends_on])).toEqual([['0042', []], ['D', ['0042']]]);
    expect(tickets.find((t) => t.id === '1042')).toMatchObject({ depends_on: ['S0'], expedite: true, course: { prs: ['12'] }, rank: 4 });
    expect(tickets.find((t) => t.id === 'Q')).toMatchObject({ depends_on: ['S0', 'S1'], requires: ['agent-venue'], rank: 7 });
    // A scalar repos name goes through the map like a list's, and an unmapped one still fails.
    expect(() => ticketsMarkdown([file('r.md', 'id: R\nrepos: docs')])).toThrow(/r\.md: repos names docs/);
    // An order that is not a number fails the sync naming the file, rather than unranking it.
    expect(() => ticketsMarkdown([file('o.md', 'id: O\norder: soon')])).toThrow(/o\.md: order "soon" is not a number/);
  });

  it('repos short names resolve through the map; owner/name stands; an unmapped name fails the sync', () => {
    const { tickets } = ticketsMarkdown([file('a.md', 'id: A\nrepos: [docs]')], { repos: { docs: 'immediately-run/docs' } });
    expect(tickets[0].repos).toEqual(['immediately-run/docs']);
    expect(() => ticketsMarkdown([file('a.md', 'id: A\nrepos: [docs]')])).toThrow(/repos names docs/);
    expect(() => ticketsMarkdown([file('a.md', 'id: A\nrepos: [nope]')], { repos: {} })).toThrow(/nope/);
    const bare = ticketsMarkdown([file('a.md', 'id: A\nrepos: [owner/name]')]).tickets[0];
    expect(bare.repos).toEqual(['owner/name']);
  });

  it('a duplicate id fails the sync naming both files', () => {
    expect(() => ticketsMarkdown([file('a.md', 'id: A'), file('b.md', 'id: A')])).toThrow(/id A already appears in a\.md/);
  });

  it('rank is by order then id, unranked following ranked', () => {
    const { tickets } = ticketsMarkdown([file('c.md', 'id: C'), file('a.md', 'id: A\norder: 2'), file('b.md', 'id: B\norder: 1'), file('d.md', 'id: D')]);
    expect(tickets.map((t) => t.id)).toEqual(['B', 'A', 'C', 'D']);
  });
});
