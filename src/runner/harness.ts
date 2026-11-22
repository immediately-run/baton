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
export const HARNESS_AGENTS: Record<Harness, string> = {
  opencode: `opencode run --auto --model zai-coding-plan/glm-5.3 ${quotedBriefing}`,
  'claude-code': `claude -p --permission-mode bypassPermissions --model sonnet ${quotedBriefing}`,
};

/** B-141: reconstruct argv rather than forwarding flags that might change the workspace,
 * connect to another session, load plugins, or bypass the tool policy. */
export function readOnlyHarness(words: string[], prompt: string, readConfig: (path: string) => string | null = () => null): { argv: string[]; env: NodeJS.ProcessEnv } {
  const [bin, mode, ...options] = words;
  const opencode = bin === 'opencode' && mode === 'run';
  if (!opencode && !(bin === 'claude' && (mode === '-p' || mode === '--print'))) {
    throw new Error('reads_only supports only opencode run and claude --print agent commands (R-BTN-183)');
  }
  let model: string | undefined;
  for (let i = 0; i < options.length; i++) {
    if (options[i] === '--model' || options[i] === '-m') {
      model = options[++i];
      if (!model || !/^[\w./:#-]+$/.test(model) || model.startsWith('-')) throw new Error('invalid reads_only harness model');
    }
  }
  const selection = model ? ['--model', model] : [];
  const env = { ...process.env };
  // The agent should not discover or operate on the object's original Git directory.
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  if (opencode) {
    // Explicit config locations in the host environment are not part of the snapshot. The
    // standalone server must receive this policy, not reuse a service started without it.
    for (const key of Object.keys(env)) if (key.startsWith('OPENCODE_CONFIG') || key === 'OPENCODE_PERMISSION') delete env[key];
    const config: Record<string, unknown> = {};
    for (const path of ['opencode.json', 'opencode.jsonc', '.opencode/opencode.json', '.opencode/opencode.jsonc']) {
      const snapshot = configObject(readConfig(path), path);
      for (const field of ['model', 'default_agent'] as const) if (typeof snapshot[field] === 'string') config[field] = snapshot[field];
      config.providers = { ...object(config.providers), ...object(snapshot.providers) };
      const agents = Object.fromEntries(Object.entries(object(snapshot.agents)).map(([id, value]) => [id,
        Object.fromEntries(Object.entries(object(value)).filter(([key]) => ['description', 'mode', 'model', 'system', 'hidden', 'temperature', 'top_p'].includes(key))),
      ]));
      config.agents = { ...object(config.agents), ...agents };
    }
    const readTools = ['read', 'glob', 'grep'];
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
      ...config,
      snapshots: false, formatter: false, lsp: false,
      permissions: [
        { action: '*', resource: '*', effect: 'deny' },
        ...readTools.map((action) => ({ action, resource: '*', effect: 'allow' })),
      ],
      policies: [
        { action: 'tool.use', resource: '*', effect: 'deny' },
        ...readTools.map((tool) => ({ action: 'tool.use', resource: `${tool}:*`, effect: 'allow' })),
        ...['plugin.use', 'mcp.use', 'skill.use'].map((action) => ({ action, resource: '*', effect: 'deny' })),
      ],
    });
    return { argv: [bin, mode, '--standalone', ...selection, '--', prompt], env };
  }
  const snapshot = configObject(readConfig('.claude/settings.json'), '.claude/settings.json');
  const settings = Object.fromEntries(Object.entries(snapshot).filter(([key, value]) => ['model', 'language'].includes(key) && typeof value === 'string'));
  return {
    argv: [bin, '--print', '--bare', '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{}',
      '--tools', 'Read,Glob,Grep', '--allowedTools', 'Read,Glob,Grep', '--permission-mode', 'dontAsk',
      ...(Object.keys(settings).length ? ['--settings', JSON.stringify(settings)] : []),
      ...selection, '--', prompt], env,
  };
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function configObject(text: string | null, path: string): Record<string, unknown> {
  if (text == null) return {};
  try {
    // Match strings first, so comments and trailing commas inside them are left alone.
    const clean = path.endsWith('.jsonc') ? text
      .replace(/"(?:[^"\\]|\\.)*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g, (token) => token.startsWith('"') ? token : ' ')
      .replace(/"(?:[^"\\]|\\.)*"|,(?=\s*[}\]])/g, (token) => token === ',' ? '' : token) : text;
    const parsed: unknown = JSON.parse(clean);
    if (object(parsed) !== parsed) throw new Error('expected an object');
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`invalid reads_only snapshot configuration: ${path}`);
  }
}

export function readOnlyVersionSupported(version: string): boolean {
  const match = /^(?:opencode )?v*2\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
  return match != null && (Number(match[1]) > 2 || (Number(match[1]) === 2 && Number(match[2]) >= 3));
}
