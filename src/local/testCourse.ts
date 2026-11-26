// testCourse.ts — `baton test-course <repository root> <course>` (BATON_SPEC §2d "A test kit, not a
// deploy", R-BTN-64, R-BTN-65; R3-1248): what a home repository's CI runs on a PR that changes
// `.baton/`. It is the local host, not a second implementation: the course file is checked by
// `validateCourse` and accepted or refused by the core exactly as a sync's post would be, every
// live ticket's path is replayed under the proposed file, and a generic run — claim, every leg of
// the shortest route, done, confirmed — goes through the core's own claim, advance and end,
// handing off to a fresh credential when independence requires it (S-BTN-63).
// It needs no access to production. A violation names its rule; none is a pass.
import { git as runGit } from '../defaults/git.mjs';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateCourse } from '../core/course';
import { graphOf, onGraph, resolvePath, signatureOf, type Graph, type Step } from '../core/graph';
import { BatonError } from '../core/http';
import { signatureConditions } from '../core/conditionTypes';
import { checkPayload, DEFAULT_COURSE } from '../core/board';
import { baseChain, checkSchemaSet, parseSchemaId, POST_STATES_MAX, refinementGaps, type Schema } from '../shared/schema.mjs';
import { stdSchema } from '../shared/std.mjs';
import { builtIn } from '../defaults/courses';
import { instructionsOf, resolveSource, runnerLegs, schemasIn, writeStub } from '../defaults/cli';
import { coursePath, isOverride, writeCourseTree } from '../defaults/course-tree';
import { parseSource } from '../defaults/course-source';
import { LocalHost } from './host';
import { openStore } from './store';

export type KitRule = 'course' | 'accepted' | 'legs-scripts' | 'min-runner-version' | 'moves-back' | 'generic-run' | 'no-op' | 'instructions'
  | 'schema' | 'entry' | 'spawns' | 'contract';
export interface KitViolation {
  rule: KitRule;
  message: string;
}

/** A schema as the sync posts it and the kit reads it (R-BTN-108): `<course>:<name>@<n>`, the
 *  SHA-256 of its file, and the schema itself. */
export interface KitSchema {
  id: string;
  digest: string;
  schema: unknown;
}

/** The versions a course is posted under (`.baton/baton.json`, R-BTN-51); null where unknown. */
export interface Versions {
  version: number;
  min_runner_version: number;
}

export interface KitInput {
  course: string;
  /** The proposed course file, and the one in force (the PR's base), if any. */
  proposed: unknown;
  base: unknown | null;
  proposedVersions: Versions | null;
  baseVersions: Versions | null;
  /** The repository root the kit read (readInputs); null over constructed inputs. The no-op run
   * (B-81) needs it to import the working tree's leg scripts. */
  root?: string | null;
  sourceDir?: string;
  /** The course entry's `source` (B-33), when .baton/baton.json names one: the standard course
   * whose files the repository scaffolds — how the kit tells a PR course filed under another id
   * (docs' `roadmap-pr`, sourced from `create-pr`) from the marker courses. */
  source?: string | null;
  /** The leg scripts in `legs/` — each name without `.mjs`, and which of §6.13's `run`, `handoff`
   *  and `close` it exports — or null when the course has no `legs/`. */
  legScripts: { name: string; exports: string[]; error?: string }[] | null;
  /** The leg instructions in `legs/` — each name without `.md` and its text; an empty list when
   *  the course has none. B-102's rule reads them: the implement and fix instructions carry the
   *  shared-file line, the one place the agents read it. */
  instructions?: { name: string; text: string }[] | null;
  /** R-BTN-134, R-BTN-108 (B-52): the course's schemas, `schemas/<name>@<n>.json` in its course
   *  directory, read by the same `courseSchemas` the sync's post spreads in — null when the
   *  course posts none, so a constructed input runs no schema rule. */
  schemas?: KitSchema[] | null;
  /** R-BTN-111 (B-52): the repository's other listed courses, each with its file (null when the
   *  checkout holds none — the sync refuses such a listing, so the kit reports it only where its
   *  own rules read it), its schemas and its versions, which the `spawns` check, the signature
   *  print and the kit's own registry post read — a post of one course alone could not resolve
   *  what the repository's schemas resolve together. */
  others?: { id: string; file: unknown | null; schemas: KitSchema[]; versions: Versions | null }[];
  /** The repository's leg overrides, `legs/<leg>.run.mjs` (R-BTN-131, B-33): each leg name and
   *  whether its module exports `run`, and whether `legs/<leg>.mjs` loads it (`loaded`; a leg
   *  script from before overrides does not). Absent or empty when there are none. */
  overrides?: { name: string; exports: string[]; error?: string; loaded?: boolean }[];
  /** Live tickets and where the sync placed them under the course in force; null when none were
   *  given (no board), so the replay did not run. */
  live: { id: string; path: Step[] }[] | null;
}

const asRecord = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});
const names = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? (v as string[]) : []);

/** §6.13's three exports of a leg script, each a function (default-exported or named, as `baton run` reads them). */
export const LEG_EXPORTS = ['run', 'handoff', 'close'] as const;

/** B-102's shared-file rule, the words every implement and fix instruction carries: a leg
 * never edits a file another ticket's leg may edit — the CHANGELOG rule the
 * parallel-collaboration review found. */
export const SHARED_FILE_RULE = "never edits a file another ticket's leg may edit";

/** Which of `LEG_EXPORTS` a loaded leg module provides. */
export function legExports(mod: Record<string, unknown>): string[] {
  const d = mod.default;
  const of = (name: string) => mod[name] ?? (d != null && typeof d === 'object' ? (d as Record<string, unknown>)[name] : undefined) ?? (name === 'run' && typeof d === 'function' ? d : undefined);
  return LEG_EXPORTS.filter((n) => typeof of(n) === 'function');
}

/** The stations and legs of `base` the proposed file has neither under the same name nor through a
 *  `renamed_from` (R-BTN-64: a removal, which older runners would misbehave on). */
export function removed(base: unknown, proposed: unknown): { stations: string[]; legs: string[] } {
  const b = asRecord(base);
  const p = asRecord(proposed);
  const kept = (kind: 'stations' | 'legs', name: string) =>
    Object.hasOwn(asRecord(p[kind]), name) || Object.values(asRecord(p[kind])).some((x) => names(asRecord(x).renamed_from).includes(name));
  return {
    stations: Object.keys(asRecord(b.stations)).filter((s) => !kept('stations', s)).sort(),
    legs: Object.keys(asRecord(b.legs)).filter((l) => !kept('legs', l)).sort(),
  };
}

