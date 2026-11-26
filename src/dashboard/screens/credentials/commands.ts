// commands.ts — every CLI line the read-only screens name (B-199, B-200, B-214, B-215): the
// command that changes what the screen shows, as text to copy. One table, so one test
// (`test/ui/commands.test.ts`) can hold each line to the CLI as it is built today — the
// command tree of R-BTN-127 is not generated yet (B-25), so the lines here are `cli/baton.mjs`'s
// own, and `argv` is one worked instance of the line the test hands to the CLI's parser.
// `-i <key>` (the signing key) is left off every line: each screen's note says whose key signs.

import { DEFAULT_FORGE } from '../../../core/forges';

export interface Command {
  /** The line as the screen draws it. */
  line: string;
  /** `baton <role> …`: whose key signs it. */
  role: 'admin' | 'owner';
  /** One instance of the line, after the role, for the test; null for `baton owner policy …`,
   *  which the CLI parses apart from the rest. */
  argv: string[] | null;
}

const KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample';

export const COMMANDS = {
  // ── credentials (an owner's key) ──
  grantAdd: { line: 'baton owner grant <repository> --key <public key> --capabilities <a,b> [--hostname <name>] [--label <label>] [--max-claims <n>]', role: 'owner', argv: ['grant', 'docs', '--key', KEY, '--capabilities', 'a,b', '--hostname', 'box', '--label', 'l', '--max-claims', '2'] },
  grantRevoke: { line: 'baton owner revoke <repository> <fingerprint>', role: 'owner', argv: ['revoke', 'docs', 'SHA256:abc'] },
  ownerAdd: { line: 'baton owner owners <repository> --add <public key>', role: 'owner', argv: ['owners', 'docs', '--add', KEY] },
  ownerRemove: { line: 'baton owner owners <repository> --remove <fingerprint>', role: 'owner', argv: ['owners', 'docs', '--remove', 'SHA256:abc'] },
  seedOwnerAdd: { line: 'baton admin repo set <repository> --add-owner-key <public key>', role: 'admin', argv: ['repo', 'set', 'docs', '--add-owner-key', KEY] },
  // A sync key is the registry's: an administrator's key adds and removes it.
  syncKeyAdd: { line: 'baton admin repo set <repository> --add-sync-key <public key>', role: 'admin', argv: ['repo', 'set', 'docs', '--add-sync-key', KEY] },
  mirrorKeyAdd: { line: 'baton admin repo set <repository> --add-mirror-key <public key>', role: 'admin', argv: ['repo', 'set', 'docs', '--add-mirror-key', KEY] },
  syncKeyRemove: { line: 'baton admin repo set <repository> --remove-sync-key <fingerprint>', role: 'admin', argv: ['repo', 'set', 'docs', '--remove-sync-key', 'SHA256:abc'] },
  // ── governance ──
  policySet: { line: 'baton owner policy set <repository> <file> --base <version>', role: 'owner', argv: null },
  policyApply: { line: 'baton owner policy apply <repository> <preset> --base <version>', role: 'owner', argv: null },
  policyFloorAdd: { line: 'baton owner policy floor add <repository> <name> --guarantees <a,b>', role: 'owner', argv: null },
  settingsSet: { line: 'baton owner settings <repository> [--retry <a,b> --max-failed <n>] [--transcript-repos <a,b>] [--code-repos <a,b>] [--pushers <id,…>] [--remind-after <duration>] [--require-signed-control]', role: 'owner', argv: ['settings', 'docs', '--retry', '1m,5m', '--max-failed', '3', '--transcript-repos', 'a/b', '--code-repos', 'example-org/app', '--pushers', '12345', '--remind-after', '1h', '--require-signed-control'] },
  registrySet: { line: 'baton admin repo set <repository> [--weight <n>]', role: 'admin', argv: ['repo', 'set', 'docs', '--weight', '2'] },
  barAdd: { line: 'baton owner bar <repository> --course <course> --tag <tag> --applies <claim|claim+advance> --reason <reason> [--legs <a,b>] [--starts-at <time>] [--ends-at <time>] [--release-holders]', role: 'owner', argv: ['bar', 'docs', '--course', 'c', '--tag', 't', '--applies', 'claim', '--reason', 'r', '--legs', 'a,b', '--starts-at', '2026-01-01T00:00:00Z', '--ends-at', '2026-01-02T00:00:00Z', '--release-holders'] },
  barLift: { line: 'baton owner bar lift <repository> <id>', role: 'owner', argv: ['bar', 'lift', 'docs', '7'] },
  requiredBarsSet: { line: 'baton owner settings <repository> --required-bar <leg> --course <course> --tag-prefix <prefix> [--except <a,b>]', role: 'owner', argv: ['settings', 'docs', '--required-bar', '*', '--course', 'c', '--tag-prefix', 'family:', '--except', 'a,b'] },
  requiredBarsClear: { line: 'baton owner settings <repository> --no-required-bars', role: 'owner', argv: ['settings', 'docs', '--no-required-bars'] },
  // ── tenant (an administrator's key) ──
  repoAdd: { line: 'baton admin repo add <forge path> --owner-key <public key> [--id <id>] [--forge <forge>] [--default-branch <branch>] [--weight <n>]', role: 'admin', argv: ['repo', 'add', 'org/name', '--owner-key', KEY, '--id', 'name', '--forge', DEFAULT_FORGE, '--default-branch', 'main', '--weight', '1'] },
  repoSet: { line: 'baton admin repo set <repository> [--weight <n>] [--web-base <url>] [--add-owner-key <public key>]', role: 'admin', argv: ['repo', 'set', 'docs', '--weight', '1', '--web-base', 'https://example.org/o/n', '--add-owner-key', KEY] },
  repoRetire: { line: 'baton admin repo retire <repository>', role: 'admin', argv: ['repo', 'retire', 'docs'] },
  readingSet: { line: 'baton admin resource set <instance> --available | --unavailable [--until <time>] [--valid-for <duration>] [--detail <json>]', role: 'admin', argv: ['resource', 'set', 'acct:one', '--unavailable', '--until', '2026-01-01T00:00:00Z', '--valid-for', '1h', '--detail', '{"used":1}'] },
  resourceAdd: { line: 'baton admin resource add <name> --scope <account|service> --schema <json>', role: 'admin', argv: ['resource', 'add', 'llm:cap', '--scope', 'account', '--schema', '{"type":"object"}'] },
  instanceAdd: { line: 'baton admin instance add <name> --serves <resource,…> [--repositories <a,b>]', role: 'admin', argv: ['instance', 'add', 'acct:one', '--serves', 'llm:cap', '--repositories', 'docs'] },
  probeAdd: { line: 'baton admin probe add --key <public key> --label <label>', role: 'admin', argv: ['probe', 'add', '--key', KEY, '--label', 'quota probe'] },
  keyRevoke: { line: 'baton admin revoke <fingerprint>', role: 'admin', argv: ['revoke', 'SHA256:abc'] },
  capacitySet: { line: 'baton admin capacity set <capability> <n>', role: 'admin', argv: ['capacity', 'set', 'capability:x', '2'] },
  capacityClear: { line: 'baton admin capacity set <capability> --clear', role: 'admin', argv: ['capacity', 'set', 'capability:x', '--clear'] },
  instanceSettingsSet: { line: 'baton admin settings set [--link-hosts <a,b>] [--session-hosts <a,b>] [--check-app-id <id>] [--recommended-client <version>]', role: 'admin', argv: ['settings', 'set', '--link-hosts', 'a.example', '--session-hosts', 'b.example', '--check-app-id', '123', '--recommended-client', '1.2.3'] },
  exportState: { line: 'baton admin export [--with-history]', role: 'admin', argv: ['export', '--with-history'] },
  importState: { line: 'baton admin import <file>', role: 'admin', argv: ['import', 'state.json'] },
  freeze: { line: 'baton admin freeze', role: 'admin', argv: ['freeze'] },
  unfreeze: { line: 'baton admin unfreeze', role: 'admin', argv: ['unfreeze'] },
  seal: { line: 'baton admin seal', role: 'admin', argv: ['seal'] },
  open: { line: 'baton admin open', role: 'admin', argv: ['open'] },
} as const satisfies Record<string, Command>;

export type CommandId = keyof typeof COMMANDS;
