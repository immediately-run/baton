// S-BTN-99: a reader of an owners' log directory, not a Baton log relay.
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripVTControlCharacters, promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { ACTIONS } from '../core/actions';
import { parseTranscriptRepo, transcriptUrl } from '../core/links';
import { chunkName } from './legLog';
import { logStore } from './logStore';

export const logRoles = (action: 'leg.runs' | 'leg.release-request' | 'ticket.blocks'): string[] =>
  ACTIONS.find((a) => a.id === action)!.callers.flatMap(({ principal }) =>
    principal === 'runner' || principal === 'owner' || principal === 'administrator' ? [principal] : []);

export const terminalText = (s: string) => stripVTControlCharacters(s)
  .replace(/[\x1b\x90\x98\x9d\x9e\x9f][^\n]*(?:\n|$)/g, '')
  .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');

type Run = { run: number; ended_at?: number | null; log_dir?: string | null; session_url?: string | null;
  transcripts?: { repo: string; path: string }[] };

async function transcript(repo: string, path: string): Promise<string> {
  const remote = parseTranscriptRepo(repo)?.webBase;
  if (!remote || !transcriptUrl(repo, path)) throw new Error('invalid transcript pointer');
  const dir = await mkdtemp(join(tmpdir(), 'baton-transcript-'));
  const git = promisify(execFile);
  const options = { timeout: 30_000, maxBuffer: 50 * 1024 * 1024, cwd: dir,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: 'https' } };
  try {
    await git('git', ['clone', '--bare', '--depth=1', '--filter=blob:none', '--', `${remote}.git`, '.'], options);
    return (await git('git', ['show', `HEAD:${path}`], options)).stdout;
  } finally { await rm(dir, { recursive: true, force: true }); }
}

export async function viewLog(run: Run, opts: { follow: boolean; json: boolean; transcripts: boolean;
  refresh: () => Promise<Run | undefined> }): Promise<number> {
  const print = (s: string) => process.stdout.write(terminalText(s));
  const notice = (s: string) => (opts.json ? process.stderr : process.stdout).write(terminalText(`${s}\n`));
  const record = () => notice(JSON.stringify(run));
  let any = false;
  if (run.log_dir) {
    try {
      const { read } = await logStore(run.log_dir);
      let chunk = 0;
      let seq = 0;
      let pause = 1000;
      let ended = run.ended_at != null;
      let quietSince = Date.now();
      for (;;) {
        const data = await read(chunkName(chunk));
        if (data !== null) {
          chunk++;
          for (const line of data.split('\n').filter(Boolean)) {
            const f = JSON.parse(line);
            if (Number.isSafeInteger(f.gap) && f.gap > 0) { seq += f.gap; if (!opts.json) print('[gap]\n'); }
            else if (Number.isSafeInteger(f.seq) && typeof f.text === 'string' && ['stdout', 'stderr'].includes(f.stream)) {
              if (seq !== f.seq && !opts.json) print('[gap]\n');
              seq = f.seq + 1;
              if (!opts.json) print(f.text);
            } else throw new Error('invalid frame');
            if (opts.json) process.stdout.write(`${JSON.stringify(f.gap ? { gap: f.gap } : { seq: f.seq, at: f.at, stream: f.stream, text: terminalText(f.text) })}\n`);
            any = true;
          }
          pause = 1000;
          quietSince = Date.now();
          continue;
        }
        if (!opts.follow) break;
        const end = await read('end.json');
        if (end !== null) {
          // The final chunk may have landed just after the first GET.
          if (JSON.parse(end).chunks > chunk) {
            const last = await read(chunkName(chunk));
            if (last !== null) continue;
            throw new Error('archive ended with a missing chunk');
          }
          break;
        }
        if (!ended && (await opts.refresh())?.ended_at != null) { ended = true; quietSince = Date.now(); }
        if (ended && Date.now() - quietSince >= 30_000) break;
        await sleep(pause);
        pause = Math.min(pause * 2, 10_000);
      }
    } catch (e) {
      record();
      process.stderr.write(terminalText(`cannot read ${run.log_dir}: ${(e as Error).message}\n`));
      return 1;
    }
  }
  if (!any && run.session_url) notice(run.session_url);
  for (const t of run.transcripts ?? []) {
    if (!any || opts.transcripts) notice(transcriptUrl(t.repo, t.path) ?? `${t.repo}: ${t.path}`);
    if (opts.transcripts) {
      try {
        const text = await transcript(t.repo, t.path);
        (opts.json ? process.stderr : process.stdout).write(terminalText(text));
      } catch {
        notice(`cannot read transcript ${t.repo}: ${t.path}`);
        return 1;
      }
    }
  }
  if (!any && !run.session_url && !run.transcripts?.length) {
    record();
    notice(run.log_dir ? 'no output archived: nothing written yet or streaming disabled' : 'no output archived: no leg_log_root for this run');
  }
  return 0;
}
