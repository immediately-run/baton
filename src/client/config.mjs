import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_URL = 'https://baton.immediately.run';
/** Where the CLI's homes.json sits (B-121): `$XDG_CONFIG_HOME` (or `~/.config`)/baton/
 *  homes.json — the directory keys.json, origins.json and runner.json's own rules name
 *  (R-BTN-137, R-BTN-144). Both the CLI fast path and home resolution use this path. */
export function homesPath(env = process.env) {
  return join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config'), 'baton', 'homes.json');
}
