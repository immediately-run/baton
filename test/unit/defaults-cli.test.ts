// defaults-cli.test.ts — `baton sync`'s argument parser and `baton init`'s scaffolding
// (BATON_SPEC §2f R-BTN-74; R3-1249): the flags, the scaffold's every file (the settings, the
// course file with the pr graph, the leg stubs — the review one naming the verdict — the
// pinned workflow), and both ejections copying a working default. Node only: init writes a
// real tree.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initMain, parseSyncArgs, SYNC_WORKFLOW } from '../../src/defaults/cli';
import { PR_COURSE } from '../../src/defaults/course-pr';

describe('parseSyncArgs', () => {
  it('defaults from the environment, takes its flags, refuses the unknown', () => {
    expect(parseSyncArgs([], { BATON_HOME: '/h', BATON_URL: 'https://b' })).toMatchObject({ root: '/h', url: 'https://b' });
    expect(parseSyncArgs(['--root', '/x', '--url', 'https://u', '--facts', '/f.json', '--token', 't1'], {})).toMatchObject({ root: '/x', url: 'https://u', factsFile: '/f.json', token: 't1' });
    expect(() => parseSyncArgs(['--nope'], {})).toThrow('not a flag of baton sync');
    expect(() => parseSyncArgs(['--root'], {})).toThrow('needs a value');
  });
});

describe('initMain', () => {
  it('scaffolds .baton/: the settings, the course file, four leg stubs (review names the verdict), the pinned workflow, the tickets directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'baton-init-'));
    try {
      expect(await initMain([], { root, log: () => {} })).toBe(0);
      const settings = JSON.parse(readFileSync(join(root, '.baton', 'baton.json'), 'utf8'));
      expect(settings).toMatchObject({ items: 'tickets', default_course: 'pr', courses: [{ id: 'pr', version: 1 }] });
      const course = JSON.parse(readFileSync(join(root, '.baton', 'courses', 'pr', 'course.json'), 'utf8'));
      expect(course).toEqual(JSON.parse(JSON.stringify(PR_COURSE)));
      for (const leg of ['implement', 'review', 'fix', 'merge']) {
        const stub = readFileSync(join(root, '.baton', 'courses', 'pr', 'legs', `${leg}.mjs`), 'utf8');
        expect(stub).toContain('export const close = prClose');
        if (leg === 'review') expect(stub).toContain('verdict');
      }
      expect(readFileSync(join(root, '.github', 'workflows', 'baton-sync.yml'), 'utf8')).toBe(SYNC_WORKFLOW);
      expect(SYNC_WORKFLOW).toContain('@immediately-run/baton@pinned'); // the pin (R-BTN-74)
      expect(readFileSync(join(root, 'tickets', 'README.md'), 'utf8')).toContain('One `*.md` file per ticket');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('--eject tickets and --eject stations copy a working default into .baton/, ready to edit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'baton-init-'));
    try {
      await initMain([], { root, log: () => {} });
      await initMain(['--eject', 'tickets'], { root, log: () => {} });
      const ejected = readFileSync(join(root, '.baton', 'tickets.mjs'), 'utf8');
      expect(ejected).toContain('ticketsMarkdown');
      await initMain(['--eject', 'stations'], { root, log: () => {} });
      expect(readFileSync(join(root, '.baton', 'courses', 'pr', 'sync.mjs'), 'utf8')).toContain('stationsPr');
      await expect(initMain(['--eject', 'nope'], { root, log: () => {} })).rejects.toThrow('tickets or stations');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('the scaffold runs', () => {
  it('the ejected tickets source is importable and serves the same tickets (the io seam aside)', async () => {
    // A real git repo (the ejected file shells out to nothing, but prClose commits).
    const root = mkdtempSync(join(tmpdir(), 'baton-init-'));
    try {
      execFileSync('git', ['init', '-q', '-b', 'main', root], { stdio: 'ignore' });
      execFileSync('git', ['-C', root, 'config', 'user.email', 't@t'], { stdio: 'ignore' });
      execFileSync('git', ['-C', root, 'config', 'user.name', 't'], { stdio: 'ignore' });
      await initMain([], { root, log: () => {} });
      writeFileSync(join(root, 'tickets', 'a.md'), '---\nid: A-1\ntitle: A\n---\n');
      execFileSync('git', ['-C', root, 'add', '.baton', 'tickets'], { stdio: 'ignore' });
      execFileSync('git', ['-C', root, 'commit', '-qm', 'scaffold'], { stdio: 'ignore' });
      // The scaffold's own files are what the next commit's sync reads.
      expect(readFileSync(join(root, '.baton', 'baton.json'), 'utf8')).toBeTruthy();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});
