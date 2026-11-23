// harness.ts — the commands that run one leg through a harness Baton knows (B-83, BATON_SPEC
// §2f R-BTN-74: `agent_command`; §5.8 R-BTN-131: the stubs): the validated invocations
// `baton repo init --agent` writes and `baton run --harness` runs when the settings name no
// `agent_command`. Both pin their model: an unpinned agent runs whatever the machine defaults
// to, which is no way to run a leg. B-84's no-shell spawn is why the commands carry neither the
// `< /dev/null` redirection B-83 first shipped (the stub closes the agent's stdin itself, and
// the split that turns the command into argv refuses the word) nor `$` references (nothing
// expands without a shell): the briefing names the BATON_* environment the stub sets, and the
// ticket id, the leg and the checkout ride as the trailing arguments. That shape is proven in
// production — it is this repository's own agent_command, running its legs now; the earlier
// `sh -c` form (opencode on the gap-analysis acceptance runs, docs/review/
// gap-analysis-2026-10-21.mdx findings 8–9, B-80's PR #81 and B-81; claude-code headless on
// 2026-10-21) validated the same words before B-84 moved the spawn.

import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { claudeRecords, opencodeRecords } from '../shared/sessionUsage.mjs';
import { splitWords } from '../defaults/agent-words';

const activityIO = { createHash, readdirSync, homedir, join };

export interface HarnessAdapter {
  name: string;
  agentCommand: string;
  activityPaths: (checkout: string, io: typeof activityIO & { env: NodeJS.ProcessEnv }) => string[];
  usage: (transcript: string, scope?: string) => {
    records: object[];
    children: { sessionId: string; scope: string }[];
  };
}

/** The briefing every harness command hands its agent. No shell stands between the stub and the
 * agent (B-84), so nothing in it expands: it names the `BATON_*` environment variables the stub
 * sets — `BATON_COURSE`, `BATON_LEG`, `BATON_TICKET_FILE`, `BATON_INSTRUCTIONS` naming the temp
 * file holding the leg's instructions, `BATON_ANSWER` the last-line contract of a
 * result-dependent leg — which the agent reads with its own tools; the ticket id, the leg and
 * the checkout arrive as the command's trailing arguments. B-108's lesson (2026-10-22): the
 * exit is named in the briefing itself — an agent that finished and sat cost its claim five
 * hours, so the closing sentences tell it to end its process the moment the leg is done.
 * B-181's lesson (2026-11-04), the mirror: an agent that backgrounded its second reviewer and
 * the vitest suite, stopped on "I'll resume when they land", and exited — losing B-180's review
 * round whole, because nothing resumes a leg process — so the closing sentences now state the
 * one-shot contract first: never exit with work pending, and never write that you are waiting. */
export const AGENT_PROMPT =
  'You are a Baton leg agent. The file named by the BATON_INSTRUCTIONS environment variable holds your instructions for this leg: read them and follow them exactly. The environment names your course (BATON_COURSE), your leg (BATON_LEG), the ticket\'s file (BATON_TICKET_FILE) and the answer rule for your last line (BATON_ANSWER, when one is set); the arguments after this message are the ticket id, your leg and the repository checkout. Work in the current repository checkout. When BATON_ANSWER is set, a machine parses the LAST line of your output: exactly the value word (optionally followed by one PR URL) and nothing else after it. Your process\'s exit is the leg\'s completion, and nothing resumes it: no scheduler, no wake-up, stdin is closed for good. Never exit with work pending — every test run, subagent and verification you start must be waited on to completion, in the foreground, before your final line (a "background job" is an orphan the moment you exit; never write that you are waiting or will resume). When the leg is done — the work pushed, the checks green, the final line printed — exit immediately.';

/** The briefing as one word of a command line: it rides inside double quotes, and the split
 * reads a double quote inside them only when a backslash escapes it (B-84), so every `"` the
 * briefing carries is escaped here — the agent still receives the literal character. */
const quotedBriefing = `"${AGENT_PROMPT.replaceAll('"', '\\"')}"`;

/** Each harness's `agent_command` (B-83): what `baton repo init --agent <harness>` writes and
 * `baton run --harness <harness>` runs when `.baton/baton.json` names none. `--auto` and
 * `--permission-mode bypassPermissions` are the unattended modes — a leg's agent edits the
 * working tree, runs the checks and pushes, with nobody watching to answer a prompt. */
export const HARNESS_ADAPTERS: readonly HarnessAdapter[] = [
  {
    name: 'opencode',
    agentCommand: `opencode run --auto --model zai-coding-plan/glm-5.3 ${quotedBriefing}`,
    activityPaths(checkout, { createHash, readdirSync, homedir, join, env }) {
      const root = join(env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'opencode');
      const dashed = checkout.split('/').join('-');
      const paths = [join(root, 'opencode.db'), join(root, 'opencode.db-wal'), join(root, 'opencode.db-shm'), join(root, 'project', dashed)];
      const snapshots = join(root, 'snapshot');
      const key = createHash('sha1').update(checkout).digest('hex');
      try {
        for (const instance of readdirSync(snapshots)) paths.push(join(snapshots, instance, key));
      } catch { /* no snapshots yet */ }
      return paths;
    },
    usage: (transcript, scope) => opencodeRecords(JSON.parse(transcript), scope),
  },
  {
    name: 'claude-code',
    agentCommand: `claude -p --permission-mode bypassPermissions --model sonnet ${quotedBriefing}`,
    activityPaths: (checkout, { homedir, join, env }) => [
      join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects', checkout.split('/').join('-')),
    ],
    usage: (transcript, scope) => ({ records: claudeRecords(transcript, scope), children: [] }),
  },
];

export function selectHarness(name: string, adapters = HARNESS_ADAPTERS): HarnessAdapter | undefined {
  return adapters.find((adapter) => adapter.name === name);
}

export function harnessActivityPaths(checkout: string, adapters = HARNESS_ADAPTERS): string[] {
  return adapters.flatMap((adapter) => adapter.activityPaths(checkout, { ...activityIO, env: process.env }));
}

/** Bundled into standard stubs so built-in paths resolve in the executor's environment. */
export function builtinAgentActivityPaths(command: string, checkout: string): string[] {
  const adapter = HARNESS_ADAPTERS.find((entry) => basename(splitWords(entry.agentCommand)[0]) === basename(command));
  return adapter ? harnessActivityPaths(checkout, [adapter]) : [];
}
