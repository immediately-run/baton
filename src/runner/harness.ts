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

/** The harnesses whose agent commands the CLI knows (the heartbeat's own two, §8.1). */
export type Harness = 'opencode' | 'claude-code';

/** The briefing every harness command hands its agent. No shell stands between the stub and the
 * agent (B-84), so nothing in it expands: it names the `BATON_*` environment variables the stub
 * sets — `BATON_COURSE`, `BATON_LEG`, `BATON_TICKET_FILE`, `BATON_INSTRUCTIONS` naming the temp
 * file holding the leg's instructions, `BATON_ANSWER` the last-line contract of a
 * result-dependent leg — which the agent reads with its own tools; the ticket id, the leg and
 * the checkout arrive as the command's trailing arguments. */
export const AGENT_PROMPT =
  'You are a Baton leg agent. The file named by the BATON_INSTRUCTIONS environment variable holds your instructions for this leg: read them and follow them exactly. The environment names your course (BATON_COURSE), your leg (BATON_LEG), the ticket\'s file (BATON_TICKET_FILE) and the answer rule for your last line (BATON_ANSWER, when one is set); the arguments after this message are the ticket id, your leg and the repository checkout. Work in the current repository checkout. When BATON_ANSWER is set, a machine parses the LAST line of your output: exactly the value word (optionally followed by one PR URL) and nothing else after it.';

/** Each harness's `agent_command` (B-83): what `baton repo init --agent <harness>` writes and
 * `baton run --harness <harness>` runs when `.baton/baton.json` names none. `--auto` and
 * `--permission-mode bypassPermissions` are the unattended modes — a leg's agent edits the
 * working tree, runs the checks and pushes, with nobody watching to answer a prompt. */
export const HARNESS_AGENTS: Record<Harness, string> = {
  opencode: `opencode run --auto --model zai-coding-plan/glm-5.3 "${AGENT_PROMPT}"`,
  'claude-code': `claude -p --permission-mode bypassPermissions --model sonnet "${AGENT_PROMPT}"`,
};