/** The static rules: the file's own (R-BTN-69), the leg scripts, a removal's version raise, the
 *  schemas (R-BTN-108) with the refinement report, the entry contracts (R-BTN-109) and the
 *  spawns contracts (R-BTN-111). */
export function staticViolations(k: KitInput): KitViolation[] {
  const out: KitViolation[] = validateCourse(k.proposed).map((v) => ({ rule: 'course', message: `${v.path}: ${v.message} (${v.rule})` }));
  for (const v of legacyPathReport(k)) out.push(v);
  if (out.length) return out;
  const selectable = new Map([[k.course, k.proposed], ...(k.others ?? []).map((c): [string, unknown] => [c.id, c.file])]);
  for (const [leg, def] of Object.entries(asRecord(asRecord(k.proposed).legs))) {
    const entries = asRecord(asRecord(def).requires).tickets;
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const names = entry.at ?? entry.reached ?? [];
      const courses = entry.select === 'posted' ? [...selectable.entries()] : [[entry.course ?? k.course, selectable.get(entry.course ?? k.course)]];
      for (const [course, file] of courses) {
        if (!file) out.push({ rule: 'course', message: `legs.${leg}: unknown selectable course ${course}` });
        else for (const station of names) if (!Object.hasOwn(asRecord(asRecord(file).stations), station)) {
          out.push({ rule: 'course', message: `legs.${leg}: unknown selectable station ${course}:${station}` });
        }
      }
    }
  }
  if (k.legScripts) {
    const all = asRecord(asRecord(k.proposed).legs);
    const legs = Object.keys(all);
    const scripts = k.legScripts.map((x) => x.name);
    // Person and fact legs are answered or applied by core, never run by a script.
    const runs = legs.filter((x) => asRecord(all[x]).kind !== 'person' && !asRecord(all[x]).arrives);
    for (const l of runs.filter((x) => !scripts.includes(x))) out.push({ rule: 'legs-scripts', message: `leg ${l} has no legs/${l}.mjs` });
    for (const s of scripts.filter((x) => !legs.includes(x))) out.push({ rule: 'legs-scripts', message: `legs/${s}.mjs is no leg of the course` });
    // §6.13: "The test kit fails a script without all three" (round 1, 1-A-9).
    for (const x of k.legScripts) {
      // a script that does not load is its own failure, with its error (round 2, 2-r2-3)
      if (x.error) { out.push({ rule: 'legs-scripts', message: `legs/${x.name}.mjs does not load: ${x.error}` }); continue; }
      const missing = LEG_EXPORTS.filter((e) => !x.exports.includes(e));
      if (missing.length) out.push({ rule: 'legs-scripts', message: `legs/${x.name}.mjs exports no ${missing.join(', ')} (§6.13: run, handoff and close)` });
    }
  }
  // B-102: the shared-file rule — a leg never edits a file another ticket's leg may edit (no
  // CHANGELOG, no index, no aggregate; a release note belongs in the PR body). The instruction,
  // not a scanner, is the instrument; the kit asserts the line is where the agents read it:
  // every implement and fix instruction the course ships carries it.
  for (const x of k.instructions ?? []) {
    if ((x.name === 'implement' || x.name === 'fix') && !x.text.includes(SHARED_FILE_RULE)) {
      out.push({ rule: 'instructions', message: `legs/${x.name}.md carries no shared-file rule — a leg never edits a file another ticket's leg may edit (no CHANGELOG, no index, no aggregate; a release note belongs in the PR body). Add the Do-not line (B-102)` });
    }
  }
  // An override replaces one leg's run, never its close: it must name a leg and export run.
  for (const o of k.overrides ?? []) {
    const file = `legs/${o.name}.run.mjs`;
    if (!Object.hasOwn(asRecord(asRecord(k.proposed).legs), o.name)) out.push({ rule: 'legs-scripts', message: `${file} overrides no leg of the course` });
    else if (o.error) out.push({ rule: 'legs-scripts', message: `${file} does not load: ${o.error}` });
    else if (!o.exports.includes('run')) out.push({ rule: 'legs-scripts', message: `${file} exports no run(ctx, standard)` });
    else if (o.loaded === false) out.push({ rule: 'legs-scripts', message: `legs/${o.name}.mjs does not load ${file}, so the override never runs — \`baton repo init --course ${k.course} --override ${o.name}\` rewrites it` });
  }
  if (k.base) {
    const r = removed(k.base, k.proposed);
    if (r.stations.length || r.legs.length) {
      const what = [...r.stations.map((s) => `station ${s}`), ...r.legs.map((l) => `leg ${l}`)].join(', ');
      if (!k.proposedVersions || !k.baseVersions) {
        out.push({ rule: 'min-runner-version', message: `removes ${what}, and .baton/baton.json gives no min_runner_version to show it raised (R-BTN-64, R-BTN-65)` });
      } else if (k.proposedVersions.min_runner_version <= k.baseVersions.min_runner_version) {
        out.push({ rule: 'min-runner-version', message: `removes ${what} but leaves min_runner_version at ${k.proposedVersions.min_runner_version}: older runners would misbehave (R-BTN-64, R-BTN-65)` });
      }
    }
  }
  out.push(...schemaViolations(k), ...contractViolations(k), ...entryViolations(k), ...spawnsViolations(k));
  return out;
}

/** R-BTN-82: a required input is available on every route only if removing its producer
 * makes each of the consumer's departure stations unreachable. */
