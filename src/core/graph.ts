// graph.ts — a course file read as a graph (BATON_SPEC §2e R-BTN-63/-64/-70/-71): the edge a leg
// follows, the runs a ticket has made of a leg, whether one path extends another by edges, the
// legs from a station to an end, and the names a renaming file still resolves. Pure, and only
// ever given a file `validateCourse` accepted (courses.ts stores no other), so it trusts the
// shape. To core a station and a leg are names: nothing here reads what one means.

import { capabilitiesOf } from '../shared/vocabulary.mjs';

/** One step of a ticket's path: the leg run and the station it reached (R-BTN-70). */
export interface Step {
  leg: string;
  reached: string;
}

export interface Leg {
  from: string[];
  to: string[];
  maxRuns: number | null;
  /** R-BTN-79: the queue depth above which the leg raises `queue-over`; null for unbounded. */
  maxQueue: number | null;
  /** R-BTN-106: the legs a key that ran any of them on the ticket may not take this one. */
  noChainFrom: string[];
  /** R-BTN-107: the isolation a worker must declare to take it, or null for any. */
  isolation: 'session' | null;
  /** R-BTN-120, R-BTN-121: the capabilities the leg requires of whoever takes it — rule 4's own
   *  input beside the ticket's clause (B-86); empty when it requires none. Read as
   *  `legCapabilities` reads them: the course's `capability_roles` named here are replaced by
   *  their capabilities and a vocabulary role by its four, so no role name is left (§12.5) —
   *  except `human-operator`, which is no role and stands literal (R-BTN-121). */
  requires: string[];
}

export interface Graph {
  start: string;
  startLeg: string;
  ends: Set<string>;
  shortWaits: string[];
  stations: Set<string>;
  legs: Map<string, Leg>;
  /** An old leg or station name → the current one (`renamed_from`, R-BTN-64). */
  legRenames: Map<string, string>;
  stationRenames: Map<string, string>;
  /** R-BTN-109: what a leg arriving at each station must have produced, by output and schema. */
  entry: Map<string, { output: string; schema: string }[]>;
  /** Legs on the shortest route from each station to an end (`to_end`, §2e). */
  toEnd: Map<string, number>;
}

const names = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? (v as string[]) : []);

/**
 * R-BTN-120, R-BTN-121: a leg's `requires.capabilities` as the capabilities rule 4 compares —
 * one normalization, used by `graphOf` and by the runner's own reading of the course file, so
 * every reader of a leg's needs sees the same list. Each name is replaced by the course's
 * `capability_roles` entry when it has one (a role expands once; roles do not nest), then by
 * the vocabulary's `capabilitiesOf` — a vocabulary role (`agent-venue`) becomes the capabilities
 * it carries. What is left is capabilities only, never a role name (§12.5). Names that are
 * neither are taken as themselves (a namespaced capability such as `vpn:corp`).
 *
 * `human-operator` is the one name that is never expanded (review round 6, finding 0): R-BTN-121
 * makes it a built-in bare capability "compared as a string", and the ticket side keeps it so —
 * `board.ts` sets `operator_only` for a clause naming it and rule 6 compares the literal. The
 * vocabulary happens to give it the agent venue's four, so expanding it here let any autonomous
 * `agent-venue` worker take a leg the course reserved for a person. It stands literal, and rule 4
 * and the candidate query check that literal the way rule 6 does.
 */
export function legCapabilities(requires: unknown, capabilityRoles: unknown): string[] {
  const listed = (requires as { capabilities?: unknown } | null | undefined)?.capabilities;
  if (!Array.isArray(listed)) return [];
  const roles = typeof capabilityRoles === 'object' && capabilityRoles !== null && !Array.isArray(capabilityRoles)
    ? (capabilityRoles as Record<string, unknown>) : {};
  const out = new Set<string>();
  for (const name of listed) {
    if (typeof name !== 'string') continue;
    const own = Object.hasOwn(roles, name) ? roles[name] : null;
    for (const c of name === 'human-operator' ? [name] : capabilitiesOf(Array.isArray(own) ? (own as string[]) : [name])) out.add(c);
  }
  return [...out];
}

/** The graph of a validated course file. */
export function graphOf(json: unknown): Graph {
  const f = json as {
    start: string; start_leg: string; end: string[]; short_waits?: string[];
    capability_roles?: Record<string, string[]>;
    stations: Record<string, { renamed_from?: string | string[]; entry?: { output: string; schema: string }[] }>;
    legs: Record<string, { from: string[]; to: string | string[]; max_runs?: number; max_queue?: number; renamed_from?: string | string[]; no_chain_from?: string[]; isolation?: 'session'; requires?: { capabilities?: string[] } }>;
  };
  const legs = new Map<string, Leg>();
  const legRenames = new Map<string, string>();
  const stationRenames = new Map<string, string>();
  for (const [id, l] of Object.entries(f.legs)) {
    legs.set(id, { from: [...new Set(l.from)], to: [...new Set(names(l.to))], maxRuns: l.max_runs ?? null, maxQueue: l.max_queue ?? null,
      noChainFrom: [...new Set(l.no_chain_from ?? [])], isolation: l.isolation ?? null, requires: legCapabilities(l.requires, f.capability_roles) });
    for (const old of names(l.renamed_from)) legRenames.set(old, id);
  }
  const entry = new Map<string, { output: string; schema: string }[]>();
  for (const [id, s] of Object.entries(f.stations)) {
    for (const old of names(s.renamed_from)) stationRenames.set(old, id);
    if (s.entry?.length) entry.set(id, s.entry.map((r) => ({ output: r.output, schema: r.schema })));
  }
  const stations = new Set(Object.keys(f.stations));
  const ends = new Set(f.end);
  // Breadth-first from the ends, backwards along every leg's every outcome.
  const toEnd = new Map<string, number>([...ends].map((e) => [e, 0]));
  let frontier = [...ends];
  while (frontier.length) {
    const next: string[] = [];
    for (const s of frontier) {
      for (const l of legs.values()) {
        if (!l.to.includes(s)) continue;
        for (const from of l.from) {
          if (toEnd.has(from)) continue;
          toEnd.set(from, toEnd.get(s)! + 1);
          next.push(from);
        }
      }
    }
    frontier = next;
  }
  return { start: f.start, startLeg: f.start_leg, ends, shortWaits: f.short_waits ?? [], stations, legs, legRenames, stationRenames, toEnd, entry };
}

