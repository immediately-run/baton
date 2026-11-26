// Real git, with all files (including an optional bare origin) under one disposable root.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export class GitRepo {
  readonly root: string;
  readonly dir: string;
  readonly bare: string;

  constructor(prefix: string, { origin, dir }: { origin?: true | string; dir?: string } = {}) {
    this.root = dir ?? mkdtempSync(join(tmpdir(), prefix));
    this.dir = dir ?? join(this.root, 'work');
    this.bare = join(this.root, 'origin');
    mkdirSync(this.dir, { recursive: true });
    this.git('init', '-q', '-b', 'main');
    this.git('config', 'user.email', 'fixture@example.invalid');
    this.git('config', 'user.name', 'Baton fixture');
    this.git('config', 'commit.gpgsign', 'false');
    if (origin === true) this.git('init', '-q', '--bare', '-b', 'main', this.bare);
    if (origin) this.git('remote', 'add', 'origin', origin === true ? this.bare : origin);
  }

  git(...args: string[]): string {
    return execFileSync('git', ['-C', this.dir, ...args], { encoding: 'utf8' }).trim();
  }

  write(path: string, text: string): void {
    const file = join(this.dir, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }

  sha(): string { return this.git('rev-parse', 'HEAD'); }
  blob(path: string): string { return this.git('rev-parse', `HEAD:${path}`); }

  commit(message = 'fixture', paths = ['-A']): string {
    this.git('add', ...paths);
    this.git('commit', '--allow-empty', '-qm', message);
    return this.sha();
  }

  dispose(): void { rmSync(this.root, { recursive: true, force: true }); }
}
