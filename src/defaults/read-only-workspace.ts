// B-141 / R-BTN-183: review input is made from Git objects, not from a branch checkout.
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';

const OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const CONTROL = new Set([
  '.git', '.baton', '.opencode', '.claude', '.agents', 'opencode.json', 'opencode.jsonc',
  'agents.md', 'claude.md', 'claude.local.md', '.mcp.json',
]);

type Git = (args: string[]) => Buffer;

export function readOnlyWorkspace(ctx: {
  checkout: string;
  snapshot: { sha: string };
  review_head?: string;
  ticket: { path?: string | null; file?: string };
}, instructions: string | null, git: Git, byteLimit: number) {
  const { sha } = ctx.snapshot;
  const head = ctx.review_head;
  if (typeof head !== 'string' || !OBJECT_ID.test(head) || !OBJECT_ID.test(sha)) {
    throw new Error('reads_only needs ctx.review_head: the exact review commit in the home object store (R-BTN-183)');
  }
  for (const commit of [sha, head]) {
    if (git(['cat-file', '-t', commit]).toString().trim() !== 'commit') throw new Error('reads_only expects a commit');
  }
  const base = git(['merge-base', sha, head]).toString().trim();
  const diff = ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--no-renames', '--no-relative', '--ignore-submodules=none'];
  const tmp = realpathSync(tmpdir());
  const fromCheckout = relative(realpathSync(ctx.checkout), tmp);
  if (fromCheckout === '' || (fromCheckout !== '..' && !fromCheckout.startsWith(`..${sep}`))) {
    throw new Error('reads_only needs a temporary directory outside the checkout');
  }
  const cwd = mkdtempSync(join(tmp, 'baton-review-'));
  const cleanup = () => rmSync(cwd, { recursive: true, force: true });
  let bytes = 0;
  const save = (path: string, content: Buffer | string) => {
    bytes += Buffer.byteLength(content);
    if (bytes > byteLimit) throw new Error('reads_only review data exceeds the workspace limit');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, { mode: 0o600, flag: 'wx' });
  };
  try {
    save(join(cwd, 'review.diff'), git([...diff, base, head, '--']));
    const raw = git([...diff, '--raw', '-z', '--no-abbrev', base, head, '--']);
    const decoded = raw.toString('utf8');
    if (!raw.equals(Buffer.from(decoded))) throw new Error('reads_only needs UTF-8 Git paths');
    const records = decoded.split('\0');
    for (let i = 0; i < records.length - 1; i += 2) {
      const [, mode, , oid] = records[i].slice(1).split(' ');
      if (mode !== '100644' && mode !== '100755') continue; // no links, submodules or deletions
      const parts = records[i + 1].split('/');
      if (parts.some((name) => !name || name === '.' || name === '..' || name.includes('\\') || CONTROL.has(name.toLowerCase()))) continue;
      if (!OBJECT_ID.test(oid)) throw new Error('invalid blob id in reads_only diff');
      save(join(cwd, 'changes', ...parts), git(['cat-file', 'blob', oid]));
    }
    const instructionFile = instructions == null ? '' : join(cwd, 'instructions.md');
    if (instructions != null) save(instructionFile, instructions);
    let ticket = '';
    if (ctx.ticket.path && git(['--literal-pathspecs', 'ls-tree', '-z', sha, '--', ctx.ticket.path]).length) {
      ticket = join(cwd, 'ticket.md');
      save(ticket, git(['cat-file', 'blob', `${sha}:${ctx.ticket.path}`]));
    } else if (!ctx.ticket.path && ctx.ticket.file) {
      // A pathless ticket is a regular file the runner wrote from the ticket source.
      const stat = lstatSync(ctx.ticket.file);
      if (!stat.isFile() || stat.size > byteLimit - bytes) throw new Error('invalid reads_only ticket file');
      ticket = join(cwd, 'ticket.md');
      save(ticket, readFileSync(ctx.ticket.file));
    }
    return { cwd, instructions: instructionFile, ticket, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}
