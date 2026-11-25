// reads/window.ts — the `?since=` of a read that shows a time window (B-196, B-197): 24 hours
// unless given, 7 days at most. Two forms: an ISO time not in the future (as `repo.stats`
// takes it), or a span back from now — `<n>h` or `<n>d` — which keeps a poller's URL the same
// from one poll to the next, so its `If-None-Match` can match (B-205).
import { BatonError } from '../http';

export const WINDOW_DEFAULT_MS = 24 * 3_600_000;
export const WINDOW_MAX_MS = 7 * 86_400_000;

const SPAN = /^([1-9][0-9]{0,3})(h|d)$/;

/** The instant a read's window starts, from its `since` parameter; `invalid-params` for a time
 *  that is no time, in the future, or more than 7 days back. */
export function sinceOf(raw: string | null | undefined, now: number): number {
  if (raw == null || raw === '') return now - WINDOW_DEFAULT_MS;
  const span = SPAN.exec(raw);
  const since = span ? now - Number(span[1]) * (span[2] === 'h' ? 3_600_000 : 86_400_000) : Date.parse(raw);
  if (!Number.isFinite(since) || since > now) throw new BatonError('invalid-params', 'since: an ISO time not in the future, or a span such as 24h or 7d');
  if (now - since > WINDOW_MAX_MS) throw new BatonError('invalid-params', 'since: at most 7 days back');
  return since;
}
