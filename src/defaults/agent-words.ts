// agent-words.ts — the one word split every leg stub gives `agent_command` (B-84): the command
// stays a shell string — the documented interface (R-BTN-74) — but no shell stands between the
// stub and the agent, so nothing the shell would have done happens behind the spawn: the string
// splits into words once, as `sh` would split it with substitutions disabled, and the words
// become `execFile(command, args)` argv directly:
// - whitespace separates words; single quotes are literal; double quotes keep backslash escapes
//   for `"`, `\`, `$` and `` ` `` only; a backslash outside quotes escapes the next character;
// - `$` names nothing — `"$VAR"` and `"$@"` stay those literal characters. The values they once
//   carried reach the agent another way: `BATON_*` in its environment, and the ticket id, the
//   leg and the checkout as the stub's trailing arguments;
// - an unquoted word that is pure shell syntax (`<`, `|`, `&&`, …) is refused with the fix, not
//   passed to the agent as a garbage argument. stdin is never an open pipe (the stub opens it
//   closed), so the old `< /dev/null` workaround is exactly what the error tells you to drop.

/** Split `command` into words as `sh` would with substitutions disabled (B-84). Throws on an
 * unterminated quote, a trailing backslash, or an unquoted word of shell syntax the split does
 * not execute — naming the word and why it cannot pass. */
export function splitWords(command: string): string[] {
  const words: string[] = [];
  const SHELL_SYNTAX = new Set(['<', '>', '>>', '<<', '|', '||', '&&', ';', '&', '(', ')']);
  let word = '';
  let started = false; // a word has begun, even if still empty ('""' is an empty argument)
  let quoted = false; // some part of the current word was quoted or escaped — never shell syntax
  const take = (): void => {
    // A word built entirely outside quotes that is shell syntax cannot run without a shell; the
    // agent would receive it as a literal argument and do nothing its author meant.
    if (!quoted && SHELL_SYNTAX.has(word)) {
      throw new Error(
        `agent_command has '${word}' as a word: the stub runs it with no shell, so redirections, pipes and lists are not executed — drop it (stdin is already closed for the agent) or quote it if the agent should receive it literally`,
      );
    }
    words.push(word);
    word = '';
    started = false;
    quoted = false;
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === ' ' || c === '\t' || c === '\n') {
      if (started) take();
      continue;
    }
    started = true;
    if (c === "'") {
      const end = command.indexOf("'", i + 1);
      if (end < 0) throw new Error(`agent_command has an unterminated single quote (at character ${i})`);
      word += command.slice(i + 1, end);
      quoted = true;
      i = end;
    } else if (c === '"') {
      const open = i;
      quoted = true;
      for (i++; ; i++) {
        if (i >= command.length) throw new Error(`agent_command has an unterminated double quote (at character ${open})`);
        const d = command[i];
        if (d === '"') break;
        // Inside double quotes a backslash escapes only " \ $ ` and a newline, as in sh; before
        // anything else it is a literal backslash.
        if (d === '\\' && i + 1 < command.length && '"\\$`'.includes(command[i + 1])) word += command[++i];
        else if (d === '\\' && command[i + 1] === '\n') i++; // a line continuation: both drop
        else word += d;
      }
    } else if (c === '\\') {
      if (i + 1 >= command.length) throw new Error('agent_command ends in a backslash with nothing to escape');
      word += command[++i];
      quoted = true; // an escaped character is never shell syntax, even unquoted
    } else word += c;
  }
  if (started) take();
  return words;
}
