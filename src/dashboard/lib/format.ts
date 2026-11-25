// format.ts — how the shell words a time, a span and a sha (display only: the browser's clock,
// which the core never reads — R-BTN-32 is the core's rule).

/** A read's time as epoch milliseconds: a number as it stands (seconds below 1e11 are scaled),
 *  an ISO string parsed; null for anything else. */
export function toMs(t: unknown): number | null {
  if (typeof t === 'number' && Number.isFinite(t)) return t < 1e11 ? t * 1000 : t;
  if (typeof t === 'string' && t !== '') {
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/** A span in the mockup's units: `7 s`, `12 min`, `3 h`, `2 d`. */
export function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86_400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86_400)} d`;
}

/** How long ago `t` was, or how far ahead: `7 s ago`, `in 3 min`; an em dash for no time. */
export function relTime(t: unknown, now: number): string {
  const ms = toMs(t);
  if (ms === null) return '—';
  return ms <= now ? `${span(now - ms)} ago` : `in ${span(ms - now)}`;
}

/** `2026-10-16 16:56 UTC`. */
export function utc(t: unknown): string {
  const ms = toMs(t);
  return ms === null ? '—' : `${new Date(ms).toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

/** `16:56` in UTC — the freshness line's "stale since". */
export function utcClock(ms: number): string {
  return new Date(ms).toISOString().slice(11, 16);
}

/** A commit's short name: its first eight characters. */
export function shortSha(sha: unknown): string {
  return typeof sha === 'string' && sha !== '' ? sha.slice(0, 8) : '—';
}

/** `1 ticket`, `3 tickets`. */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
