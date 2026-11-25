// dibber.ts — Dibber, the writer of every ticket file (B-326; BATON_SPEC §4.2 R-BTN-74, §4.3
// R-BTN-199). Baton's CLI files no ticket and writes no status: `dibber` does, with Baton as its
// coordinator — the command `.dibber/config.json` names prints the number Baton hands out
// (`baton tickets next ticket-<prefix> --coordinator`). Two things here:
//
// - **The pin.** A leg runs only the `dibber` its stub pins: the `dibber` version in
//   `.baton/baton.json`, else this release's `DIBBER_VERSION`, run as
//   `npx --yes @immediately-run/dibber@<version>` — never a command a ticket or a branch names.
//   The host's `BATON_DIBBER` (a command, split as `agent_command` is) wins, as
//   `BATON_AGENT_WRAPPER` does: the runner host's choice, for a host with its own install and for
//   a test's stand-in.
// - **The settings `baton repo init` writes.** `.dibber/config.json` beside `.baton/baton.json`:
//   `store` from `items`, `prefix` from `ticket_prefix`, and the coordinator from a fixed
//   template. Over an existing file it adds what is missing and never overwrites a value.
import { splitWords } from './agent-words';

/** The Dibber release this Baton release pins (DIB-33: coordinator ids, `--body-file`,
 *  `--field`), when `.baton/baton.json` names none. */
export const DIBBER_VERSION = '0.4.0';

/** The package the pin names. */
export const DIBBER_PACKAGE = '@immediately-run/dibber';

/** The package Dibber's coordinator runs Baton from: this CLI's, at its own version. */
export const BATON_PACKAGE = '@immediately-run/baton';

/** A release version, and nothing a shell or npm would read as more: `1.2.3`, `1.2.3-rc.0`. */
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]{1,32})?$/;

/** The Dibber version `.baton/baton.json`'s `dibber` names, else this release's. A value that is
 *  not a release version is refused: the setting pins a version, never names a command. */
export function dibberVersion(settings: { dibber?: unknown }): string {
  const v = settings.dibber;
  if (v == null) return DIBBER_VERSION;
  if (typeof v !== 'string' || !VERSION.test(v)) throw new Error(`.baton/baton.json's dibber is ${JSON.stringify(v)}, not a release version (such as "${DIBBER_VERSION}") — it pins @immediately-run/dibber, it never names a command`);
  return v;
}

/** The words that run the pinned `dibber`: the host's `BATON_DIBBER`, else
 *  `npx --yes @immediately-run/dibber@<version>`. */
export function dibberWords(settings: { dibber?: unknown }, env: Record<string, string | undefined> = process.env): string[] {
  const host = env.BATON_DIBBER?.trim();
  if (host) return splitWords(host);
  return ['npx', '--yes', `${DIBBER_PACKAGE}@${dibberVersion(settings)}`];
}

/** The coordinator `baton repo init` writes (R-BTN-199): Baton's `next` for the store's prefix,
 *  the number alone or a refusal. Dibber replaces `<prefix>` with the store's. */
export function coordinatorNext(batonVersion: string): string[] {
  const pkg = VERSION.test(batonVersion) ? `${BATON_PACKAGE}@${batonVersion}` : BATON_PACKAGE;
  return ['npx', '--yes', pkg, 'tickets', 'next', 'ticket-<prefix>', '--coordinator'];
}

/** `.dibber/config.json` as `baton repo init` leaves it: `existing` (null when there is none)
 *  with what is missing added — `store`, `prefix`, `coordinator` — never a value it holds
 *  overwritten. `changed` names each key added; empty when the file already says it all. A
 *  value that disagrees with Baton's settings is kept and named in `disagrees`, for init to
 *  print. */
export function dibberConfig(
  existing: Record<string, unknown> | null,
  baton: { items?: string; ticket_prefix?: string },
  batonVersion: string,
): { config: Record<string, unknown>; changed: string[]; disagrees: string[] } {
  const config: Record<string, unknown> = { ...(existing ?? {}) };
  const want: Record<string, unknown> = {
    store: (baton.items ?? 'tickets').replace(/\/$/, ''),
    prefix: baton.ticket_prefix ?? 'B',
    coordinator: { next: coordinatorNext(batonVersion) },
  };
  const changed: string[] = [];
  const disagrees: string[] = [];
  for (const [key, value] of Object.entries(want)) {
    if (!(key in config)) {
      config[key] = value;
      changed.push(key);
    } else if (key !== 'coordinator' && config[key] !== value) {
      disagrees.push(`${key} is ${JSON.stringify(config[key])}, .baton/baton.json says ${JSON.stringify(value)}`);
    }
  }
  return { config, changed, disagrees };
}
