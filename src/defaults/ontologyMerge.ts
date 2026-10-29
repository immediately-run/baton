// ontologyMerge.ts — the sync's merge of a repository's `.baton/ontology.json` with the
// built-in it names (BATON_SPEC §5.9, R-BTN-174, B-104). Pure, and shared by `baton repo sync`
// (which posts the result) and the tests: every CLI posts the same program for the same commit,
// and core — which never merges — validates what is posted.
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A file's entry, as the merge reads it: one of the three forms, or a route choice. */
type FileEntry = Record<string, unknown> & { id: string };

/** The merged program a board post carries, or the error that stops the merge. */
export type MergeResult = { builtin: string; program: Record<string, unknown> } | { error: string };

/** Where the built-in ontologies live: `src/defaults/` from a checkout, `dist/defaults/` from
 * the npm package — the same choice `cli.ts`'s `fromSource()` makes for the courses. */
export const ontologyRoot = (): string => {
  const here = dirname(fileURLToPath(import.meta.url));
  // From source this module sits beside cli.ts; bundled, import.meta.url is dist/baton.mjs and
  // the copies live under dist/defaults/ontology.
  return existsSync(join(here, 'cli.ts')) ? here : join(here, 'defaults');
};

/** The named built-in, as the CLI ships it under `ontology/` beside the defaults (R-BTN-174). */
export function builtInOntology(name: string): Record<string, unknown> | null {
  if (!/^baton@\d+$/.test(name)) return null;
  try {
    return JSON.parse(readFileSync(join(ontologyRoot(), 'ontology', `${name}.json`), 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const kindOf = (e: FileEntry): string => (e.route_choice ? 'route_choice' : 'constraint' in e ? 'constraint' : 'fact' in e ? 'fact' : 'head' in e ? 'rule' : 'unknown');
const isRouteChoice = (e: FileEntry): boolean => Array.isArray((e as { alternatives?: unknown }).alternatives);

/**
 * The merge R-BTN-174 fixes: start from the named built-in's entries, route choices and
 * `derived` list (or from nothing); drop the ids the file's `retract` lists; replace each one
 * whose id the file reuses — a reused route choice id replacing the whole route choice, a
 * replaced entry keeping its built-in position; append the file's other entries and route
 * choices in file order, and add its `derived` types. Ids are one namespace across entries and
 * route choices. The merge cannot be made when the CLI lacks the named version, a reused id
 * changes kind, `retract` names no built-in id, or an id is both retracted and reused: the sync
 * then posts `ontology: {error}` and the rest of the board as usual.
 */
export function mergeOntology(file: Record<string, unknown>): MergeResult {
  const builtinName = typeof file.builtin === 'string' ? file.builtin : null;
  const base = builtinName ? builtInOntology(builtinName) : null;
  if (builtinName && !base) return { error: `the CLI ships no built-in ontology ${builtinName}` };

  const baseEntries = ((base?.entries ?? []) as FileEntry[]).map((e) => ({ ...e }));
  const baseChoices = ((base?.route_choices ?? []) as FileEntry[]).map((e) => ({ ...e }));
  const derived = [...((base?.derived ?? []) as string[])];
  const retract = (file.retract ?? []) as string[];
  const fileEntries = (file.entries ?? []) as FileEntry[];
  const fileChoices = (file.route_choices ?? []) as FileEntry[];

  const builtInIds = new Set([...baseEntries, ...baseChoices].map((e) => e.id));
  const reused = new Map<string, FileEntry>();
  for (const e of [...fileEntries, ...fileChoices]) {
    if (builtInIds.has(e.id)) {
      const prior = baseEntries.find((x) => x.id === e.id) ?? baseChoices.find((x) => x.id === e.id);
      if (kindOf(prior!) !== kindOf(e)) return { error: `the id ${e.id} is reused as a ${kindOf(e)} of a different kind than the built-in's ${kindOf(prior!)}` };
      reused.set(e.id, e);
    }
  }
  for (const id of retract) {
    if (!builtInIds.has(id)) return { error: `retract names ${id}, which the built-in ${builtinName ?? '(none)'} does not have` };
    if (reused.has(id)) return { error: `the id ${id} is both retracted and reused` };
  }

  const keptEntries = baseEntries.filter((e) => !retract.includes(e.id));
  const replacedEntries = keptEntries.map((e) => reused.get(e.id) ?? e);
  const keptChoices = baseChoices.filter((e) => !retract.includes(e.id)).map((e) => reused.get(e.id) ?? e);
  const appended = [...fileEntries.filter((e) => !reused.has(e.id) && !retract.includes(e.id)), ...fileChoices.filter((e) => !reused.has(e.id) && !retract.includes(e.id))];
  for (const type of (file.derived ?? []) as string[]) if (!derived.includes(type)) derived.push(type);

  const program: Record<string, unknown> = { version: 1 };
  if (builtinName) program.builtin = builtinName;
  if (derived.length) program.derived = derived;
  program.entries = [...replacedEntries.map((e) => ({ ...e, id: e.id })), ...appended.filter((e) => !isRouteChoice(e))];
  program.route_choices = [...keptChoices, ...appended.filter(isRouteChoice).map((e) => ({ id: e.id, alternatives: e.alternatives }))];
  return { builtin: builtinName ?? 'baton@0', program };
}