export function contractViolations(k: KitInput): KitViolation[] {
  const graph = graphOf(k.proposed);
  const { resolve } = schemaPool(k);
  const without = new Map<string, Set<string>>();
  const out: KitViolation[] = [];
  for (const [id, leg] of graph.legs) {
    for (const [name, output] of Object.entries(leg.outputs ?? {})) {
      if (!resolve(output.schema)) out.push({ rule: 'contract', message: `legs.${id}.outputs.${name}: missing schema ${output.schema}` });
    }
    for (const [name, input] of Object.entries(leg.inputs ?? {})) {
      const producer = input.from.split('.')[0];
      const version = graph.legs.get(producer)!.version;
      const at = `legs.${id}.inputs.${name}`;
      if (input.accepts && !input.accepts.includes(version)) out.push({ rule: 'contract', message: `${at} does not accept ${producer}'s current version ${version}` });
      if (input.required === false) continue;
      let reachable = without.get(producer);
      if (!reachable) {
        reachable = new Set([graph.start]);
        for (const station of reachable) {
          for (const [edge, def] of graph.legs) if (edge !== producer && def.from.includes(station)) for (const to of def.to) reachable.add(to);
        }
        without.set(producer, reachable);
      }
      const bypassed = leg.from.filter((station) => reachable.has(station));
      if (bypassed.length) out.push({ rule: 'contract', message: `${at}: ${bypassed.join(', ')} can be reached without ${producer}` });
    }
  }
  return out;
}

/** The schemas a kit run resolves ids through (R-BTN-108): the course's own, the repository's
 *  other courses', and the `std:` library — the pool the core's registry builds over a post,
 *  before anything only Baton's store holds. */
function schemaPool(k: KitInput): { resolve: (id: string) => Schema | null } {
  const pool = new Map<string, unknown>();
  for (const s of [...(k.schemas ?? []), ...(k.others ?? []).flatMap((o) => o.schemas)]) pool.set(s.id, s.schema);
  return { resolve: (id: string) => (pool.has(id) ? (pool.get(id) as Schema) : stdSchema(id)) };
}

/**
 * B-52, R-BTN-108: the kit's schema rules over the course's schemas — each inside the subset,
 * every `$ref` and `x-baton-base` resolving among the repository's schemas and the `std:`
 * library, no cycle — and the static refinement report: for each schema with an
 * `x-baton-base`, every place it does not provably refine its base, each reported with its
 * keyword (S-BTN-65: a refinement dropping `head_sha` from `required` is reported, naming
 * `required`). Runs only when the kit read schemas: a course with none posts none.
 */
export function schemaViolations(k: KitInput): KitViolation[] {
  const out: KitViolation[] = [];
  if (!k.schemas) return out;
  const { resolve } = schemaPool(k);
  // The same meter the sync's post draws on, so a course of costly patterns fails here as there.
  const meter = { steps: POST_STATES_MAX };
  for (const f of checkSchemaSet(Object.fromEntries(k.schemas.map((s) => [s.id, s.schema])), resolve, { meter })) {
    out.push({ rule: 'schema', message: `${f.id}${f.path ? ` ${f.path}` : ''}: ${f.message}` });
  }
  for (const s of k.schemas) {
    const baseId = asRecord(s.schema)['x-baton-base'];
    if (typeof baseId !== 'string') continue;
    const base = resolve(baseId);
    if (!base) continue; // unresolved is the set check's own report
    for (const g of refinementGaps(s.schema, base, resolve)) {
      out.push({ rule: 'schema', message: `${s.id}${g.path ? ` ${g.path}` : ''} does not refine ${baseId} — ${g.message}${g.keyword ? ` (keyword: ${g.keyword})` : ''}` });
    }
  }
  return out;
}

/**
 * B-52, R-BTN-109: entry against contracts. Every `entry` schema is posted or `std:` (the
 * core's own rule at a post; here over the same pool), and every leg arriving at a station
 * declares outputs that can meet its requirements: an output of the name, whose schema is the
 * required one or a refinement of it by the posted base chains — the identity the core's
 * `checkEntry` enforces at an arrival, checked statically here.
 */
export function entryViolations(k: KitInput): KitViolation[] {
  const out: KitViolation[] = [];
  const { resolve } = schemaPool(k);
  const g = graphOf(k.proposed);
  const outputsOf = (leg: string): Record<string, { schema?: unknown }> => asRecord(asRecord(asRecord(asRecord(k.proposed).legs)[leg]).outputs);
  for (const [station, reqs] of g.entry) {
    for (const [i, r] of reqs.entries()) {
      if (!resolve(r.schema)) out.push({ rule: 'entry', message: `stations.${station}.entry.${i}.schema: ${r.schema} is not posted or in the std: library` });
    }
    for (const [leg, l] of g.legs) {
      if (!l.to.includes(station)) continue;
      for (const r of reqs) {
        const declared = outputsOf(leg)[r.output];
        if (declared === undefined || typeof declared.schema !== 'string') {
          out.push({ rule: 'entry', message: `legs.${leg} arrives at ${station}, whose entry requires the output ${r.output} (${r.schema}); it declares no such output (R-BTN-109)` });
        } else if (declared.schema !== r.schema && !baseChain(declared.schema, resolve).includes(r.schema)) {
          out.push({ rule: 'entry', message: `legs.${leg}'s output ${r.output} is ${declared.schema}, which is not ${r.schema} or a refinement of it, as ${station}'s entry requires (R-BTN-109)` });
        }
      }
    }
  }
  return out;
}

/**
 * B-52, R-BTN-111: a leg's `spawns` against each course it names — what it `provides` must meet
 * that course's input, its `start` station's `entry`; `"*"` is checked against every course the
 * repository lists other than the leg's own. A named course the repository does not list is a
 * fault of the file; one whose file the checkout holds none of is the sync's refusal, reported
 * here because the contract cannot be read. A child filed on another course is a script fault,
 * which no static rule sees.
 */
export function spawnsViolations(k: KitInput): KitViolation[] {
  const out: KitViolation[] = [];
  const others = k.others ?? [];
  const files = new Map(others.map((o) => [o.id, o.file]));
  const meet = (leg: string, provides: string[], id: string, input: { output: string; schema: string }[]) => {
    for (const r of input) {
      if (!provides.includes(r.output)) {
        out.push({ rule: 'spawns', message: `legs.${leg}.spawns provides no ${r.output}, which ${id}'s input requires (${r.schema}) (R-BTN-111)` });
      }
    }
  };
  for (const [leg, l] of Object.entries(asRecord(asRecord(k.proposed).legs))) {
    const raw = asRecord(l);
    if (!('spawns' in raw)) continue;
    const sp = asRecord(raw.spawns);
    const provides = names(sp.provides).filter((x) => typeof x === 'string');
    const named = names(sp.course);
    if (sp.course === '*') {
      for (const o of others) {
        if (o.file == null) continue; // the sync's own refusal names the missing file
        meet(leg, provides, o.id, signatureOf(o.file).input);
      }
      continue;
    }
    for (const id of named) {
      if (!files.has(id) && id !== k.course) {
        out.push({ rule: 'spawns', message: `legs.${leg}.spawns names the course ${id}, which .baton/baton.json does not list (R-BTN-111)` });
        continue;
      }
      const file = id === k.course ? k.proposed : files.get(id);
      if (file == null) {
        out.push({ rule: 'spawns', message: `legs.${leg}.spawns names the course ${id}, whose file .baton/courses/${id}/course.json the checkout holds none of — the contract cannot be checked (R-BTN-111)` });
        continue;
      }
      meet(leg, provides, id, signatureOf(file).input);
    }
  }
  return out;
}

