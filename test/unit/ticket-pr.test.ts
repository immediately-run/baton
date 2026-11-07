// ticket-pr.test.ts — B-133's ticket-PR view through `baton tickets check --pr` (OWASP ASI09):
// what a change does to the tickets is COMPUTED — which tickets change, which frontmatter
// fields (control fields named), whether a body or brief changed (with a bounded diff), each
// path's commits, and the status-only label. A PR whose own description claims "status-only"
// that its diff contradicts is a FINDING: the label is the check's, never the description's.
// The pure view is the vendored library (src/shared/ticketPr.mjs, tested in docs beside its
// source); this drives the CLI flag over real fixture git repositories. Node only.
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ticketsCheckMain } from '../../src/defaults/tickets';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const BODY = '**Brief:** the original brief.\n\n### What to build\n\n- the thing\n';
const ticket = (over: Record<string, string> = {}, body = BODY): string => {
  const fm = { id: 'B-1', status: 'in-progress', prs: '[]', updated: '2026-10-27', tier: 'judgement', EXPEDITE: 'false', depends_on: '[]', ...over };
  return `---\ntitle: "B-1 — a ticket"\n${Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\n${body}`;
};

/** A fixture repository at `main` with the given files, then `files2` committed on a branch. */
function repo(files: Record<string, string>, files2: Record<string, string>, message = 'the PR'): string {
  const dir = mkdtempSync(join(tmpdir(), 'baton-b133-'));
  dirs.push(dir);
  const git = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'worker@immediately.run');
  git('config', 'user.name', 'immediately-run-worker');
  mkdirSync(join(dir, '.baton'), { recursive: true });
  writeFileSync(join(dir, '.baton', 'baton.json'), JSON.stringify({ items: 'tickets', default_course: 'create-pr', repos: {} }));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('checkout', '-qb', 'pr');
  for (const [path, text] of Object.entries(files2)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  git('add', '-A');
  git('commit', '-qm', message);
  return dir;
}

/** `baton tickets check --pr main [--claimed-status-only]` over a fixture: its exit and lines. */
async function run(dir: string, flags: string[] = []): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const code = await ticketsCheckMain(['--repo', dir, '--pr', 'main', ...flags], { log: (l) => lines.push(l) });
  return { code, lines };
}

describe('B-133: the ticket-PR view', () => {
  it('a status-field-only change computes the status-only label and exits clean', async () => {
    const dir = repo({ 'tickets/B-1.mdx': ticket() }, { 'tickets/B-1.mdx': ticket({ status: 'in-review', updated: '2026-11-07' }) });
    const r = await run(dir, ['--claimed-status-only']);
    expect(r.code).toBe(0);
    expect(r.lines[0]).toMatch(/^ticket-pr \(B-133\): 1 ticket file\(s\) changed against main \([0-9a-f]{10}\)$/);
    expect(r.lines).toEqual(expect.arrayContaining([
      '  status: in-progress → in-review',
      '  status-only: yes',
      'status-only: yes — only status fields changed; no body, brief or control field',
    ]));
  });

  it('a ticket PR described as status-only but changing a body is a body change, and a finding', async () => {
    const dir = repo(
      { 'tickets/B-1.mdx': ticket() },
      { 'tickets/B-1.mdx': ticket({ status: 'in-review' }, '**Brief:** a quietly rewritten brief the agent summarised.\n\n### What to build\n\n- the thing\n') },
    );
    const r = await run(dir, ['--claimed-status-only']);
    expect(r.code).toBe(1);
    const printed = r.lines.join('\n');
    expect(printed).toMatch(/body changed/);
    expect(printed).toMatch(/\+ \*\*Brief:\*\* a quietly rewritten brief/);
    expect(printed).toMatch(/status-only: no — body changed; brief changed/);
    expect(printed).not.toMatch(/status-only: yes/);
    expect(printed).toMatch(/ticket-pr: the PR is described status-only, but the computed view says otherwise/);
    // The finding count carries the mismatch: exit 1 with `1 finding(s)`.
    expect(r.lines.at(-1)).toMatch(/1 finding\(s\)/);
  });

  it('a control-field change is named as control; provenance rides the row', async () => {
    const dir = repo({ 'tickets/B-1.mdx': ticket() }, { 'tickets/B-1.mdx': ticket({ EXPEDITE: 'true' }) });
    const r = await run(dir);
    expect(r.code).toBe(0); // reported, not a finding: protection is R-BTN-184's
    const printed = r.lines.join('\n');
    expect(printed).toMatch(/EXPEDITE: false → true  \[control\]/);
    expect(printed).toMatch(/control field EXPEDITE changed/);
    expect(printed).toMatch(/immediately-run-worker <worker@immediately\.run> \(committed by immediately-run-worker <worker@immediately\.run>\)/);
    expect(printed).toMatch(/status-only: no/);
  });

  it('a change that touches no ticket reports none, and the claim cannot stand', async () => {
    const dir = repo({ 'src/app.ts': 'a\n' }, { 'src/app.ts': 'b\n' });
    const r = await run(dir, ['--claimed-status-only']);
    expect(r.code).toBe(1);
    expect(r.lines[0]).toMatch(/^ticket-pr \(B-133\): 0 ticket file\(s\) changed against main \([0-9a-f]{10}\)$/);
    expect(r.lines).toEqual(expect.arrayContaining(['  no ticket changes — the status-only label does not apply']));
    expect(r.lines.join('\n')).toMatch(/the change touches no ticket/);
  });

  it('an added ticket is shown whole — an agent-filed ticket is never status-only', async () => {
    const dir = repo({}, { 'tickets/B-2.mdx': ticket({ id: 'B-2' }) });
    const r = await run(dir);
    expect(r.code).toBe(0);
    const printed = r.lines.join('\n');
    expect(printed).toMatch(/tickets\/B-2\.mdx \(B-2\): added/);
    expect(printed).toMatch(/status-only: no — file added/);
    expect(printed).toMatch(/\*\*Brief:\*\* changed/); // the whole agent-written ticket is in view
  });
});
