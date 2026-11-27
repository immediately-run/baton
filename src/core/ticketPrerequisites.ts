import { logEvent } from './db';
import { atLeastAsVisible, hasConsent, type Sql } from './dependencies';
import type { Store } from './ports';
import type { PostedDependency, TicketRequirement, TicketSelector } from './ticketRequirement';
import { qualify, repositoryOf, TICKET_ID } from './validate';

type Entry = { selector: string; leg: string; on_ticket: string; predicate: TicketRequirement; course?: string; skip_withdrawn?: boolean; allow_empty?: boolean };
type Edge = { selector: string; ticket_id: string; on_ticket: string; leg: string; ref: string; predicate: string; target_course: string | null; skip_withdrawn: number; allow_empty: number; why: string | null; station: string | null; cycle: number };
type Target = { station: string | null; path: string | null; course_id: string | null; closed_as: string | null };

function suffix(r: TicketRequirement): string {
  if ('at' in r) return `at:${[...new Set(r.at)].sort().join(',')}`;
  if ('reached' in r) return `reached:${[...new Set(r.reached)].sort().join(',')}`;
  return 'done' in r ? 'done' : 'withdrawn' in r ? 'withdrawn' : 'closed';
}

function answer(edge: Edge, target: Target | undefined): string | null {
  const empty = edge.allow_empty ? null : 'empty-selection';
  if (!edge.on_ticket) return edge.ref.startsWith('parent@') ? 'no-parent' : empty;
  if (!target) return 'unknown-ticket';
  if (edge.target_course && target.course_id !== edge.target_course) return empty;
  const r = JSON.parse(edge.predicate) as TicketRequirement;
  if (target.closed_as === 'withdrawn') {
    return 'closed' in r || 'withdrawn' in r ? null : 'withdrawn';
  }
  if ('at' in r) return target.station && r.at.includes(target.station) ? null : 'not-at';
  if ('reached' in r) {
    const path = JSON.parse(target.path ?? '[]') as { reached: string }[];
    return path.some((s) => r.reached.includes(s.reached)) ? null : 'not-reached';
  }
  if ('done' in r) return target.closed_as === 'done' ? null : 'not-done';
  if ('withdrawn' in r) return 'not-withdrawn';
  return target.closed_as ? null : 'not-closed';
}

/** An edge is cyclic iff both endpoints are in the same strongly connected component. */
function cyclicComponents(edges: Edge[]): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  const reverse = new Map<string, string[]>();
  for (const { ticket_id: from, on_ticket: to } of edges) {
    if (!graph.has(from)) graph.set(from, []);
    if (!reverse.has(to)) reverse.set(to, []);
    graph.get(from)!.push(to);
    reverse.get(to)!.push(from);
  }
  const seen = new Set<string>();
  const finished: string[] = [];
  for (const root of graph.keys()) {
    const stack: [string, boolean][] = [[root, false]];
    while (stack.length) {
      const [id, exit] = stack.pop()!;
      if (exit) finished.push(id);
      else if (!seen.has(id)) {
        seen.add(id);
        stack.push([id, true]);
        for (const to of graph.get(id) ?? []) stack.push([to, false]);
      }
    }
  }
  seen.clear();
  const result = new Map<string, string[]>();
  for (const root of finished.reverse()) {
    const component: string[] = [];
    const stack = [root];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      component.push(id);
      for (const to of reverse.get(id) ?? []) stack.push(to);
    }
    if (component.length > 1 || graph.get(root)?.includes(root)) {
      component.sort();
      for (const id of component) result.set(id, component);
    }
  }
  return result;
}

export class TicketPrerequisites {
  constructor(private readonly store: Store, private readonly now: () => number) {}

  private rows: Sql = <T>(q: string, ...p: unknown[]) => this.store.exec<T>(q, ...p).toArray();

  forget(id: string) {
    this.store.exec('DELETE FROM ticket_dependents WHERE ticket_id = ?', id);
  }