/** The closed legacy window (history, Migrations: Legacy schema forms, deleted with the close):
 *  an output `schema` that is a relative path is a `shape` violation like any other non-id
 *  string, and this report names the id to write in its place — the path was read as
 *  `<course>:<leg>.<output>@<contract version>`, so that is the id to post at `schemas/` of the
 *  course directory and name instead. Reported beside the refusal, so a file still carrying one
 *  is fixed in one reading. */
function legacyPathReport(k: KitInput): KitViolation[] {
  const isPath = (v: unknown): v is string =>
    typeof v === 'string' && v.length > 0 && v.length <= 200 && v.split('/').every((seg) => /^[A-Za-z0-9._-]+$/.test(seg) && seg !== '.' && seg !== '..');
  const out: KitViolation[] = [];
  for (const [leg, l] of Object.entries(asRecord(asRecord(k.proposed).legs))) {
    const version = asRecord(l).version;
    const at = Number.isInteger(version) ? (version as number) : 0;
    for (const [name, o] of Object.entries(asRecord(asRecord(l).outputs))) {
      const s = asRecord(o).schema;
      if (!isPath(s) || parseSchemaId(s)) continue;
      out.push({ rule: 'schema', message: `legs.${leg}.outputs.${name}.schema: "${s}" is the legacy path form, which the closed window no longer reads — write "${k.course}:${leg}.${name}@${at}" in its place, posting the schema at schemas/${leg}.${name}@${at}.json of the course directory (R-BTN-108)` });
    }
  }
  return out;
}

/** Every live ticket's path replayed under the proposed file: one that is no longer a path of it
 *  would be placed back without its evidence changing (R-BTN-64). */
export function replayViolations(proposed: unknown, live: KitInput['live']): KitViolation[] {
  const g = graphOf(proposed);
  return (live ?? []).filter((t) => !onGraph(g, t.path)).map((t) => ({
    rule: 'moves-back',
    message: `${t.id}: its path ${t.path.map((s) => `${s.leg}→${s.reached}`).join(', ') || '(none)'} is not a path of the proposed course${
      resolvePath(g, t.path).some((s) => !g.legs.has(s.leg) || !g.stations.has(s.reached)) ? ' (a leg or station it ran is gone)' : ''}: the ticket would move back with the same evidence`,
  }));
}

/** The shortest route from the start to an end, as steps (breadth-first over every leg's outcomes),
 * its first step the course's `start_leg`: a new ticket's queued leg, the only one its first
 * advance may take (R-BTN-83, `not-queued`). Found by B-28's `review-pr`, whose shortest route
 * from `requested` was its other leg. */
export function shortestRoute(g: Graph): Step[] | null {
  if (g.ends.has(g.start)) return [];
  const first = g.legs.get(g.startLeg);
  if (!first) return null;
  const prev = new Map<string, { from: string; step: Step } | null>([[g.start, null]]);
  let frontier: string[] = [];
  for (const to of first.to) if (!prev.has(to)) { prev.set(to, { from: g.start, step: { leg: g.startLeg, reached: to } }); frontier.push(to); }
  while (frontier.length) {
    const next: string[] = [];
    for (const s of frontier) {
      if (g.ends.has(s)) {
        const route: Step[] = [];
        for (let at = s; prev.get(at); at = prev.get(at)!.from) route.unshift(prev.get(at)!.step);
        return route;
      }
      for (const [leg, l] of [...g.legs].sort(([a], [b]) => (a < b ? -1 : 1))) {
        // A person's leg is answered, never advanced into (R-BTN-116, rule person): the generic
        // run is a runner's, so its route takes runner legs alone (B-257's `confirm`).
        if (!l.from.includes(s) || l.person || l.arrives || l.reconciles) continue;
        for (const to of l.to) if (!prev.has(to)) { prev.set(to, { from: s, step: { leg, reached: to } }); next.push(to); }
      }
    }
    frontier = next;
  }
  return null;
}

const REPO = 'kit'; // the repository under test, as the kit's own local host registers it
const SHA = (n: number) => n.toString(16).padStart(40, '0');

/** The core's verdict, on a fresh in-memory local host: the base file then the proposed one posted
 *  as a sync would post them (accepted, not refused — R-BTN-69), and one generic run of a ticket
 *  along the proposed course's shortest route: claim, each leg, done, confirmed by the next post. */
