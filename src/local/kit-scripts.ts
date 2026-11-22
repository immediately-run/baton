import { existsSync } from 'node:fs';
import { cp, lstat, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinExecutor } from '../runner/executor';
import { LegDependencies, removeSealed } from '../runner/leg-dependencies';
import { cleanNodeEnv, PREPARE_TIMEOUT_MS, requireLegNode } from '../runner/preparation';
import { treeFiles } from '../runner/tree-files';

const beside = fileURLToPath(new URL('./legProcess.mjs', import.meta.url));
const wrapper = existsSync(beside) ? beside : fileURLToPath(new URL('../runner/legProcess.mjs', import.meta.url));

export async function withKitScripts<T>(root: string, course: string, use: (call: (name: string, file: string, args?: unknown[], cwd?: string) => Promise<unknown>) => Promise<T>): Promise<T> {
  requireLegNode();
  const scratch = await mkdtemp(join(tmpdir(), 'baton-course-kit-'));
  const executor = builtinExecutor();
  try {
    const tree = join(scratch, 'tree');
    const baton = join(tree, '.baton');
    const dir = join(baton, 'courses', course);
    if (!(await lstat(join(root, '.baton'))).isDirectory()) throw new Error('.baton must be a directory (R-BTN-133)');
    await cp(join(root, '.baton'), baton, { recursive: true, verbatimSymlinks: true,
      filter: (path) => !['node_modules', '.git'].includes(basename(path)) });
    await writeFile(join(scratch, 'package.json'), '{"private":true}\n');
    const signal = AbortSignal.timeout(PREPARE_TIMEOUT_MS);
    await treeFiles(tree, 'inspect', signal);
    const deps = new LegDependencies(join(scratch, 'deps'), executor, wrapper);
    const links = new Map<string, string>();
    for (const at of [baton, dir]) {
      const dependency = await deps.prepare(at, signal);
      if (dependency != null) {
        const link = join(at, 'node_modules');
        await symlink(dependency, link, 'dir');
        links.set(link, dependency);
      }
    }
    await treeFiles(tree, 'seal', signal, links);
    const roots = [tree, ...new Set(links.values())];
    const call = async (name: string, file: string, args: unknown[] = [], cwd = tree) => {
      const handle = await executor.start({ brief: { kind: 'leg', session_id: 'kit', checkout: cwd, paths: roots, wrapper, env: cleanNodeEnv(process.env) } });
      try {
        const result = await executor.exec(handle, ['node', wrapper, name, join(dir, 'legs', file)], {
          cwd, stdin: `${JSON.stringify({ args, roots })}\n`, timeout_s: 120,
        }).result;
        const out = JSON.parse(result.stdout.trimEnd().split('\n').at(-1) || '{}') as { ok?: boolean; result?: unknown; error?: string };
        if (!out.ok) throw new Error(out.error ?? `wrapper ${name} failed (status ${result.status ?? 'unavailable'})`);
        return out.result;
      } finally { await executor.stop(handle, 'kit-ended'); }
    };
    return await use(call);
  } finally { await removeSealed(scratch); }
}
