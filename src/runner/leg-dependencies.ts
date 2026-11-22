import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Executor } from './executor';
import { PreparationError, prepareExec } from './preparation';
import { digest, treeFiles } from './tree-files';

const absent = (e: NodeJS.ErrnoException) => e.code === 'ENOENT';
const bytesAt = (file: string) => readFile(file).catch((e) => { if (absent(e)) return null; throw e; });

export async function removeSealed(path: string): Promise<void> {
  await treeFiles(path, 'unseal').catch((e) => { if (!absent(e)) throw e; });
  await rm(path, { recursive: true, force: true });
}

/** Read only the two explicit install roots. No implicit npm project or workspace discovery. */
export async function dependencyInputs(root: string): Promise<{ manifest: Buffer; lock: Buffer; lockName: string } | null> {
  const spec = (why: string) => new PreparationError('spec', `${root}: ${why} (R-BTN-133)`);
  for (const name of ['pnpm-lock.yaml', 'yarn.lock']) if (await bytesAt(join(root, name))) throw spec(`unsupported ${name}`);
  const manifest = await bytesAt(join(root, 'package.json'));
  if (!manifest) return null;
  const parse = (bytes: Buffer, name: string) => {
    try { return JSON.parse(bytes.toString()) as Record<string, unknown>; }
    catch { throw spec(`${name} is not JSON`); }
  };
  const pkg = parse(manifest, 'package.json');
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) throw spec('package.json must be an object');
  if ('workspaces' in pkg) throw spec('workspaces are not supported');
  if (!['dependencies', 'optionalDependencies'].some((key) => Object.keys((pkg[key] as object | undefined) ?? {}).length)) return null;
  for (const lockName of ['npm-shrinkwrap.json', 'package-lock.json']) {
    const lock = await bytesAt(join(root, lockName));
    if (!lock) continue;
    // Installs happen in an isolated staging directory. Local references cannot be made
    // reproducible by copying just the manifest and lock there, so refuse them explicitly.
    const inspect = (value: unknown): void => {
      if (typeof value === 'string' && /^(?:file|link):/.test(value)) throw spec(`unsupported local dependency ${value}`);
      if (value && typeof value === 'object') for (const child of Object.values(value)) inspect(child);
    };
    inspect(pkg.dependencies);
    inspect(pkg.optionalDependencies);
    inspect(parse(lock, lockName));
    return { manifest, lock, lockName };
  }
  throw spec('dependencies need package-lock.json or npm-shrinkwrap.json');
}

export class LegDependencies {
  constructor(private readonly dir: string, private readonly executor: Executor, private readonly wrapper: string) {}

  async prepare(root: string, signal: AbortSignal): Promise<string | null> {
    const input = await dependencyInputs(root);
    if (!input) return null;
    await mkdir(this.dir, { recursive: true });
    const exec = (argv: string[], cwd: string) => prepareExec(this.executor, this.wrapper, { argv, cwd, signal });
    const npm = await exec(['npm', '--version'], this.dir);
    if (npm.status !== 0) throw new PreparationError('transient', 'npm --version failed (R-BTN-133)');
    const key = digest([digest(input.lock), digest(input.manifest), process.versions.modules, process.platform, process.arch, npm.stdout.trim()].join('\n'));
    const content = join(this.dir, key);
    const stamp = `${content}.ready`;
    const expected = await bytesAt(stamp);
    if (expected && await treeFiles(content, 'verify', signal).catch(() => null) === expected.toString().trim()) return content;
    signal.throwIfAborted();
    await rm(stamp, { force: true });
    await removeSealed(content);
    const staging = await mkdtemp(join(this.dir, '.install-'));
    try {
      await writeFile(join(staging, 'package.json'), input.manifest);
      await writeFile(join(staging, input.lockName), input.lock);
      const result = await exec(['npm', 'ci', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts'], staging);
      if (result.status !== 0) {
        const kind = /\bEUSAGE\b/.test(result.stderr) ? 'spec' : /\bENOSPC\b/.test(result.stderr) ? 'capability' : 'transient';
        throw new PreparationError(kind, `npm ci failed for ${root} (${kind}; exit ${result.status ?? 'unavailable'})`);
      }
      const modules = join(staging, 'node_modules');
      await mkdir(modules, { recursive: true });
      if (!(await lstat(modules)).isDirectory()) throw new PreparationError('spec', 'npm did not create a node_modules directory');
      await rename(modules, content);
      const seal = await treeFiles(content, 'seal', signal);
      await writeFile(stamp, `${seal}\n`, { flag: 'wx' });
      return content;
    } finally {
      await removeSealed(staging);
    }
  }
}