export async function coreViolations(k: KitInput): Promise<KitViolation[]> {
  const proposed = graphOf(k.proposed);
  const route = shortestRoute(proposed) ?? [];
  // Each step can need at most one fresh synthetic credential.
  const credentials = Array.from({ length: Math.max(1, route.length) }, (_, i) => `test-course-${i + 1}`);
  let clock = Date.parse('2026-01-01T00:00:00Z');
  const { store } = openStore(':memory:');
  const host = new LocalHost({
    store, alarm: 'manual',
    config: {
      BATON_ORIGIN: 'http://127.0.0.1', OIDC_ISSUER: '', OIDC_JWKS_URL: '', ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '', OWNER_EMAILS: '',
      CREDENTIALS: JSON.stringify(Object.fromEntries(credentials.map((cred) => [cred, { hostname: cred, allowed_capabilities: ['agent-venue'] }]))),
      TOKEN_HASHES: JSON.stringify(Object.fromEntries(credentials.map((cred) => [cred, 'unused']))),
      BATON_REPOSITORIES: JSON.stringify([{ id: REPO, github: 'local/kit', default_branch: 'main', sync_workflow: '.github/workflows/baton-sync.yml' }]),
    },
  });
  const core = host.core;
  core.now = () => clock; // R-BTN-32: the kit's own clock, so the run is the same every time
  await host.start();
  const out: KitViolation[] = [];
  const version = k.proposedVersions ?? { version: 1, min_runner_version: 1 };
  // B-52: each post's registry entry, the shape the sync's own post gives a course — its
  // schemas included, read by the same `courseSchemas` (R-BTN-108, R-BTN-134).
  const entry = (id: string, course: unknown, v: Versions, schemas: KitSchema[]) => ({ id, version: v.version, min_runner_version: v.min_runner_version, skill: id,
    course, step_kinds: ['other'], branch_pattern: 'claude/{ticket}-*', ...(schemas.length ? { schemas } : {}) });
  const ticket = (id: string) => ({ id, course_id: k.course, path: `tickets/${id}.md`, title: id, tier: 'routine', requires: [], operator_only: false,
    expedite: false, depends_on: [], blocked_by: [], repos: [], rank: 1 });
  let n = 0;
  const post = async (registry: unknown[], stations: Record<string, unknown>, closed: { id: string; as: 'done' }[] = []) => {
    const repo = core.registry.get(REPO)!;
    // R-BTN-62: a number first, as the sync takes it; any refusal is the kit's failure (round 1, 1-A-8).
    const observation = core.observations.observe(REPO).observation;
    const tickets = Object.keys(stations).map(ticket);
    // checked as the sync route checks a post, then judged by the core's own board()
    const p = checkPayload({ registry, sha: SHA(++n), parent_sha: n === 1 ? null : SHA(n - 1), tickets, closed, stations, observation });
    return (await core.board(repo, p)) as Record<string, unknown>;
  };
  const placedAt = (g: Graph, path: Step[], queued?: string) => {
    const at = path.length ? path[path.length - 1].reached : g.start;
    const next = [...g.legs].filter(([, l]) => l.from.includes(at)).map(([leg]) => ({ leg, state: 'ready' }));
    return { station: at, path, next_leg: queued ?? next[0]?.leg ?? null, next_source: 'marker', next, bars: {} };
  };
  try {
    // The registry of each post: the other listed courses beside the one under test — their
    // files as the working tree holds them — and its own schemas spread in (R-BTN-108).
    const registry = (ownCourse: unknown, v: Versions, schemas: KitSchema[]): unknown[] => [
      ...(k.others ?? []).filter((o) => o.file != null).map((o) => entry(o.id, o.file, o.versions ?? { version: 1, min_runner_version: 1 }, o.schemas)),
      entry(k.course, ownCourse, v, schemas),
    ];
    // The base file first, with the live tickets where it placed them; then the proposed one.
    if (k.base) await post(registry(k.base, k.baseVersions ?? version, []), Object.fromEntries((k.live ?? []).filter((t) => onGraph(graphOf(k.base), t.path)).map((t) => [t.id, placedAt(graphOf(k.base), t.path)])));
    const proposedRegistry = registry(k.proposed, version, k.schemas ?? []);
    await post(proposedRegistry, { 'KIT-1': placedAt(proposed, []) });
    const refused = core.courses.refusals().filter((r) => r.course_id === k.course);
    for (const r of refused) for (const v of r.violations) out.push({ rule: 'accepted', message: `the core refuses the file: ${v.path}: ${v.message} (${v.rule})` });
    if (refused.length) return out;
    if (!route.length) return [{ rule: 'generic-run', message: `no route from ${proposed.start} to an end` }];

    // One generic run (S-BTN-17 in the course's terms): claim, run the route, end done, confirmed.
    core.store.transaction(() => core.cutover.cutover('test-course', { repository: REPO, confirm: true }));
    const secret = 'test-course-secret';
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)))].map((b) => b.toString(16).padStart(2, '0')).join('');
    const tx = <T>(f: () => T) => core.store.transaction(f);
    const take = async (cred: string) => {
      const { runner_id } = await core.runners.heartbeat(cred, null, { hostname: cred, session_name: 'test-course', harness: 'claude-code', kind: 'vm', capabilities: ['agent-venue'],
        model_id: 'anthropic/kit', tier_ceiling: 'critical', lease_timeout_s: 3600, secret_hash: hash, courses: [{ repository: REPO, course: k.course, version: version.version }] }) as { runner_id: number };
      const { claim_id } = tx(() => core.claims.claim(runner_id, { request_id: cred, ticket_id: `${REPO}:KIT-1` })) as { claim_id: number };
      return { runner_id, claim_id };
    };
    let holder = await take(credentials[0]);
    // R-BTN-109: an arrival at a station with an `entry` must carry each output it names — the
    // generic run gives one by pointer (a git: uri the kit's own commit answers for), which the
    // arrival check reads by name and schema as a holder's would be.
    const outputsAt = (step: Step) => {
      const declared = proposed.legs.get(step.leg)?.outputs;
      const outputs = declared ? Object.entries(declared).map(([name, o]) => ({ name, schema: o.schema }))
        : (proposed.entry.get(step.reached) ?? []).map((r) => ({ name: r.output, schema: r.schema }));
      return outputs.map((o) => ({ ...o, uri: `git:local/kit@${SHA(999)}:kit/${o.name}` }));
    };
    let at = proposed.start;
    let previous: Step | undefined;
    for (const [i, step] of route.entries()) {
      clock += 60_000;
      try {
        tx(() => core.claims.advance(holder.runner_id, holder.claim_id, { leg: step.leg, ...(previous ? { reached: at, outputs: outputsAt(previous) } : {}) }));
      } catch (e) {
        if (!previous || !(e instanceof BatonError) || e.extra.rule_code !== 'chain') throw e;
        const from = previous;
        tx(() => core.claims.end(holder.runner_id, holder.claim_id, { end_reason: `suspended:${at}`, reached: at, next: step.leg, outputs: outputsAt(from) }));
        const posted = await post(proposedRegistry, { 'KIT-1': placedAt(proposed, route.slice(0, i), step.leg) });
        if (!posted.confirmed) return [{ rule: 'generic-run', message: `the hand-off at ${at} was not confirmed by a snapshot queuing ${step.leg}` }];
        holder = await take(credentials[i]);
        tx(() => core.claims.advance(holder.runner_id, holder.claim_id, { leg: step.leg }));
      }
      at = step.reached;
      previous = step;
    }
    clock += 60_000;
    const end = tx(() => core.claims.end(holder.runner_id, holder.claim_id, { end_reason: 'done', reached: at, ended_at_sha: SHA(999), outputs: outputsAt(route[route.length - 1]) })) as { ok?: boolean; code?: string };
    if (!end.ok) return [{ rule: 'generic-run', message: `the done end at ${at} was refused: ${end.code ?? ''}` }];
    const posted = await post(proposedRegistry, { 'KIT-1': placedAt(proposed, route) });
    if (!posted.confirmed) out.push({ rule: 'generic-run', message: `the done end at ${at} was not confirmed by a snapshot placing the ticket there` });
  } catch (e) {
    out.push({ rule: 'generic-run', message: `the local host failed: ${(e as Error).message}` });
  } finally {
    await host.stop();
  }
  return out;
}

