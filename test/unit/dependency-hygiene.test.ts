// dependency-hygiene.test.ts — B-132 (OWASP ASI04): a leg installs with lifecycle scripts off
// and from the lockfile only, and a package whose install script the repository needs is
// allowed by name, its scripts run alone. The standard courses' instructions prescribe exactly
// this procedure; the test proves it against the npm the legs run — a fixture package whose
// `postinstall` writes a marker is installed by `npm ci` under `ignore-scripts=true` (the
// configuration the runner image sets) and leaves no marker, and the allow procedure the
// instructions name for a package in `.baton/baton.json`'s `allow_install_scripts`
// (`npm rebuild <package> --ignore-scripts=false`) writes it. Offline: the fixture is a local
// tarball, nothing is fetched. Node only: it runs npm.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PKG = 'fixture-postinstall-marker';
const MARKER = 'installed-by-postinstall.txt';

/** One npm invocation; its failure carries npm's own words. */
function npm(cwd: string, args: string[]): void {
  try {
    execFileSync('npm', [...args, '--no-audit', '--no-fund'], {
      cwd, encoding: 'utf8', timeout: 120_000, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    throw new Error(`npm ${args.join(' ')} in ${cwd}: ${err.stderr?.trim() ?? err.message}`);
  }
}

describe('dependency hygiene in legs (B-132)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'baton-b132-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('npm ci under ignore-scripts installs the fixture and writes no marker; the allow procedure writes it', { timeout: 240_000 }, () => {
    // The fixture package: its postinstall writes a marker beside itself when it runs.
    const pkg = join(dir, PKG);
    mkdirSync(pkg);
    writeFileSync(join(pkg, 'package.json'), `${JSON.stringify({
      name: PKG, version: '1.0.0', description: 'a fixture whose postinstall writes a marker (B-132)', license: 'Apache-2.0',
      scripts: { postinstall: `node -e "require('fs').writeFileSync(__dirname + '/${MARKER}', 'ran')"` },
    }, null, 2)}\n`);
    writeFileSync(join(pkg, 'index.js'), `module.exports = ${JSON.stringify(PKG)};\n`);
    npm(pkg, ['pack', '--silent']);
    // The project a leg works in: the dependency a local tarball (offline), the lockfile
    // resolved from it, and the npm configuration the runner image sets — scripts off.
    const project = join(dir, 'project');
    mkdirSync(project);
    writeFileSync(join(project, 'package.json'), `${JSON.stringify({
      name: 'fixture-project', version: '1.0.0', private: true,
      dependencies: { [PKG]: `file:../${PKG}/${PKG}-1.0.0.tgz` },
    }, null, 2)}\n`);
    writeFileSync(join(project, '.npmrc'), 'ignore-scripts=true\n');
    npm(project, ['install', '--package-lock-only']);
    // The default: install from the lockfile, scripts off — the package arrives, the marker does not.
    npm(project, ['ci']);
    expect(existsSync(join(project, 'node_modules', PKG, 'index.js')), 'the package installed').toBe(true);
    expect(existsSync(join(project, 'node_modules', PKG, MARKER)), 'the postinstall ran under ignore-scripts').toBe(false);
    // The allow list's procedure: that package's scripts alone, by name — not scripts for all.
    npm(project, ['rebuild', PKG, '--ignore-scripts=false']);
    expect(readFileSync(join(project, 'node_modules', PKG, MARKER), 'utf8')).toBe('ran');
  });
});
