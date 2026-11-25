// commands.test.ts — B-199, B-200, B-214, B-215: every CLI line a read-only screen names is a
// command the CLI takes today. R-BTN-127's generated command table does not exist yet (B-25),
// so the lines are held to `cli/baton.mjs` itself: each line's worked instance is handed to the
// CLI's own parser (`plan`), which must plan a request and refuse no flag; the line's words are
// that instance's words; and the `baton owner policy …` lines, which the CLI parses apart, are
// held to its usage text.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMMANDS, type Command } from '../../src/dashboard/screens/credentials/commands';

/** The CLI's own planner: argv in, the request it would sign out — or its refusal thrown. The
 *  CLI is plain JavaScript with no declarations, so it is imported by a path the compiler does
 *  not follow and typed here. */
const CLI = '../../cli/baton.mjs';
const { plan } = (await import(/* @vite-ignore */ CLI)) as { plan: (role: string, argv: string[], readKey?: (p: string) => string, readJson?: (p: string) => string) => unknown };

const entries = Object.entries(COMMANDS) as [string, Command][];
const cli = readFileSync(join(import.meta.dirname, '../../cli/baton.mjs'), 'utf8');

/** The flags a line names: `--name`, in order. */
const flagsOf = (line: string) => [...line.matchAll(/--[a-z][a-z-]*/g)].map((m) => m[0]);

describe('the CLI lines the read-only screens name', () => {
  it('each is a command the CLI plans a request for', () => {
    for (const [id, c] of entries) {
      if (!c.argv) continue;
      const planned = plan(c.role, [...c.argv], (key: string) => key, (text: string) => text) as { method?: string; path?: string };
      expect([id, typeof planned.method, typeof planned.path]).toEqual([id, 'string', 'string']);
      expect([id, planned.path!.startsWith('/v1/')]).toEqual([id, true]);
    }
  });

  it('each line is written as its worked instance is: the same words, and no flag the instance lacks', () => {
    for (const [id, c] of entries) {
      expect([id, c.line.startsWith(`baton ${c.role} `)]).toEqual([id, true]);
      if (!c.argv) continue;
      // The command's words before its first argument or flag.
      const words = c.line.slice(`baton ${c.role} `.length).split(' ').filter((w) => /^[a-z][a-z-]*$/.test(w));
      const lead = c.argv.filter((w) => /^[a-z][a-z-]*$/.test(w)).slice(0, words.length);
      expect([id, words.slice(0, lead.length)]).toEqual([id, lead]);
      // Every flag the line offers is one the parser took in the worked instance — except the
      // other half of an either/or, which is checked below.
      const taken = new Set(c.argv.filter((w) => w.startsWith('--')));
      for (const flag of flagsOf(c.line)) {
        if (id === 'readingSet' && flag === '--available') continue;
        expect([id, flag, taken.has(flag)]).toEqual([id, flag, true]);
      }
    }
    // `--available` is `resource set`'s other word.
    expect((plan('admin', ['resource', 'set', 'acct:one', '--available']) as { path: string }).path).toBe('/v1/admin/readings');
  });

  it('a flag the CLI does not take is refused by the same parser (the check is not vacuous)', () => {
    expect(() => plan('owner', ['grant', 'docs', '--key', 'ssh-ed25519 AAAA', '--capabilities', 'a', '--no-such-flag', 'x'])).toThrow(/not a flag/);
    expect(() => plan('admin', ['sessions', 'revoke', '--all'])).toThrow();
    expect(() => plan('owner', ['consent', 'add', 'docs', 'ops'])).toThrow();
  });

  it('the policy lines are the CLI’s own verbs and flags', () => {
    expect(cli).toContain("'baton owner policy show|diff|log|set|apply|floor add|floor remove'");
    for (const id of ['policySet', 'policyApply', 'policyFloorAdd'] as const) {
      expect(COMMANDS[id].line.startsWith('baton owner policy ')).toBe(true);
      expect(COMMANDS[id].argv).toBeNull();
    }
    // `--base` and `--guarantees` are the flags `policy set|apply` and `policy floor add` parse.
    expect(cli).toMatch(/parseArgs\(rest, \['dry-run'\], \['base', 'identity', 'url'\], 2\)/);
    expect(cli).toMatch(/\['guarantees', 'remove-by', 'identity', 'url'\]/);
    expect(flagsOf(COMMANDS.policySet.line)).toEqual(['--base']);
    expect(flagsOf(COMMANDS.policyFloorAdd.line)).toEqual(['--guarantees']);
  });
});
