#!/usr/bin/env node
// A stand-in for the pinned `dibber` (B-326), for a test's BATON_DIBBER: `done <id> --root <dir>
// [--json]` as Dibber 0.4.0 does it — the ticket found by its canonical name `<id>.md|.mdx`
// anywhere under the store `.dibber/config.json` names (else `tickets`), its `status:` set to
// `done` in place, the file left where it is. Every call's argv is appended, one JSON line, to
// DIBBER_LOG when set. Any other command exits 2, as an unknown one does.
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const argv = process.argv.slice(2);
if (process.env.DIBBER_LOG) appendFileSync(process.env.DIBBER_LOG, `${JSON.stringify(argv)}\n`);
const flag = (name) => {
  const at = argv.indexOf(name);
  return at < 0 ? undefined : argv[at + 1];
};
const [cmd, id] = argv;
if (cmd !== 'done' || !id) {
  process.stderr.write(`dibber stand-in: ${cmd ?? '(none)'} is not done <id>\n`);
  process.exit(2);
}
const root = flag('--root') ?? process.cwd();
const config = join(root, '.dibber', 'config.json');
const store = (existsSync(config) ? JSON.parse(readFileSync(config, 'utf8')).store : null) ?? 'tickets';
const find = (dir) => {
  for (const name of existsSync(dir) ? readdirSync(dir) : []) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      const found = find(path);
      if (found) return found;
    } else if (name === `${id}.md` || name === `${id}.mdx`) return path;
  }
  return null;
};
const file = find(join(root, store));
if (!file) {
  process.stderr.write(`dibber: there is no ticket \`${id}\` in \`${store}/\`\n`);
  process.exit(2);
}
writeFileSync(file, readFileSync(file, 'utf8').replace(/^status: .*$/m, 'status: done'));
const answer = { id, file: relative(root, file), status: 'done' };
process.stdout.write(argv.includes('--json') ? `${JSON.stringify(answer, null, 2)}\n` : `${id}: done\n`);
