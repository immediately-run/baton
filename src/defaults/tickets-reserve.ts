// tickets-reserve.ts — reserved numbers (BATON_SPEC §2f R-BTN-74): migration numbers
// (`src/migrations/NNNN_*.sql`) and scenario ids (§15's `| S-BTN-n` rows) are allocated by
// reservation, as ticket ids are by `baton tickets new`. A long-lived branch that took the next
// number by looking collided with another that looked the same day — B-110 and B-107 both took
// migration 0028, B-129 and B-145 both took S-BTN-197 (spec/BATON_SPEC_HISTORY.md, 2026-11-03).
//
// The ledger is `<items>/reserved.json`:
//   {"baseline": {"migration": 30, "scenario": 198},
//    "migration": {"0031": "B-110"}, "scenario": {"199": "B-129"}}
// `baton tickets reserve <ticket> migration|scenario` (tickets.ts) takes the next number above both
// the highest in the tree and the highest in the ledger, and commits the ledger through the same
// git-lock path `new` uses; scripts/check-spec.mjs fails a number above the baseline that the
// ledger does not hold, and a number held twice. Pure over the texts it is given.

export type ReserveKind = 'migration' | 'scenario';
export const RESERVE_KINDS: readonly ReserveKind[] = ['migration', 'scenario'];

/** Where the numbers live, overridden by `.baton/baton.json`'s `reserve: {migrations, spec,
 *  history, scenario_prefix}`. */
export interface ReserveConfig {
  /** The migrations folder: `NNNN_<name>.sql` files. */
  migrations: string;
  /** The spec whose `| S-BTN-n` rows are the scenarios, and its history (retired rows). */
  spec: string;
  history: string;
  /** The scenario id prefix, without the number's dash. */
  scenario_prefix: string;
}

export const RESERVE_DEFAULTS: ReserveConfig = {
  migrations: 'src/migrations',
  spec: 'spec/BATON_SPEC.md',
  history: 'spec/BATON_SPEC_HISTORY.md',
  scenario_prefix: 'S-BTN',
};

export function reserveConfig(json: { reserve?: unknown }): ReserveConfig {
  const r = (json.reserve ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);
  return {
    migrations: str(r.migrations) ?? RESERVE_DEFAULTS.migrations,
    spec: str(r.spec) ?? RESERVE_DEFAULTS.spec,
    history: str(r.history) ?? RESERVE_DEFAULTS.history,
    scenario_prefix: str(r.scenario_prefix) ?? RESERVE_DEFAULTS.scenario_prefix,
  };
}

/** The ledger's file name, in the items folder. */
export const LEDGER_NAME = 'reserved.json';

export interface Ledger {
  baseline: { migration: number; scenario: number };
  migration: Record<string, string>;
  scenario: Record<string, string>;
}

/** The ledger's text read, or an empty ledger (baseline 0) when there is none. Malformed is the
 *  operator's to fix, refused. */
export function parseLedger(text: string | null): Ledger {
  if (text == null) return { baseline: { migration: 0, scenario: 0 }, migration: {}, scenario: {} };
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`${LEDGER_NAME} is not JSON: ${(e as Error).message.split('\n')[0]}`);
  }
  const map = (v: unknown, kind: ReserveKind): Record<string, string> => {
    if (v == null) return {};
    if (typeof v !== 'object' || Array.isArray(v)) throw new Error(`${LEDGER_NAME}: ${kind} maps a number to the ticket that holds it`);
    for (const [k, id] of Object.entries(v as Record<string, unknown>)) {
      if (!/^\d+$/.test(k) || typeof id !== 'string' || id === '') throw new Error(`${LEDGER_NAME}: ${kind}.${k} is not a number held by a ticket id`);
    }
    return v as Record<string, string>;
  };
  const b = (json.baseline ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0);
  return { baseline: { migration: num(b.migration), scenario: num(b.scenario) }, migration: map(json.migration, 'migration'), scenario: map(json.scenario, 'scenario') };
}

/** The ledger as written: keys in number order, two-space JSON, a final newline. */
export function writeLedger(l: Ledger): string {
  const sorted = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).sort(([a], [b]) => Number(a) - Number(b)));
  return `${JSON.stringify({ baseline: l.baseline, migration: sorted(l.migration), scenario: sorted(l.scenario) }, null, 2)}\n`;
}

/** The migration numbers in a folder's file names (`0029_repository_policies.sql` → 29). */
export const migrationNumbers = (names: readonly string[]): number[] =>
  names.map((n) => /^(\d{4})_.*\.sql$/.exec(n)?.[1]).filter((n): n is string => n != null).map(Number);

/** Every scenario number the spec or its history names (`S-BTN-n` anywhere: a row, a retired row,
 *  a citation), so a retired number is never issued again. */
export const scenarioNumbers = (texts: readonly string[], prefix = RESERVE_DEFAULTS.scenario_prefix): number[] => {
  const re = new RegExp(`(?<![A-Za-z0-9_-])${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)(?!\\d)`, 'g');
  return texts.flatMap((t) => [...t.matchAll(re)].map((m) => Number(m[1])));
};

/** The next number: one above the highest in the tree, the highest reserved and the baseline. */
export function nextReserved(kind: ReserveKind, tree: readonly number[], ledger: Ledger): number {
  return Math.max(ledger.baseline[kind], ...tree, ...Object.keys(ledger[kind]).map(Number), 0) + 1;
}

/** A number as the ledger keys it: a migration's four digits, a scenario's plain number. */
export const ledgerKey = (kind: ReserveKind, n: number): string => (kind === 'migration' ? String(n).padStart(4, '0') : String(n));
