// ci-scope (owner, 2026-11-23): only a change of ticket files alone skips the suite; anything
// else, or anything the script cannot read, runs it.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scope, ticketsOnly } from './ci-scope.mjs';

describe('ticketsOnly', () => {
  it('holds for ticket files, live and archived, of any prefix', () => {
    expect(ticketsOnly(['tickets/B-12.mdx', 'tickets/archive/B-1.mdx', 'tickets/R3-1254.mdx'])).toBe(true);
  });

  it('fails for the tickets folder’s other files and for anything outside it', () => {
    for (const f of ['tickets/item.schema.json', 'tickets/README.md', 'tickets/HOW-TICKETS-WORK.md', 'tickets/_layout.mdx',
      'tickets/home.mdx', 'tickets/projects/baton.mdx', 'tickets/immediately.run.json', 'src/core/baton.ts', '.github/workflows/ci.yml']) {
      expect(ticketsOnly(['tickets/B-12.mdx', f]), f).toBe(false);
    }
  });

  it('fails for an empty change', () => {
    expect(ticketsOnly([])).toBe(false);
  });
});

describe('scope', () => {
  const repo = () => {
    const dir = mkdtempSync(join(tmpdir(), 'ci-scope-'));
    const g = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' }).trim();
    g('init', '-q');
    mkdirSync(join(dir, 'tickets'));
    writeFileSync(join(dir, 'tickets', 'B-1.mdx'), 'one\n');
    g('add', '-A');
    g('commit', '-qm', 'base');
    return { dir, g, head: () => g('rev-parse', 'HEAD') };
  };

  it('skips the suite for a commit of ticket files only, and runs it for one that adds code', () => {
    const { dir, g, head } = repo();
    const base = head();
    writeFileSync(join(dir, 'tickets', 'B-1.mdx'), 'two\n');
    g('commit', '-qam', 'tickets: B-1');
    const tickets = head();
    expect(scope(base, tickets, dir).code).toBe(false);
    writeFileSync(join(dir, 'x.ts'), 'x\n');
    g('add', '-A');
    g('commit', '-qm', 'code');
    expect(scope(base, head(), dir).code).toBe(true);
  });

  it('runs the suite when there is no base, or a base it cannot reach', () => {
    const { dir, head } = repo();
    expect(scope('', head(), dir).code).toBe(true);
    expect(scope('0'.repeat(40), head(), dir).code).toBe(true);
    expect(scope('1'.repeat(40), head(), dir).code).toBe(true);
  });
});
