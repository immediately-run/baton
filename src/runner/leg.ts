// leg.ts — the leg session's CLI on its channel (BATON_SPEC §8.2 R-BTN-106, §7.1 R-BTN-160;
// B-234): `baton leg raise <type> --subject … [--body <file>]`, the one way a leg asks its
// runner for something. The runner checks the raise and answers on the channel; the subject and
// body stay in the runner's log and never reach Baton (R-BTN-33). Elsewhere than inside a leg
// (no BATON_SOCKET) the command exits 2 "not inside a leg" (R-BTN-106).
import { readFileSync } from 'node:fs';
import { SEVERITIES } from '../core/conditionTypes';
import { callChannel } from './channel';

export const RAISE_USAGE = [
  'usage: baton leg raise <type> --subject TEXT [--body <file>] [--restarts <json>] [--default <id>]',
  '                 [--severity critical|high|normal]',
  '',
  'Raises a condition from the leg (R-BTN-160). `interact` (R-BTN-195) asks a person into this',
  "leg's agent session: it needs a leg with a deadline and a run with a session link, and it",
  'returns at once — nothing waits on it. An autonomous leg raises `error.needs-person` instead,',
  'never `interact` and never a suspend type. The subject and body are this leg\'s own words:',
  'they stay in the runner\'s log and are never sent to Baton.',
].join('\n');

/** The raise's flags, as `raiseMain` reads them; exported for its test. */
export interface RaiseArgs {
  type: string;
  subject: string;
  body: string | null;
  restarts: Record<string, string> | null;
  default: string | null;
  severity: string;
}

export function parseRaiseArgs(argv: string[]): RaiseArgs {
  const out: RaiseArgs = { type: '', subject: '', body: null, restarts: null, default: null, severity: 'normal' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--subject') out.subject = value();
    else if (a === '--body') out.body = readFileSync(value(), 'utf8');
    else if (a === '--default') out.default = value();
    else if (a === '--severity') {
      const v = value();
      if (!(SEVERITIES as readonly string[]).includes(v)) throw new Error(`--severity: one of ${SEVERITIES.join(', ')} (R-BTN-125)`);
      out.severity = v;
    } else if (a === '--restarts') {
      const v = value();
      try {
        const parsed = JSON.parse(v) as unknown;
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
        out.restarts = parsed as Record<string, string>;
      } catch {
        throw new Error(`--restarts ${v}: a JSON object of ids to descriptions, {\"retry\": \"…\"} (R-BTN-160)`);
      }
    } else if (a === '--help' || a === '-h') {
      out.type = '\0help';
      return out;
    } else if (!a.startsWith('--') && out.type === '') out.type = a;
    else throw new Error(`${a}: not a flag of baton leg raise`);
  }
  if (out.type === '') throw new Error('usage: baton leg raise <type> --subject TEXT [--body <file>] (R-BTN-160)');
  if (out.type !== '\0help' && out.subject.trim() === '') throw new Error('--subject TEXT is required (R-BTN-160)');
  return out;
}

/** `baton leg raise`: one call on the leg's channel, its answer printed; exit 0 when the raise
 *  was taken, 1 when it was refused (the reason is the answer), 2 outside a leg. */
export async function raiseMain(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const socket = env.BATON_SOCKET;
  if (!socket) {
    process.stderr.write('baton: not inside a leg: BATON_SOCKET names the leg\'s channel, and this session carries none (R-BTN-106)\n');
    return 2;
  }
  let args: RaiseArgs;
  try {
    args = parseRaiseArgs(argv);
  } catch (e) {
    process.stderr.write(`baton: ${e instanceof Error ? e.message : String(e)}\n${RAISE_USAGE}\n`);
    return 1;
  }
  if (args.type === '\0help') {
    process.stdout.write(`${RAISE_USAGE}\n`);
    return 0;
  }
  let answer;
  try {
    answer = await callChannel(socket, {
      op: 'raise', type: args.type, subject: args.subject,
      ...(args.body != null ? { body: args.body } : {}),
      ...(args.restarts != null ? { restarts: args.restarts } : {}),
      ...(args.default != null ? { default: args.default } : {}),
      ...(args.severity !== 'normal' ? { severity: args.severity } : {}),
    });
  } catch (e) {
    process.stderr.write(`baton: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
  if (!answer.ok) {
    process.stderr.write(`baton: the raise of ${args.type} was refused: ${answer.error}\n`);
    return 1;
  }
  const what = [`condition ${answer.condition_id ?? '?'}`];
  if (typeof answer.end === 'string') what.push(`the leg ends ${answer.end}`);
  else if (answer.disposition === 'interact' || answer.disposition === 'notify') what.push('recorded');
  process.stdout.write(`baton: ${what.join(', ')} — the raise returned at once; nothing waits on it (R-BTN-160)\n`);
  return 0;
}