/**
 * R-BTN-120, R-BTN-121, §12.5: every leg's needs as `graphOf` reads them, by leg id — the view the
 * registry derives beside the course file it stores (`courses.ts` writes it to `leg_capabilities_json`)
 * so the candidate query (`claims.ts`, SQL that cannot expand a role) compares the same
 * capabilities rule 4 does. The course file itself is stored as posted: this is never the file.
 */
export function legNeedsOf(json: unknown): Record<string, string[]> {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return {};
  const f = json as { legs?: unknown; capability_roles?: unknown };
  if (typeof f.legs !== 'object' || f.legs === null || Array.isArray(f.legs)) return {};
  const out: Record<string, string[]> = {};
  for (const [id, l] of Object.entries(f.legs as Record<string, unknown>)) {
    out[id] = legCapabilities(typeof l === 'object' && l !== null ? (l as { requires?: unknown }).requires : undefined, f.capability_roles);
  }
  return out;
}

/**
 * §5.6, §12.5, R-BTN-121: every leg's `requires.capabilities` replaced by its expansion, by leg
 * id, with `capability_roles` left out — the course file as a reader compares it once no role name
 * is in it. A view of the file, never the file the registry stores (review round 6, finding 2: the
 * `courses` row holds the file as posted, §12's table); `legNeedsOf` is what the candidate query
 * reads, and this keeps the same shape for a reader that wants one file.
 */
export function expandedCourse(json: unknown): unknown {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return json;
  const f = json as { legs?: unknown; capability_roles?: unknown };
  if (typeof f.legs !== 'object' || f.legs === null || Array.isArray(f.legs)) return json;
  const out = { ...(json as Record<string, unknown>) };
  delete out.capability_roles;
  const legs: Record<string, unknown> = {};
  for (const [id, l] of Object.entries(f.legs as Record<string, unknown>)) {
    if (typeof l !== 'object' || l === null || Array.isArray(l) || !('requires' in l)) { legs[id] = l; continue; }
    const req = (l as { requires?: unknown }).requires;
    const kept = typeof req === 'object' && req !== null && !Array.isArray(req) ? { ...(req as Record<string, unknown>) } : req;
    if (typeof kept === 'object' && kept !== null && !Array.isArray(kept)) {
      (kept as Record<string, unknown>).capabilities = legCapabilities(req, f.capability_roles);
    }
    legs[id] = { ...(l as Record<string, unknown>), requires: kept };
  }
  out.legs = legs;
  return out;
}

/** A leg's current name: itself, or the leg whose `renamed_from` names it; null when neither. */
export function resolveLeg(g: Graph, name: string): string | null {
  return g.legs.has(name) ? name : g.legRenames.get(name) ?? null;
}

/** A station's current name, as `resolveLeg`. */
export function resolveStation(g: Graph, name: string): string | null {
  return g.stations.has(name) ? name : g.stationRenames.get(name) ?? null;
}

/** A path under current names; a step naming a leg or station the file no longer has keeps its
 *  name, so it matches nothing and extends nothing. */
export function resolvePath(g: Graph, path: Step[]): Step[] {
  return path.map((s) => ({ leg: resolveLeg(g, s.leg) ?? s.leg, reached: resolveStation(g, s.reached) ?? s.reached }));
}

/** Whether `leg` leaves `station` (an edge of the file, R-BTN-63). */
export function leaves(g: Graph, leg: string, station: string): boolean {
  return g.legs.get(leg)?.from.includes(station) ?? false;
}

/** Whether `step` follows from `station`: its leg leaves it and it reached one of its outcomes. */
function follows(g: Graph, station: string, step: Step): boolean {
  const l = g.legs.get(step.leg);
  return !!l && l.from.includes(station) && l.to.includes(step.reached);
}

const sameStep = (a: Step, b: Step) => a.leg === b.leg && a.reached === b.reached;

/**
 * R-BTN-71 and §2e's off-graph rule: whether `path` begins with `base` and continues, if at all,
 * by edges of the file in order from `base`'s last station (`from` when `base` is empty). Both
 * are read under current names. Equal paths extend.
 */
export function extendsPath(g: Graph, base: Step[], path: Step[], from: string): boolean {
  const b = resolvePath(g, base);
  const p = resolvePath(g, path);
  if (p.length < b.length || !b.every((s, i) => sameStep(s, p[i]))) return false;
  let at = b.length ? b[b.length - 1].reached : resolveStation(g, from) ?? from;
  for (const step of p.slice(b.length)) {
    if (!follows(g, at, step)) return false;
    at = step.reached;
  }
  return true;
}

/** Whether a whole path, from the course's start, follows the file's edges. */
export function onGraph(g: Graph, path: Step[]): boolean {
  return extendsPath(g, [], path, g.start);
}

/** How often `leg` was run in `legs` (names, any of them old), counted under current names
 *  (R-BTN-63, R-BTN-64). */
export function runsOf(g: Graph, leg: string, legs: string[]): number {
  return legs.filter((l) => (resolveLeg(g, l) ?? l) === leg).length;
}