/** B-81: a stub whose leg opens a PR verifies it on the forge before claiming it — an agent
 * that exits 0 without one is not the leg's outcome. The kit runs the course's start leg in a
 * scratch checkout whose `agent_command` is a no-op (`true`, exit 0) and whose origin no forge
 * answers, so nothing can be verified: the leg script must fail its leg (naming what it looked
 * for), and one that returns a position anyway is the violation the first acceptance run hit —
 * the claim advanced to a review of nothing. Marker courses are exempt: their stubs report the
 * agent's `reached`, and the core checks that against the course graph before the marker is
 * closed — the weaker form the ticket leaves alone. */
export async function noopViolations(k: KitInput): Promise<KitViolation[]> {
  if (!k.root) return [];
  let standard: ReturnType<typeof builtIn> = undefined;
  try {
    standard = builtIn(k.source != null ? parseSource(k.source).course : k.course);
  } catch {
    standard = undefined; // a source that is not a name: the sync's to refuse, not the kit's
  }
  if (standard?.reads !== 'prs') return [];
  const graph = graphOf(k.proposed);
  const startLeg = graph.startLeg;
  const script = join(k.sourceDir ?? join(k.root, coursePath(k.course)), 'legs', `${startLeg}.mjs`);
  if (!existsSync(script)) return []; // a missing script is the legs-scripts rule's own failure
  const dir = mkdtempSync(join(tmpdir(), 'baton-kit-noop-'));
  try {
    // The scratch checkout: a no-op agent_command at the snapshot, and an origin no forge
    // answers, so the verification cannot succeed and must say so.
    const git = (out: boolean, ...args: string[]) =>
      runGit(dir, ['-c', 'user.name=kit', '-c', 'user.email=kit@baton.test', ...args], { stdio: ['ignore', out ? 'pipe' : 'ignore', 'ignore'] });
    git(false, 'init', '-q', '-b', 'main');
    git(false, 'remote', 'add', 'origin', 'https://127.0.0.1:1/kit/no-forge.git');
    mkdirSync(join(dir, '.baton'), { recursive: true });
    writeFileSync(join(dir, '.baton', 'baton.json'), JSON.stringify({ agent_command: 'true', courses: [{ id: k.course, version: 1, min_runner_version: 1 }] }));
    git(false, 'add', '-A');
    git(false, 'commit', '-qm', 'kit');
    const sha = git(true, 'rev-parse', 'HEAD').trim();
    const mod = (await import(`${pathToFileURL(script).href}?t=${Math.random()}`)) as Record<string, unknown>;
    const run = mod.run ?? (mod.default != null && typeof mod.default === 'object' ? (mod.default as Record<string, unknown>).run : undefined) ?? (typeof mod.default === 'function' ? mod.default : undefined);
    if (typeof run !== 'function') return []; // a script that exports no run is the legs-scripts rule's
    try {
      const result = await (run as (ctx: unknown) => Promise<unknown>)({ ticket: { id: `${REPO}:KIT-1`, home: REPO }, leg: startLeg, checkout: dir, snapshot: { sha } });
      // Create-spec can wait for the owner to finish the conversation without claiming a PR opened.
      const answer = asRecord(result);
      if (standard.id === 'create-spec' && answer.suspend === true && answer.reached === graph.start && answer.next === startLeg) return [];
      return [{ rule: 'no-op', message: `legs/${startLeg}.mjs returned ${JSON.stringify(result)} for an agent_command that exits 0 with no PR — the course opens PRs, so its start leg must verify one on the forge before returning its position, failing the leg naming what it looked for (B-81)` }];
    } catch {
      return []; // the leg refused the no-op: what B-81 asks
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** B-100: a marker course's close writes the ticket — and the boundary check is the leg's
 *  outcome, not the agent's exit. The kit runs the course's start leg's `close` in a scratch
 *  checkout whose ticket file is valid frontmatter but carries no `## <start leg>` heading (a
 *  no-op agent wrote nothing): the close must fail the leg naming the heading. One that pushes
 *  a state change anyway is the violation — the ticket is the record, and nothing the agent
 *  touched is trusted unchecked. */
export async function ticketViolations(k: KitInput): Promise<KitViolation[]> {
  if (!k.root) return [];
  let standard: ReturnType<typeof builtIn> = undefined;
  try {
    standard = builtIn(k.source != null ? parseSource(k.source).course : k.course);
  } catch {
    standard = undefined; // a source that is not a name: the sync's to refuse, not the kit's
  }
  if (standard?.reads !== 'markers') return [];
  const startLeg = graphOf(k.proposed).startLeg;
  const script = join(k.sourceDir ?? join(k.root, coursePath(k.course)), 'legs', `${startLeg}.mjs`);
  if (!existsSync(script)) return []; // a missing script is the legs-scripts rule's own failure
  const dir = mkdtempSync(join(tmpdir(), 'baton-kit-ticket-'));
  // A local bare origin the close can really fetch (round 1, finding 5): the rule must reach
  // the close's own checks, not pass on a fetch that cannot connect.
  const origin = mkdtempSync(join(tmpdir(), 'baton-kit-ticket-origin-'));
  try {
    runGit(origin, ['init', '-q', '--bare', '-b', 'main'], { stdio: 'ignore' });
    const git = (out: boolean, ...args: string[]) =>
      runGit(dir, ['-c', 'user.name=kit', '-c', 'user.email=kit@baton.test', ...args], { stdio: ['ignore', out ? 'pipe' : 'ignore', 'ignore'] });
    git(false, 'init', '-q', '-b', 'main');
    git(false, 'remote', 'add', 'origin', origin);
    mkdirSync(join(dir, 'tickets'), { recursive: true });
    writeFileSync(join(dir, 'tickets', 'kit-1.md'), `---\nid: KIT-1\ntitle: A ticket\n---\n\nA body with no ${startLeg} heading.\n`);
    git(false, 'add', '-A');
    git(false, 'commit', '-qm', 'kit');
    git(false, 'push', '-q', 'origin', 'main');
    const sha = git(true, 'rev-parse', 'HEAD').trim();
    const mod = (await import(`${pathToFileURL(script).href}?t=${Math.random()}`)) as Record<string, unknown>;
    const close = mod.close ?? (mod.default != null && typeof mod.default === 'object' ? (mod.default as Record<string, unknown>).close : undefined);
    if (typeof close !== 'function') return []; // a script that exports no close is the legs-scripts rule's
    try {
      await (close as (ctx: unknown, result: unknown) => Promise<unknown>)(
        { ticket: { id: `${REPO}:KIT-1`, path: 'tickets/kit-1.md', home: REPO }, leg: startLeg, checkout: dir, snapshot: { sha }, claim: { nonce: 'kit' }, default_branch: 'main' },
        { reached: graphOf(k.proposed).legs.get(startLeg)!.to[0], next: null },
      );
      return [{ rule: 'no-op', message: `legs/${startLeg}.mjs's close accepted a ticket with no '## ${startLeg}' heading — the marker courses' state is the ticket itself, so the close must validate it (the item schema, the machine fields, its own heading) and fail the leg naming what broke (B-100)` }];
    } catch {
      return []; // the close refused the mangled ticket: what B-100 asks
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(origin, { recursive: true, force: true });
  }
}

/** B-52 (R-BTN-111, with B-234's condition half): the signature lines `baton course test`
 *  prints — the course's **input** (its `start` station's entry), its **output** (each `end`
 *  station's entry) and the conditions its legs may raise — and, for each course its legs'
 *  `spawns` name, that course's signature beside it: the two contracts a spawn composes
 *  against, read in one place (S-BTN-80: both signatures printed). */
export function signatureLines(k: KitInput): string[] {
  const reqs = (r: { output: string; schema: string }[]) => (r.length ? r.map((x) => `${x.output}=${x.schema}`).join(', ') : '(none)');
  const of = (id: string, file: unknown): string[] => {
    const s = signatureOf(file);
    const c = signatureConditions(file);
    return [
      `signature: ${id} input ${reqs(s.input)}`,
      ...s.output.map((e) => `signature: ${id} output ${e.station} ${reqs(e.entry)}`),
      `signature: ${id} conditions ${[...c.standard, ...c.declared].join(', ')}`,
      ...c.narrowed.map((n) => `signature: ${id} legs.${n.leg} conditions ${n.types.length ? n.types.join(', ') : '(none)'}`),
    ];
  };
  const out = of(k.course, k.proposed);
  const named = new Set<string>();
  for (const l of Object.values(asRecord(asRecord(k.proposed).legs))) {
    for (const id of names(asRecord(asRecord(l).spawns).course)) if (id !== '*' && id !== k.course) named.add(id);
  }
  for (const id of [...named].sort()) {
    const file = (k.others ?? []).find((o) => o.id === id)?.file;
    if (file != null) out.push(...of(id, file));
  }
  return out;
}

/** The whole kit over in-memory inputs. */
export async function checkCourse(k: KitInput): Promise<KitViolation[]> {
  const s = staticViolations(k);
  if (s.some((v) => v.rule === 'course')) return s;
  return [...s, ...replayViolations(k.proposed, k.live), ...(await coreViolations(k)), ...(await noopViolations(k)), ...(await ticketViolations(k))];
}

/** The kit's inputs from a repository checkout: the proposed `.baton/` in the working tree, the
 *  base at git `base` (a commit that must resolve; the course absent there is a new course), the
 *  live tickets from a board payload file, and each leg script's exports (imported: the kit runs
 *  in the repository's own CI, on its own code). */
export async function readInputs(root: string, course: string, opts: { base?: string | null; board?: string | null } = {}): Promise<KitInput> {
  return readFrom(root, course, opts);
}

/** Keep the materialized source alive for the kit's probe runs, then discard it. */
export async function checkCheckout(root: string, course: string, opts: { base?: string | null; board?: string | null }) {
  const scratch = mkdtempSync(join(tmpdir(), 'baton-kit-source-'));
  try {
    const input = await readFrom(root, course, opts, scratch);
    return { input, violations: await checkCourse(input) };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function readFrom(root: string, course: string, opts: { base?: string | null; board?: string | null }, scratch?: string): Promise<KitInput> {
  const dir = join(root, coursePath(course));
  const versionsOf = (json: unknown, id: string): Versions | null => {
    const c = (asRecord(json).courses as unknown[] | undefined)?.map(asRecord).find((x) => x.id === id);
    return c && Number.isInteger(c.version) && Number.isInteger(c.min_runner_version) ? { version: c.version, min_runner_version: c.min_runner_version } : null;
  };
  const batonJson = join(root, '.baton', 'baton.json');
  const settings = existsSync(batonJson) ? asRecord(JSON.parse(readFileSync(batonJson, 'utf8'))) : {};
  const entries = (settings.courses as unknown[] | undefined)?.map(asRecord) ?? [];
  const entry = entries.find((x) => x.id === course);
  const courseSource = typeof entry?.source === 'string' ? entry.source : null;
  const source = courseSource && scratch ? await resolveSource(course, courseSource, scratch) : null;
  let sourceDir: string | undefined;
  if (source) {
    sourceDir = mkdtempSync(join(scratch!, 'course-'));
    const checkCopies = (sub: string) => {
      if (!existsSync(join(dir, sub))) return;
      for (const f of readdirSync(join(dir, sub), { withFileTypes: true })) {
        const path = sub ? `${sub}/${f.name}` : f.name;
        if (f.isDirectory()) checkCopies(path);
        else if (!f.isFile() || !isOverride(path)) throw new Error(`${coursePath(course)}/${path}: not an override of a sourced course`);
      }
    };
    checkCopies('');
    if (source.standard) {
      mkdirSync(join(sourceDir, 'legs'));
      for (const leg of runnerLegs(source.standard)) {
        await writeStub(source.standard, leg, join(sourceDir, 'legs', `${leg}.mjs`));
        writeFileSync(join(sourceDir, 'legs', `${leg}.md`), instructionsOf(course, leg));
      }
    } else if (source.files) writeCourseTree(sourceDir, source.files, false);
  }
  const file = join(dir, 'course.json');
  if (!source && !existsSync(file)) throw new Error(`${file}: no such course file`);
  const proposed = JSON.parse(source?.graph ?? readFileSync(file, 'utf8'));
  const proposedVersions = versionsOf({ courses: [{ ...source?.entry, ...entry }] }, course);
  // B-52 (R-BTN-134, R-BTN-108): the course's schemas, from `schemas/` of its course directory
  // through the same `courseSchemas` the sync's post spreads in — one reader, one path — and
  // the repository's other listed courses beside it, whose files, schemas and versions the
  // spawns check, the signature print and the kit's own registry post read. A sourced course's
  // schemas sit in its source's directory, which B-43 wires to `courseSchemas`.
  const schemas = schemasIn(sourceDir ?? dir, course).schemas ?? null;
  const others: NonNullable<KitInput['others']> = [];
  for (const other of entries) {
    const id = other.id;
    if (typeof id !== 'string' || id === course) continue;
    const otherDir = join(root, coursePath(id));
    const otherFile = join(otherDir, 'course.json');
    const src = typeof other.source === 'string' && scratch ? await resolveSource(id, other.source, scratch) : null;
    const schemaDir = src ? mkdtempSync(join(scratch!, 'schemas-')) : otherDir;
    if (src?.files) writeCourseTree(schemaDir, src.files.filter((f) => f.path.startsWith('schemas/')), false);
    others.push({ id, file: src ? JSON.parse(src.graph) : existsSync(otherFile) ? JSON.parse(readFileSync(otherFile, 'utf8')) : null,
      schemas: schemasIn(schemaDir, id).schemas ?? [], versions: versionsOf({ courses: [{ ...src?.entry, ...other }] }, id) });
  }
  const gitAtRoot = (...args: string[]) => runGit(root, args);
  let base: unknown = null;
  let baseVersions: Versions | null = null;
  if (opts.base) {
    // A base that does not resolve is an error, never "a new course" (round 1, 1-A-2/1-B-0).
    try {
      gitAtRoot('rev-parse', '--verify', '--quiet', `${opts.base}^{commit}`);
    } catch {
      throw new Error(`--base ${opts.base}: not a commit in ${root} (fetch it, or pass --base none to skip the removal rule)`);
    }
    // Only a path the base does not have reads as absent; a file that is there must parse.
    const show = (path: string) => {
      try {
        gitAtRoot('cat-file', '-e', `${opts.base}:${path}`);
      } catch {
        return null;
      }
      return JSON.parse(gitAtRoot('show', `${opts.base}:${path}`));
    };
    const baseSettings = asRecord(show('.baton/baton.json'));
    const baseEntry = (baseSettings.courses as unknown[] | undefined)?.map(asRecord).find((x) => x.id === course);
    const src = typeof baseEntry?.source === 'string' && scratch ? await resolveSource(course, baseEntry.source, scratch) : null;
    base = src ? JSON.parse(src.graph) : show(`${coursePath(course)}/course.json`);
    baseVersions = versionsOf({ courses: [{ ...src?.entry, ...baseEntry }] }, course);
  }
  const legsDir = join(sourceDir ?? dir, 'legs');
  const homeLegs = join(dir, 'legs');
  let legScripts: KitInput['legScripts'] = null;
  const instructions: { name: string; text: string }[] = [];
  const overrides: NonNullable<KitInput['overrides']> = [];
  if (existsSync(legsDir)) {
    legScripts = [];
    const prompts = new Set(readdirSync(legsDir).filter((x) => x.endsWith('.md')));
    if (sourceDir && existsSync(homeLegs)) for (const f of readdirSync(homeLegs).filter((x) => x.endsWith('.md'))) prompts.add(f);
    for (const f of [...prompts].sort()) {
      const name = f.slice(0, -'.md'.length);
      instructions.push({ name, text: readFileSync(join(existsSync(join(homeLegs, f)) ? homeLegs : legsDir, f), 'utf8') });
    }
    const scripts = readdirSync(legsDir).filter((x) => x.endsWith('.mjs') && (!sourceDir || !x.endsWith('.run.mjs')));
    if (sourceDir && existsSync(homeLegs)) scripts.push(...readdirSync(homeLegs).filter((x) => x.endsWith('.run.mjs')));
    for (const f of scripts.sort()) {
      const override = f.endsWith('.run.mjs');
      const name = f.slice(0, override ? -'.run.mjs'.length : -'.mjs'.length);
      const into = override ? overrides : legScripts;
      try {
        // An override runs only through a leg script that looks it up: one from before overrides does not.
        // The script must name this course's own override path: a copy of another course's reads that one's.
        const loaded = override ? (existsSync(join(legsDir, `${name}.mjs`)) && readFileSync(join(legsDir, `${name}.mjs`), 'utf8').includes(`.baton/courses/${course}/legs/${name}.run.mjs`)) : undefined;
        into.push({ name, exports: legExports(await import(pathToFileURL(join(override ? homeLegs : legsDir, f)).href)), ...(override ? { loaded } : {}) });
      } catch (e) {
        into.push({ name, exports: [], error: (e as Error).message.split('\n')[0] });
      }
    }
  }
  let live: KitInput['live'] = null;
  if (opts.board) {
    const b = asRecord(JSON.parse(readFileSync(opts.board, 'utf8')));
    const courseOf = new Map((b.tickets as unknown[] ?? []).map(asRecord).map((t) => [String(t.id), String(t.course_id ?? DEFAULT_COURSE)]));
    live = Object.entries(asRecord(b.stations)).filter(([id]) => (courseOf.get(id) ?? course) === course)
      .map(([id, st]) => ({ id, path: (asRecord(st).path as Step[] | undefined) ?? [] }));
  }
  return { course, proposed, base, proposedVersions, baseVersions, root, sourceDir, source: courseSource, legScripts, overrides, instructions, schemas, others, live };
}
