// courseLayout.ts — the column layout of a course file (B-212), pure: stations in columns by
// their longest path from the course's entry station, cycles broken at back-edges, within a
// column in the file's order; every leg an edge for each pair of its `from` and `to` stations.
// Coordinates are in a unit box the drawing scales. The file is a read's opaque blob: nothing
// here trusts its shape, and no name in it means anything to this code.

export interface LayoutStation { id: string; col: number; row: number; x: number; y: number }
/** `straight`: to the next column. `skip`: forward past a column, drawn as an arc over the
 *  row. `back`: against the columns (or within one), drawn as an arc under the row. */
export type EdgeKind = 'straight' | 'skip' | 'back';
export interface LayoutEdge {
  leg: string; from: string; to: string; kind: EdgeKind;
  x1: number; y1: number; x2: number; y2: number;
  /** The label's place: the edge's midpoint, moved off the line for the n-th of parallel edges. */
  lx: number; ly: number;
  /** This edge's index among the edges from the same station to the same station, and how many
   *  there are. */
  nth: number; of: number;
}
export interface CourseLayout { stations: LayoutStation[]; edges: LayoutEdge[]; cols: number; rows: number; hasBack: boolean; hasSkip: boolean }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const names = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** The stations and legs a course file names, tolerant of anything missing. */
export function courseParts(file: unknown): { start: string | null; stations: string[]; legs: { leg: string; from: string[]; to: string[] }[] } {
  const f = isObj(file) ? file : {};
  const stations = isObj(f.stations) ? Object.keys(f.stations) : [];
  const legs = isObj(f.legs) ? Object.entries(f.legs).map(([leg, def]) => ({ leg, from: names(isObj(def) ? def.from : null), to: names(isObj(def) ? def.to : null) })) : [];
  // A station only a leg names is still a station of the drawing.
  for (const l of legs) for (const s of [...l.from, ...l.to]) if (!stations.includes(s)) stations.push(s);
  const start = typeof f.start === 'string' && stations.includes(f.start) ? f.start : stations[0] ?? null;
  return { start, stations, legs };
}

export function courseLayout(file: unknown): CourseLayout {
  const { start, stations, legs } = courseParts(file);
  const pairs = legs.flatMap((l) => l.from.flatMap((from) => l.to.map((to) => ({ leg: l.leg, from, to }))));
  const out = new Map<string, string[]>();
  for (const p of pairs) out.set(p.from, [...(out.get(p.from) ?? []), p.to]);

  // Back-edges: found by a depth-first walk from the entry station, then from every station the
  // walk has not reached, in the file's order — an edge to a station still on the walk's stack.
  const back = new Set<string>();
  const state = new Map<string, 'open' | 'done'>();
  const walk = (s: string) => {
    state.set(s, 'open');
    for (const t of out.get(s) ?? []) {
      if (state.get(t) === 'open') back.add(`${s}\u0000${t}`);
      else if (!state.has(t)) walk(t);
    }
    state.set(s, 'done');
  };
  const order = start ? [start, ...stations.filter((s) => s !== start)] : stations;
  for (const s of order) if (!state.has(s)) walk(s);

  // Columns: the longest path over the forward edges (a relaxation, bounded by the stations).
  const col = new Map(stations.map((s) => [s, 0]));
  for (let pass = 0; pass < stations.length; pass++) {
    let moved = false;
    for (const p of pairs) {
      if (back.has(`${p.from}\u0000${p.to}`)) continue;
      const want = (col.get(p.from) ?? 0) + 1;
      if (want > (col.get(p.to) ?? 0)) {
        col.set(p.to, want);
        moved = true;
      }
    }
    if (!moved) break;
  }
  const cols = Math.max(1, ...stations.map((s) => (col.get(s) ?? 0) + 1));
  const byCol = Array.from({ length: cols }, (_, c) => stations.filter((s) => (col.get(s) ?? 0) === c));
  const rows = Math.max(1, ...byCol.map((c) => c.length));
  const placed = new Map<string, LayoutStation>();
  byCol.forEach((list, c) => list.forEach((id, r) => {
    // A column shorter than the tallest is centred.
    placed.set(id, { id, col: c, row: r, x: (c + 0.5) / cols, y: (r + 0.5 + (rows - list.length) / 2) / rows });
  }));

  const between = new Map<string, number>();
  for (const p of pairs) {
    const k = `${p.from}\u0000${p.to}`;
    between.set(k, (between.get(k) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const edges = pairs.map((p): LayoutEdge => {
    const a = placed.get(p.from)!;
    const b = placed.get(p.to)!;
    const k = `${p.from}\u0000${p.to}`;
    const nth = seen.get(k) ?? 0;
    seen.set(k, nth + 1);
    const of = between.get(k) ?? 1;
    const kind: EdgeKind = b.col <= a.col ? 'back' : b.col - a.col > 1 ? 'skip' : 'straight';
    // Parallel edges fan out around the midpoint, across the line's direction.
    const spread = (nth - (of - 1) / 2) * (0.5 / rows);
    return { ...p, kind, x1: a.x, y1: a.y, x2: b.x, y2: b.y, lx: (a.x + b.x) / 2, ly: (a.y + b.y) / 2 + spread, nth, of };
  });
  return { stations: stations.map((s) => placed.get(s)!), edges, cols, rows, hasBack: edges.some((e) => e.kind === 'back'), hasSkip: edges.some((e) => e.kind === 'skip') };
}
