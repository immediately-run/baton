// check-package.mjs — the npm package as a consumer installs it (R-BTN-134's `npx --yes
// @immediately-run/baton@<version>`): pack the tarball `npm publish` would upload, install it
// into an empty directory, and run the installed `baton`. Fails when the tarball carries a file
// outside its allowlist, misses one the CLI needs, or its bin cannot start — the mistakes a
// checkout's own suite never sees, since it runs cli/baton.mjs with every devDependency present.
//
//   node scripts/check-package.mjs        (CI runs it before the release job may publish)
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const ALLOWED = [/^package\.json$/, /^README\.md$/, /^LICENSE$/, /^NOTICE$/, /^dist\/baton\.mjs$/, /^dist\/legProcess\.mjs$/, /^dist\/build\.json$/, /^dist\/defaults\/[\w./-]+\.(mjs|md)$/, /^dist\/defaults\/leg-wrapper\.example$/];
const REQUIRED = ['package.json', 'LICENSE', 'NOTICE', 'dist/baton.mjs', 'dist/legProcess.mjs', 'dist/build.json', 'dist/defaults/tickets.mjs', 'dist/defaults/stubs/create-pr/implement.mjs', 'dist/defaults/courses/create-pr/implement.md', 'dist/defaults/leg-wrapper.example'];

const fail = (msg) => {
  process.stderr.write(`check-package: ${msg}\n`);
  process.exit(1);
};

const dir = mkdtempSync(join(tmpdir(), 'baton-package-'));
try {
  // `npm pack` runs `prepack` (build:cli), as `npm publish` does.
  const [packed] = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', dir], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
  const files = packed.files.map((f) => f.path);
  const stray = files.filter((f) => !ALLOWED.some((re) => re.test(f)));
  if (stray.length) fail(`the tarball carries files outside its allowlist: ${stray.join(', ')}`);
  const missing = REQUIRED.filter((f) => !files.includes(f));
  if (missing.length) fail(`the tarball misses ${missing.join(', ')}`);

  const app = join(dir, 'app');
  execFileSync('mkdir', [app]);
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'consumer', private: true }));
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--silent', join(dir, packed.filename)], { cwd: app, stdio: ['ignore', 'ignore', 'inherit'] });

  // The runner bundle and its leg wrapper load: `run` reaches its credential check (§6.4) and
  // stops there, so nothing contacts a Baton. The environment is cleared of any real credential.
  const env = { PATH: process.env.PATH, HOME: dir };
  const run = spawnSync(join(app, 'node_modules', '.bin', 'baton'), ['run'], { cwd: app, env, encoding: 'utf8' });
  if (!/no credential: IR_BATON_KEY_FILE/.test(run.stderr)) fail(`the installed \`baton run\` did not reach its credential check:\n${run.stdout}${run.stderr}`);
  // The API client: an unknown role is refused by the CLI itself, before any request.
  const api = spawnSync(join(app, 'node_modules', '.bin', 'baton'), [], { cwd: app, env, encoding: 'utf8' });
  if (!/baton admin … \| baton owner …/.test(api.stderr)) fail(`the installed \`baton\` did not print its usage:\n${api.stdout}${api.stderr}`);

  // `baton repo init` (G1 of the 2026-10-19 gap run): the installed package scaffolds create-pr
  // with no checkout and no esbuild, naming the commit it was built from as the course's source.
  const build = JSON.parse(readFileSync(join(app, 'node_modules', '@immediately-run', 'baton', 'dist', 'build.json'), 'utf8'));
  if (build.dirty && process.env.CI) fail(`the package was built from a modified tree (${build.commit}); CI builds a clean one`);
  const repo = join(dir, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  const init = spawnSync(join(app, 'node_modules', '.bin', 'baton'), ['repo', 'init'], { cwd: repo, env, encoding: 'utf8' });
  if (build.dirty) {
    if (!/built from a modified tree/.test(init.stderr)) fail(`a modified-tree package's \`baton repo init\` did not refuse to pin itself:\n${init.stdout}${init.stderr}`);
  } else {
    if (init.status !== 0) fail(`the installed \`baton repo init\` failed:\n${init.stdout}${init.stderr}`);
    const settings = JSON.parse(readFileSync(join(repo, '.baton', 'baton.json'), 'utf8'));
    const want = `github/${build.repository}/${build.commit}/create-pr`;
    if (settings.courses?.[0]?.source !== want) fail(`init named the source ${settings.courses?.[0]?.source}, not ${want}`);
    for (const f of ['.baton/courses/create-pr/course.json', '.baton/courses/create-pr/legs/implement.mjs', '.baton/courses/create-pr/legs/implement.md', '.github/workflows/baton-sync.yml', '.baton/leg-wrapper.example']) {
      if (!existsSync(join(repo, f))) fail(`the installed \`baton repo init\` wrote no ${f}`);
    }
    if (!readFileSync(join(repo, '.github', 'workflows', 'baton-sync.yml'), 'utf8').includes(`ref: ${build.commit}`)) fail('the sync workflow does not pin the commit the package was built from');
  }

  process.stdout.write(`check-package OK — ${pkg.name}@${pkg.version}: ${files.length} files, ${Math.round(packed.size / 1024)} KB packed; the installed bin runs${build.dirty ? '; init refuses a modified-tree build' : `; init scaffolds create-pr at ${build.commit.slice(0, 10)}`}\n`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
