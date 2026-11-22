// R-BTN-133 / S-BTN-109: read-only script trees live beside Git, not in the agent's checkout.
import { lstat, mkdir, readFile, readdir, readlink, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { GIT_NONINTERACTIVE_ENV } from '../defaults/ticket-state';
import { builtinExecutor, type Executor } from './executor';
import { SAFE_GIT } from './home';
import { LegDependencies, removeSealed } from './leg-dependencies';
import { legScripts } from './leg-scripts';
import { PreparationError, prepareExec } from './preparation';
import { digest, treeFiles, within } from './tree-files';

const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const ID = /^[a-z][a-z0-9-]{0,63}$/;
const exists = (path: string) => lstat(path).then(() => true, (e) => { if (e.code === 'ENOENT') return false; throw e; });

export class LegTrees {
  private readonly host = builtinExecutor();
  private tail = Promise.resolve();
  private readonly held = new Map<string, number>();

  constructor(private readonly home: string, private readonly executor: Executor, private readonly wrapper: string) {}

  private git(cwd: string, args: string[], signal: AbortSignal) {
    return prepareExec(this.host, this.wrapper, { argv: ['git', ...SAFE_GIT, ...args], cwd, signal, env: { ...process.env, ...GIT_NONINTERACTIVE_ENV } });
  }

  private async readGit(cwd: string, args: string[], signal: AbortSignal): Promise<string> {
    const result = await this.git(cwd, args, signal);
    if (result.status !== 0) throw new PreparationError('transient', `git ${args[0]} failed (R-BTN-133)`);
    return result.stdout;
  }

  /** R-BTN-143. Never let a caller-supplied ref, the remote's HEAD, or local HEAD attest to the sha. */
  async onDefault(repository: string, sha: string, branch: string, signal: AbortSignal): Promise<boolean> {
    if (!ID.test(repository) || !SHA.test(sha) || typeof branch !== 'string' || !branch) return false;
    const from = `refs/heads/${branch}`;
    if ((await this.git(this.home, ['check-ref-format', from], signal)).status !== 0) return false;
    const ref = `refs/baton/${repository}/default`;
    const contained = async () => (await this.git(this.home, ['merge-base', '--is-ancestor', sha, ref], signal)).status === 0;
    if (await contained()) return true;
    const fetched = await this.git(this.home, ['fetch', '--no-tags', 'origin', `+${from}:${ref}`], signal);
    return fetched.status === 0 && await contained();
  }

  private async serialized<T>(f: () => Promise<T>): Promise<T> {
    const next = this.tail.then(f);
    this.tail = next.then(() => {}, () => {});
    return await next;
  }

  async init(signal: AbortSignal): Promise<string> {
    const gitDir = (await this.readGit(this.home, ['rev-parse', '--absolute-git-dir'], signal)).trim();
    const base = join(await realpath(gitDir), 'baton');
    await mkdir(base, { recursive: true });
    if (await realpath(base) !== base) throw new PreparationError('spec', 'the Baton git directory is a symlink');
    const stop = join(base, 'package.json');
    await writeFile(stop, '{"private":true}\n', { flag: 'wx' }).catch(async (e) => {
      if (e.code !== 'EEXIST' || !(await lstat(stop)).isFile() || (await readFile(stop, 'utf8')) !== '{"private":true}\n') throw e;
    });
    return base;
  }

  async prepare(repository: string, sha: string, course: string, signal: AbortSignal): Promise<{
    tree: string; dir: string; roots: string[]; scripts: Map<string, string>; release(): Promise<void>;
  }> {
    if (!ID.test(repository) || !ID.test(course) || !SHA.test(sha)) throw new PreparationError('spec', 'invalid leg tree key (R-BTN-133)');
    return this.serialized(async () => {
      const base = await this.init(signal);
      const trees = join(base, 'trees', repository);
      const deps = join(base, 'deps');
      for (const dir of [trees, deps]) {
        await mkdir(dir, { recursive: true });
        if (await realpath(dir) !== dir) throw new PreparationError('spec', `symlink in ${dir}`);
      }
      const tree = join(trees, `${sha}-${digest(`/.baton/courses/${course}`).slice(0, 12)}`);
      const stamp = `${tree}.ready`;
      const dotBaton = join(tree, '.baton');
      const dir = join(dotBaton, 'courses', course);
      const dependencyCache = new LegDependencies(deps, this.executor, this.wrapper);

      const inspect = async (): Promise<Map<string, string>> => {
        if (await realpath(tree) !== tree) throw new PreparationError('spec', 'leg tree is a symlink');
        const head = (await this.readGit(tree, ['rev-parse', 'HEAD'], signal)).trim();
        if (head !== sha) throw new Error('leg tree is at a different commit');
        const entries = await this.readGit(tree, ['ls-tree', '-r', '-z', sha, '--', '.baton'], signal);
        const submodule = entries.split('\0').find((e) => e.startsWith('160000 '));
        if (submodule) throw new PreparationError('spec', `submodule ${submodule.split('\t')[1]} in leg tree (R-BTN-133)`);
        const status = await this.readGit(tree, ['status', '--porcelain', '-z', '--ignored=matching', '--untracked-files=all'], signal);
        const links = new Map<string, string>();
        for (const line of status.split('\0').filter(Boolean)) {
          const rel = line.slice(3);
          if (!/^(?:\?\?|!!) \.baton\/(?:courses\/[a-z][a-z0-9-]*\/)?node_modules$/.test(line)) throw new Error(`leg tree is dirty: ${rel}`);
          const link = join(tree, rel);
          if (!(await lstat(link)).isSymbolicLink()) throw new Error(`leg tree has unverified ${rel}`);
          // A link to a missing digest can be reinstalled from its lockfile. Do not follow it
          // while collecting; require its exact lexical target to be a cache entry.
          const target = resolve(await readlink(link));
          if (!within(deps, target) || !/^[0-9a-f]{64}$/.test(target.slice(deps.length + 1))) throw new PreparationError('spec', `symlink ${rel} leaves the dependency cache`);
          links.set(link, target);
        }
        return links;
      };

      let links: Map<string, string> | undefined;
      if (await exists(stamp)) {
        try {
          links = await inspect();
          if (await treeFiles(tree, 'verify', signal, links) !== (await readFile(stamp, 'utf8')).trim()) links = undefined;
        } catch (e) {
          if (e instanceof PreparationError && e.kind === 'spec') throw e;
          signal.throwIfAborted();
          links = undefined;
        }
      }
      const rebuild = async () => {
        if (this.held.has(tree)) throw new PreparationError('transient', 'cannot replace a leg tree while a claim uses it');
        await this.removeTree(tree, signal);
        await this.readGit(this.home, ['worktree', 'add', '--quiet', '--detach', '--no-checkout', tree, sha], signal);
        await this.readGit(tree, ['sparse-checkout', 'set', '--no-cone', '/.baton/'], signal);
        await this.readGit(tree, ['read-tree', '-m', '-u', sha], signal);
        return inspect();
      };
      if (!links) links = await rebuild();
      // Never let npm read a manifest through an escaping symlink.
      await treeFiles(tree, await exists(stamp) ? 'verify' : 'inspect', signal, links);
      const desired = new Map<string, string>();
      for (const root of [dotBaton, dir]) {
        if (!await exists(root)) continue;
        const target = await dependencyCache.prepare(root, signal);
        if (target) desired.set(join(root, 'node_modules'), target);
      }
      let ready = await exists(stamp);
      if (ready && (links.size !== desired.size || [dotBaton, dir].some((root) => {
        const link = join(root, 'node_modules');
        return links!.get(link) !== desired.get(link);
      }))) {
        links = await rebuild();
        ready = false;
      }
      if (!ready) {
        for (const [link, target] of desired) await symlink(target, link, 'dir');
        links = desired;
        const seal = await treeFiles(tree, 'seal', signal, links);
        await writeFile(stamp, `${seal}\n`, { flag: 'wx' });
      }
      const legs = join(dir, 'legs');
      const entries = await readdir(legs, { withFileTypes: true }).catch((e) => { if (e.code === 'ENOENT') return []; throw e; });
      let scripts: Map<string, string>;
      try { scripts = new Map([...legScripts(entries.filter((e) => e.isFile() || e.isSymbolicLink()).map((e) => e.name))].map(([name, file]) => [name, join(legs, file)])); }
      catch (e) { throw new PreparationError('spec', (e as Error).message); }
      const now = new Date();
      await utimes(stamp, now, now);
      this.held.set(tree, (this.held.get(tree) ?? 0) + 1);
      let released = false;
      return { tree, dir, roots: [tree, ...new Set(desired.values())], scripts, release: async () => {
        if (released) return;
        released = true;
        await this.serialized(async () => {
          const left = (this.held.get(tree) ?? 1) - 1;
          if (left) this.held.set(tree, left);
          else this.held.delete(tree);
          await this.collect(join(base, 'trees'), trees, deps);
        });
      } };
    });
  }

  private async removeTree(tree: string, signal = AbortSignal.timeout(30_000)): Promise<void> {
    signal.throwIfAborted();
    await rm(`${tree}.ready`, { force: true });
    if (await exists(tree)) {
      // Unseal before Git removes the worktree; the walk never follows cache links.
      await treeFiles(tree, 'unseal', signal);
      const removed = await this.git(this.home, ['worktree', 'remove', '--force', tree], signal);
      if (removed.status !== 0) await removeSealed(tree);
    }
    await this.readGit(this.home, ['worktree', 'prune', '--expire=now'], signal);
  }

  private async collect(allTrees: string, trees: string, deps: string): Promise<void> {
    const names = (await readdir(trees)).filter((n) => /^(?:[0-9a-f]{40}|[0-9a-f]{64})-[0-9a-f]{12}\.ready$/.test(n));
    const stamps = await Promise.all(names.map(async (n) => ({ tree: join(trees, n.slice(0, -6)), time: (await lstat(join(trees, n))).mtimeMs })));
    stamps.sort((a, b) => b.time - a.time);
    for (const { tree } of stamps.slice(3)) if (!this.held.has(tree)) await this.removeTree(tree);
    const used = new Set<string>();
    const collectLink = async (dir: string) => {
      const target = await readlink(join(dir, 'node_modules')).catch(() => null);
      if (target) used.add(target);
    };
    for (const repo of (await readdir(allTrees, { withFileTypes: true })).filter((e) => e.isDirectory())) {
      const dir = join(allTrees, repo.name);
      for (const stamp of (await readdir(dir)).filter((n) => n.endsWith('.ready'))) {
        const baton = join(dir, stamp.slice(0, -6), '.baton');
        await collectLink(baton);
        const courses = join(baton, 'courses');
        for (const course of await readdir(courses, { withFileTypes: true }).catch(() => [])) {
          if (course.isDirectory()) await collectLink(join(courses, course.name));
        }
      }
    }
    for (const key of (await readdir(deps)).filter((n) => /^[0-9a-f]{64}$/.test(n))) {
      const path = join(deps, key);
      if (used.has(path)) continue;
      await rm(`${path}.ready`, { force: true });
      await removeSealed(path);
    }
  }
}
