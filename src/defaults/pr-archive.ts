// B-258 (S-BTN-232): the archive leg's close. The claim supplies the applied answer and prior
// ends, not the ticket file. Ticket files are Dibber's to write (B-326): the close marks the
// ticket done through the pinned `dibber` (the host's BATON_DIBBER, else the stub's pin) and then
// `git mv`s the file into `<items>/archive/` — a move, not a write of its content — and commits
// and pushes that itself. Dibber has no move verb (0.4.0: new, set, claim, done).
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { dibberWords } from './dibber';
import { gitText } from './git.mjs';
import type { CloseCtx } from './pr-close';
import { resolveDelivered } from './pr-verify';
import { readItems } from './read-items';
import { bareTicketId, ticketsBranch } from './ticket-state';
import { readTicketSettings } from './tickets-config';
import { parseFrontmatter } from './tickets-markdown';

interface ArchiveCtx extends CloseCtx {
  snapshot?: { sha: string };
  signed_control?: { agent_command?: string };
  claim?: CloseCtx['claim'] & { station?: string };
  person_answer?: { leg: string; option: string; answered_at: number; answered_by: string };
  previous_attempts?: {
    end_reason: string | null;
    ended_at: number | null;
    ended_at_sha?: string;
    detail: string | null;
    legs: { leg: string; reached: string | null; outcome: string }[];
  }[];
}

export function archiveClose(ctx: ArchiveCtx, result: { reached?: string }): string {
  const answer = ctx.person_answer;
  if (ctx.leg !== 'archive' || ctx.claim?.station !== 'confirmed' || result?.reached !== 'archived' ||
      answer?.leg !== 'confirm' || answer.option !== 'confirmed' || !/^(owner|human):/.test(answer.answered_by)) {
    throw new Error("archive requires the owner's applied confirmed answer");
  }
  // An archive retry can follow a failed archive attempt. Use the latest completed delivery,
  // not simply the most recent claim. A filed answer followed by a new delivery uses the new end.
  const end = ctx.previous_attempts?.find((p) => p.end_reason === 'suspended:delivered' &&
    p.legs.some((l) => l.reached === 'delivered' && l.outcome === 'finished'));
  const first = end?.ended_at_sha;
  const detail = end?.detail ?? '';
  // B-257 truncated at character 199. Never resolve a partial hash or guess the missing tail.
  const legacy = /^delivered at ((?:[0-9a-f]{10}, ){14}[0-9a-f]{10}), [0-9a-f]{6}…$/.exec(detail);
  const commits = (legacy?.[1] ?? /^delivered at ([0-9a-f]{10}(?:, [0-9a-f]{10})*)(?:: |$)/.exec(detail)?.[1])?.split(', ');
  if (!end || end.ended_at == null || end.ended_at > answer.answered_at || !first || !/^[0-9a-f]{40}$/.test(first) || commits?.[0] !== first.slice(0, 10)) {
    throw new Error("archive requires the confirmed delivery's end evidence");
  }
  if (!ctx.ticket.path) throw new Error('archive requires a ticket file in git');
  const branch = ticketsBranch(ctx.checkout, ctx.default_branch);
  const pin = ctx.signed_control?.agent_command ?? ctx.snapshot?.sha;
  if (!pin || !/^[0-9a-f]{40}$/.test(pin)) throw new Error('archive requires its snapshot to read the Dibber pin');
  const settings = JSON.parse(gitText(ctx.checkout, 'show', `${pin}:.baton/baton.json`));
  return archiveTicket(ctx.checkout, branch, bareTicketId(ctx.ticket), {
    path: ctx.ticket.path, shas: [first, ...commits.slice(1)], truncated: legacy != null, dibber: dibberWords(settings),
  });
}

const TRIES = 6;
const movedOnPush = (detail: string): boolean => /non-fast-forward|fetch first|stale info/.test(detail);

/** Never descend through a git symlink, including a dangling link at the destination. */
function regularDirs(root: string, path: string, missingOk = false): void {
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) throw new Error(`invalid ticket directory: ${path}`);
  for (const part of parts) {
    root = join(root, part);
    const stat = lstatSync(root, { throwIfNoEntry: false });
    if (!stat && missingOk) return;
    if (!stat?.isDirectory()) throw new Error(`not a regular ticket directory: ${path}`);
  }
}

/** Archive `id` on `branch` in a detached worktree of a fresh fetch, so the caller's checkout is
 *  never written and a failed attempt leaves the repository as it was: Dibber marks it done,
 *  git moves it under `archive/`, and the commit is pushed — retried when the branch moved. A
 *  retry that finds this delivery's archive already pushed returns that commit. */
