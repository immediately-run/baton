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
const ALLOWED = [/^package\.json$/, /^README\.md$/, /^LICENSE$/, /^NOTICE$/, /^dist\/baton\.mjs$/, /^dist\/legProcess\.mjs$/, /^dist\/build\.json$/, /^dist\/defaults\/[\w./-]+\.(mjs|md)$/, /^dist\/defaults\/leg-wrapper\.example$/, /^scripts\/cloud-runner\.sh$/, /^skills\/baton-cloud-runner\/SKILL\.md$/];
const REQUIRED = ['package.json', 'LICENSE', 'NOTICE', 'dist/baton.mjs', 'dist/legProcess.mjs', 'dist/build.json', 'dist/defaults/tickets.mjs', 'dist/defaults/stubs/create-pr/implement.mjs', 'dist/defaults/courses/create-pr/implement.md', 'dist/defaults/leg-wrapper.example', 'scripts/cloud-runner.sh', 'skills/baton-cloud-runner/SKILL.md'];

const fail = (msg) => {
  process.stderr.write(`check-package: ${msg}\n`);
  process.exit(1);
};

const dir = mkdtempSync(join(tmpdir(), 'baton-package-'));
try {
  // `npm pack` runs `prepack` (build:cli), as `npm publish` does.
  // npm 12 prints an object keyed by package name where npm 10 and 11 print a one-element array.
  const report = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', dir], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
  const packed = Array.isArray(report) ? report[0] : Object.values(report)[0];
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
  if (!/no credential: BATON_KEY_FILE/.test(run.stderr)) fail(`the installed \`baton run\` did not reach its credential check:\n${run.stdout}${run.stderr}`);
  // B-97: the release dropped the transition's IR_BATON_* spellings — only they set, the same check.
  const legacy = spawnSync(join(app, 'node_modules', '.bin', 'baton'), ['run'], { cwd: app, env: { ...env, IR_BATON_TOKEN: 'legacy' }, encoding: 'utf8' });
  if (!/no credential: BATON_KEY_FILE/.test(legacy.stderr)) fail(`the installed \`baton run\` still reads the dropped IR_BATON_* spellings:\n${legacy.stdout}${legacy.stderr}`);
  // The API client: an unknown role is refused by the CLI itself, before any request.
  const api = spawnSync(join(app, 'node_modules', '.bin', 'baton'), [], { cwd: app, env, encoding: 'utf8' });
  if (!/baton admin … \| baton owner …/.test(api.stderr)) fail(`the installed \`baton\` did not print its usage:\n${api.stdout}${api.stderr}`);

  // The prebuilt stand-ins (build-cli.mjs PREBUILT) carry every name the entry imports from the
  // on-demand bundlers: `baton home list` reaches homeMain and BATON_HOME on an API command
  // reaches resolveHomes — each was `… is not a function` in the package while a checkout worked.
  const home = spawnSync(join(app, 'node_modules', '.bin', 'baton'), ['home', 'list'], { cwd: app, env, encoding: 'utf8' });
  if (home.status !== 0 || !/no homes configured/.test(home.stdout)) fail(`the installed \`baton home list\` did not run:\n${home.stdout}${home.stderr}`);
  const homed = spawnSync(join(app, 'node_modules', '.bin', 'baton'), ['board', 'none'], { cwd: app, env: { ...env, BATON_HOME: 'none' }, encoding: 'utf8' });
  if (/is not a function/.test(homed.stderr)) fail(`the installed \`baton\` misses a prebuilt export:\n${homed.stdout}${homed.stderr}`);
  // And for every other name, by the two lists themselves: each import the entry's source takes
  // from a bundler is named in that bundler's stand-in.
  const entry = readFileSync(join(ROOT, 'cli', 'baton.mjs'), 'utf8');
  const builder = readFileSync(join(ROOT, 'scripts', 'build-cli.mjs'), 'utf8');
  const taken = [...entry.matchAll(/const \{([^}]+)\} = await import\('\.\.\/scripts\/(baton-(?:cli|run|leg)\.mjs)'\)/g)];
  if (!taken.length) fail('cli/baton.mjs no longer imports its subcommands the way this check reads them');
  for (const m of taken) {
    const stand = new RegExp(`'${m[2].replace('.', '\\.')}': \`([^\`]*)\``).exec(builder)?.[1] ?? '';
    for (const name of m[1].split(',').map((n) => n.trim().split(/\s*:\s*/)[0]).filter(Boolean)) {
      if (!new RegExp(`\\b${name}\\b`).test(stand)) fail(`cli/baton.mjs imports ${name} from scripts/${m[2]}, which scripts/build-cli.mjs does not prebuild`);
    }
  }

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
    for (const f of ['.github/workflows/baton-sync.yml', '.baton/leg-wrapper.example']) {
      if (!existsSync(join(repo, f))) fail(`the installed \`baton repo init\` wrote no ${f}`);
    }
    if (!readFileSync(join(repo, '.github', 'workflows', 'baton-sync.yml'), 'utf8').includes(`ref: ${build.commit}`)) fail('the sync workflow does not pin the commit the package was built from');
    if (existsSync(join(repo, '.baton/courses/create-pr'))) fail('the installed init copied a sourced course into the home');
    execFileSync('git', ['-C', repo, 'add', '.baton']);
    execFileSync('git', ['-C', repo, '-c', 'user.name=Package check', '-c', 'user.email=package@example.test', 'commit', '-qm', 'course entry']);
    const show = spawnSync(join(app, 'node_modules', '.bin', 'baton'), ['course', 'show', 'create-pr'], { cwd: repo, env, encoding: 'utf8' });
    if (show.status !== 0 || !['course.json', 'legs/implement.mjs', 'legs/implement.md'].every((name) => show.stdout.includes(`--- ${name} ---`))) {
      fail(`the installed CLI did not show the bundled course: ${show.error ?? show.stderr}\n${show.stdout?.slice(0, 400)}`);
    }
  }

  process.stdout.write(`check-package OK — ${pkg.name}@${pkg.version}: ${files.length} files, ${Math.round(packed.size / 1024)} KB packed; the installed bin runs${build.dirty ? '; init refuses a modified-tree build' : `; init scaffolds create-pr at ${build.commit.slice(0, 10)}`}\n`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
