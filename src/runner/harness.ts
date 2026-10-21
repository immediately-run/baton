// harness.ts — the commands that run one leg through a harness Baton knows (B-83, BATON_SPEC
// §2f R-BTN-74: `agent_command`; §5.8 R-BTN-131: the stubs): the validated invocations
// `baton repo init --agent` writes and `baton run --harness` runs when the settings name no
// `agent_command`. Both were validated on real runs — opencode on the gap-analysis acceptance
// runs (docs/review/gap-analysis-2026-10-21.mdx, findings 8–9; B-80's PR #81 and B-81 ran
// through exactly this string), claude-code headless on 2026-10-21 — and both pin their model:
// an unpinned agent runs whatever the machine defaults to, which is no way to run a leg.
// The trailing `< /dev/null` is B-84's workaround, still required while the stubs spawn the
// agent through `sh -c`: that environment hangs `opencode run` deterministically without it.

/** The harnesses whose agent commands the CLI knows (the heartbeat's own two, §8.1). */
export type Harness = 'opencode' | 'claude-code';

/** The briefing every harness command hands its agent. A shell string run through `sh -c`, so
 * the `$` references expand at run time: `$BATON_COURSE`, `$BATON_LEG` and `$BATON_TICKET_FILE`
 * from the stub's environment, `$BATON_INSTRUCTIONS` naming the temp file holding the leg's
 * instructions, `$BATON_ANSWER` the last-line contract of a result-dependent leg, and `$1` the
 * ticket id of the stub's three arguments. */
export const AGENT_PROMPT =
  'You are the $BATON_LEG leg of the $BATON_COURSE course for ticket $1. Read the file named by $BATON_INSTRUCTIONS and follow it exactly. The ticket file is $BATON_TICKET_FILE. Work in the current repository checkout. $BATON_ANSWER — when that answer rule is set, a machine parses the LAST line of your output: exactly the value word (optionally followed by one PR URL) and nothing else after it.';

/** Each harness's `agent_command` (B-83): what `baton repo init --agent <harness>` writes and
 * `baton run --harness <harness>` runs when `.baton/baton.json` names none. `--auto` and
 * `--permission-mode bypassPermissions` are the unattended modes — a leg's agent edits the
 * working tree, runs the checks and pushes, with nobody watching to answer a prompt. */
export const HARNESS_AGENTS: Record<Harness, string> = {
  opencode: `opencode run --auto --model zai-coding-plan/glm-5.3 "${AGENT_PROMPT}" < /dev/null`,
  'claude-code': `claude -p --permission-mode bypassPermissions --model sonnet "${AGENT_PROMPT}" < /dev/null`,
};