  /** Refresh the indexed edges from accepted ticket and course fields. */
  // @model syncPost sha256:de22f143bc15
  posted(repo: string): string[] {
    const files = new Map(this.rows<{ id: string; course_json: string }>('SELECT id, course_json FROM courses WHERE repository_id = ?', repo)
      .map((c) => [c.id, (JSON.parse(c.course_json) as { legs: Record<string, { requires?: { tickets?: TicketSelector[] } }> }).legs]));
    const touched: string[] = [];
    for (const t of this.rows<{ id: string; course_id: string; parent: string | null; depends_at: string }>(
      `SELECT t.id, t.course_id, t.parent, t.depends_at FROM tickets t JOIN courses c ON c.repository_id = t.repository_id AND c.id = t.course_id
       WHERE t.repository_id = ? AND (t.depends_at <> '[]' OR instr(c.course_json, '"tickets"') > 0
         OR EXISTS (SELECT 1 FROM ticket_dependents d WHERE d.ticket_id = t.id))`, repo)) {
      const deps = JSON.parse(t.depends_at) as PostedDependency[];
      const id = (raw: string) => TICKET_ID.test(raw) ? raw : qualify(repo, raw);
      const legs = files.get(t.course_id) ?? {};
      const entries: Entry[] = deps.map((d) => ({ selector: '', leg: d.leg ?? '', on_ticket: id(d.ticket), predicate: d }));
      for (const [leg, def] of Object.entries(legs)) for (const [index, s] of (def.requires?.tickets ?? []).entries()) {
        const selector = `${s.select}:${index}`;
        if (s.select === 'parent') entries.push({ ...s, selector, leg, on_ticket: t.parent ?? '', predicate: s, course: s.course ?? t.course_id });
        else {
          const selected = deps.filter((d) => !d.leg || d.leg === leg);
          if (!selected.length) entries.push({ ...s, selector, leg, on_ticket: '', predicate: s });
          else for (const d of selected) entries.push({ ...s, selector, leg, on_ticket: id(d.ticket), predicate: s });
        }
      }
      const want = new Map(entries.map((e) => {
        const ref = `${e.on_ticket || (e.course ? 'parent' : 'posted')}@${suffix(e.predicate)}`;
        return [`${e.leg}\0${ref}\0${e.selector}`, { ...e, ref }];
      }));
      let changed = false;
      for (const row of this.rows<Edge>('SELECT * FROM ticket_dependents WHERE ticket_id = ?', t.id)) {
        const key = `${row.leg}\0${row.ref}\0${row.selector}`;
        const entry = want.get(key);
        if (entry && row.target_course === (entry.course ?? null) && row.skip_withdrawn === Number(!!entry.skip_withdrawn)
          && row.allow_empty === Number(!!entry.allow_empty)) want.delete(key);
        else {
          this.store.exec('DELETE FROM ticket_dependents WHERE ticket_id = ? AND leg = ? AND ref = ? AND selector = ?', t.id, row.leg, row.ref, row.selector);
          changed = true;
        }
      }
      for (const e of want.values()) {
        this.store.exec(`INSERT INTO ticket_dependents (ticket_id, leg, ref, on_ticket, predicate, target_course, skip_withdrawn, allow_empty, selector)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, t.id, e.leg, e.ref, e.on_ticket, JSON.stringify(e.predicate), e.course ?? null, Number(!!e.skip_withdrawn), Number(!!e.allow_empty), e.selector);
      }
      if (changed || want.size) touched.push(t.id);
    }
    return this.refresh(touched);
  }

  /** A snapshot may add/remove both ends of an edge. A local station write needs only its reverse edges. */
  refresh(owners: string[], targetId?: string): string[] {
    const touched = new Set(owners);
    const edges = targetId ? this.rows<Edge>(`SELECT * FROM ticket_dependents WHERE ticket_id IN
      (SELECT ticket_id FROM ticket_dependents WHERE on_ticket = ?)`, targetId) : this.rows<Edge>('SELECT * FROM ticket_dependents');
    if (!edges.length) return owners;
    const targets = new Map<string, Target | undefined>();
    const read = (id: string): Target | undefined => {
      if (!targets.has(id)) targets.set(id, this.rows<Target>(
        `SELECT final_station AS station, final_path AS path, course_id, closed_as FROM closed_tickets WHERE ticket_id = ?
         UNION ALL SELECT s.station, s.path, t.course_id, NULL FROM tickets t LEFT JOIN ticket_stations s ON s.ticket_id = t.id WHERE t.id = ? LIMIT 1`, id, id)[0]);
      return targets.get(id);
    };
    const permissions = new Map<string, boolean>();
    const selection = edges.map((e) => {
      const repo = repositoryOf(e.ticket_id);
      const other = e.on_ticket ? repositoryOf(e.on_ticket) : repo;
      const key = `${repo}\0${other}`;
      if (!permissions.has(key)) permissions.set(key, repo === other || (
        this.rows('SELECT 1 FROM repositories WHERE id = ? AND retired_at IS NULL', other).length > 0
        && (atLeastAsVisible(this.rows, other, repo) || hasConsent(this.rows, other, repo))));
      const target = e.on_ticket && permissions.get(key) ? read(e.on_ticket) : undefined;
      const skipped = !!(e.skip_withdrawn && target?.closed_as === 'withdrawn' && (!e.target_course || target.course_id === e.target_course));
      return { e, target, skipped, selected: !!target && !skipped && (!e.target_course || e.target_course === target.course_id) };
    });
    const group = (e: Edge) => `${e.ticket_id}\0${e.leg}\0${e.selector}`;
    const remaining = new Set(selection.filter(({ e, skipped }) => e.on_ticket && !skipped).map(({ e }) => group(e)));
    const components = targetId ? new Map<string, string[]>() : cyclicComponents(selection.filter((r) => r.selected).map((r) => r.e));
    const newCycles = new Set<string[]>();
    const emptyReported = new Set<string>();
    for (const { e, target, skipped, selected } of selection) {
      const component = selected ? components.get(e.ticket_id) : undefined;
      const cycle = targetId ? e.cycle : Number(component != null && component === components.get(e.on_ticket));
      if (cycle && !e.cycle && component) newCycles.add(component);
      const key = group(e);
      let why = cycle ? 'prerequisite-cycle' : skipped ? null : answer(e, target);
      if (skipped && !e.allow_empty && !remaining.has(key) && !emptyReported.has(key)) {
        why = 'empty-selection';
        emptyReported.add(key);
      }
      const station = selected ? target?.station ?? null : null;
      if (e.why === why && e.station === station && e.cycle === cycle) continue;
      this.store.exec('UPDATE ticket_dependents SET why = ?, station = ?, cycle = ? WHERE ticket_id = ? AND leg = ? AND ref = ? AND selector = ?', why, station, cycle, e.ticket_id, e.leg, e.ref, e.selector);
      touched.add(e.ticket_id);
      if (why === 'no-parent' || why === 'unknown-ticket' || why === 'withdrawn' || why === 'empty-selection') {
        if (why !== e.why) logEvent(this.store, this.now(), 'discrepancy', 'baton', { type: 'baton.prerequisite-unmet', ref: e.ref, leg: e.leg, why }, e.ticket_id);
      }
    }
    for (const tickets of newCycles) {
      logEvent(this.store, this.now(), 'discrepancy', 'baton', { type: 'baton.prerequisite-cycle', tickets }, tickets[0]);
    }
    return [...touched];
  }
}
