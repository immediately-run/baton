// timeline.ts — the runner timeline's layout (B-211), pure: a window of time mapped to a
// width, each claim a bar, each activity a segment nested under its claim by its parent chain,
// and the hour ticks. No DOM, no clock: the window's ends come from the read.

export interface TimelineActivity {
  id: string;
  parent_id?: string | null;
  started_at: number;
  ended_at?: number | null;
}

export interface TimelineClaim<A extends TimelineActivity = TimelineActivity> {
  claim_id: number;
  started_at: number;
  ended_at?: number | null;
  activities?: A[];
}

export interface Segment<A> { activity: A; x: number; width: number; depth: number }
export interface Bar<C, A> { claim: C; x: number; width: number; segments: Segment<A>[]; depth: number }
export interface Tick { x: number; at: number }
export interface TimelineLayout<C, A> { bars: Bar<C, A>[]; ticks: Tick[]; depth: number; step: number }

const HOUR = 3_600_000;
/** The tick steps tried, in hours: the first that leaves at most nine ticks. */
export const TICK_STEPS_H = [1, 2, 3, 6, 12, 24, 48];

/** `t` as an x within `width`, clamped to the window. */
export function timeToX(t: number, since: number, until: number, width: number): number {
  if (!(until > since)) return 0;
  return Math.min(width, Math.max(0, ((t - since) / (until - since)) * width));
}

/** The hour ticks of a window, on whole multiples of the step from the epoch (UTC hours). */
export function ticksOf(since: number, until: number, width: number): { ticks: Tick[]; step: number } {
  const span = until - since;
  if (!(span > 0)) return { ticks: [], step: HOUR };
  const step = (TICK_STEPS_H.find((h) => span / (h * HOUR) <= 9) ?? TICK_STEPS_H[TICK_STEPS_H.length - 1]) * HOUR;
  const ticks: Tick[] = [];
  for (let at = Math.ceil(since / step) * step; at <= until && ticks.length < 200; at += step) ticks.push({ x: timeToX(at, since, until, width), at });
  return { ticks, step };
}

/** How deep each activity sits under its claim: 0 for one with no parent among the claim's
 *  activities, its parent's depth plus one otherwise. A parent cycle ends at depth 0. */
export function depthsOf(activities: readonly TimelineActivity[]): Map<string, number> {
  const byId = new Map(activities.map((a) => [a.id, a]));
  const out = new Map<string, number>();
  const depth = (a: TimelineActivity, seen: Set<string>): number => {
    const known = out.get(a.id);
    if (known !== undefined) return known;
    const parent = a.parent_id != null ? byId.get(a.parent_id) : undefined;
    const d = !parent || seen.has(parent.id) ? 0 : depth(parent, new Set(seen).add(a.id)) + 1;
    out.set(a.id, d);
    return d;
  };
  for (const a of activities) depth(a, new Set());
  return out;
}

/** The layout: every claim that touches the window as a bar (a running one runs to `until`),
 *  its activities as segments by depth; each at least `min` wide so it can be seen and focused. */
export function timelineLayout<A extends TimelineActivity, C extends TimelineClaim<A>>(
  window: { since: number; until: number }, claims: readonly C[], width: number, min = 3,
): TimelineLayout<C, A> {
  const { since, until } = window;
  const place = (start: number, end: number | null | undefined) => {
    const x = timeToX(start, since, until, width);
    const right = timeToX(end ?? until, since, until, width);
    const w = Math.max(min, right - x);
    return { x: Math.min(x, width - w), width: w };
  };
  let deepest = 0;
  const bars = claims.filter((c) => (c.ended_at ?? until) >= since && c.started_at <= until).map((claim) => {
    const acts = claim.activities ?? [];
    const depths = depthsOf(acts);
    const segments = acts.filter((a) => (a.ended_at ?? until) >= since && a.started_at <= until)
      .map((activity) => ({ activity, ...place(activity.started_at, activity.ended_at), depth: depths.get(activity.id) ?? 0 }));
    const depth = segments.reduce((m, s) => Math.max(m, s.depth + 1), 0);
    deepest = Math.max(deepest, depth);
    return { claim, ...place(claim.started_at, claim.ended_at), segments, depth };
  });
  return { bars, ...ticksOf(since, until, width), depth: deepest };
}