export function archiveTicket(root: string, branch: string, id: string, delivered: { path: string; shas: string[]; truncated: boolean; dibber: string[] }): string {
  if (!/^[A-Za-z0-9]+-[A-Za-z0-9]+$/.test(id)) throw new Error(`${id}: invalid archive ticket id`);
  const describe = `${id} → done`;
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    gitText(root, 'fetch', '-q', 'origin', branch);
    const dir = mkdtempSync(join(tmpdir(), 'baton-archive-'));
    try {
      // The head the push must extend: the commit the fetch just brought.
      gitText(root, 'worktree', 'add', '-q', '--detach', dir, 'FETCH_HEAD');
      const done = archiveIn(dir, branch, id, delivered);
      if ('existing' in done) return done.existing;
      // The host's provenance trailers (B-16), as every ticket commit carries them.
      const trailers = (process.env.TICKET_TRAILERS ?? '').trim();
      if (!trailers && process.env.TICKET_REQUIRE_TRAILERS === '1') throw new Error(`${describe}: TICKET_REQUIRE_TRAILERS=1, but TICKET_TRAILERS is empty`);
      gitText(dir, 'commit', '-q', '-m', trailers ? `${done.message}\n\n${trailers}` : done.message);
      try {
        gitText(dir, 'push', '-q', 'origin', `HEAD:refs/heads/${branch}`);
        return gitText(dir, 'rev-parse', 'HEAD');
      } catch (e) {
        const detail = String((e as { stderr?: string }).stderr || (e as Error).message);
        if (!movedOnPush(detail)) {
          const why = detail.trim().split('\n').map((l) => l.trim()).filter((l) => l !== '' && !/^To /.test(l) && !/failed to push some refs/.test(l));
          throw new Error(`${describe}: the push was refused: ${why.join('; ') || 'no reason given'}`);
        }
        if (attempt === TRIES) throw new Error(`${describe}: push refused ${TRIES} times: ${detail.trim().split('\n').at(-1)}`);
      }
    } finally {
      try {
        gitText(root, 'worktree', 'remove', '--force', dir);
      } catch {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }
  throw new Error(`${describe}: no archive attempt completed`);
}

/** One attempt in the worktree `dir`: the staged archive and its message, or the commit that
 *  already archived this delivery. */
function archiveIn(dir: string, branch: string, id: string, delivered: { path: string; shas: string[]; truncated: boolean; dibber: string[] }): { message: string } | { existing: string } {
  const settings = readTicketSettings(dir, dir);
  const items = (settings.items ?? 'tickets').replace(/\/$/, '');
  regularDirs(dir, items, true);
  const matches = readItems(dir, items).filter((f) => /\.mdx?$/i.test(f.path) && parseFrontmatter(f.text)?.id === id);
  if (!matches.length) throw new Error(`${id}: no ${items}/${id}.mdx on origin/${branch}`);
  if (matches.length !== 1) throw new Error(`${id}: archive cannot identify a single ticket file`);
  const { path, text } = matches[0];
  const archived = path.startsWith('archive/');
  const from = `${items}/${path}`;
  const to = `${items}/archive/${path}`;
  if (delivered.path !== (archived ? `${items}/${path.slice('archive/'.length)}` : from)) {
    throw new Error(`${id}: archive requires the markdown source's current ticket path`);
  }
  const shas = resolveDelivered(delivered.shas, 'HEAD', dir, (_cmd, args, cwd) => gitText(cwd, ...args));
  const subject = `tickets: ${id} done (archived)`;
  const delivery = `Delivered by: ${shas.join(', ')}`;
  const limitation = 'Delivery evidence incomplete: the legacy end record was truncated; unrecorded commits are not listed.';
  if (archived) {
    if (parseFrontmatter(text)?.status !== 'done') throw new Error(`${id} is archived (done)`);
    // Inspect the addition, not the latest edit. The exact evidence distinguishes our push
    // from a manual archive or another delivery that happened to use the same ticket path.
    const existing = gitText(dir, '--literal-pathspecs', 'log', '-1', '--first-parent', '--no-renames', '--diff-filter=A', '--format=%H', '--', from);
    if (existing) {
      const [first, , third, , note] = gitText(dir, 'show', '-s', '--format=%B', existing).split('\n');
      if (first === subject && third === delivery && (note === limitation) === delivered.truncated) return { existing };
    }
    throw new Error(`${id}: the archive does not record this delivery`);
  }
  // Dibber finds a ticket by its canonical file name, `<id>.md` or `<id>.mdx`, anywhere in the store.
  if (!new RegExp(`^${id}\\.mdx?$`).test(basename(path))) {
    throw new Error(`${id}: ${from} is not named ${id}.md or ${id}.mdx, so Dibber cannot write it — rename it, then archive again`);
  }
  regularDirs(dir, dirname(to), true);
  if (lstatSync(join(dir, to), { throwIfNoEntry: false })) throw new Error(`${id}: archive destination already exists`);
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
  if ((frontmatter.match(/^status:/gm) ?? []).length > 1) throw new Error(`${id}: duplicate status fields; archive refused`);
  // The status is Dibber's to write, in place; the move after it is git's.
  const [cmd, ...args] = delivered.dibber;
  let said: { id?: unknown; file?: unknown; status?: unknown };
  try {
    said = JSON.parse(execFileSync(cmd, [...args, 'done', id, '--root', dir, '--json'], {
      cwd: dir, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, npm_config_ignore_scripts: 'true' },
    })) as typeof said;
  } catch (e) {
    const why = String((e as { stderr?: string }).stderr || (e as Error).message).trim().split('\n').at(-1);
    throw new Error(`${id}: dibber done failed: ${why}`);
  }
  if (said?.id !== id || said.file !== from || said.status !== 'done' || parseFrontmatter(readFileSync(join(dir, from), 'utf8'))?.status !== 'done') {
    throw new Error(`${id}: Dibber did not mark ${from} done`);
  }
  mkdirSync(dirname(join(dir, to)), { recursive: true });
  gitText(dir, '--literal-pathspecs', 'mv', from, to);
  gitText(dir, '--literal-pathspecs', 'add', '--', to);
  return { message: `${subject}\n\n${delivery}${delivered.truncated ? `\n\n${limitation}` : ''}` };
}
