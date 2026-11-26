import type { BatonRefusal } from './api';

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const names = (value: unknown): string[] => list(value).filter((v): v is string => typeof v === 'string');

/** Older cores send no detail. Treat absent or unfamiliar detail as the plain refusal. */
export function idleReason(refusal: BatonRefusal): string {
  const repos = list(record(refusal.detail).repositories);
  const groups = repos.flatMap((repo) => {
    const { repository, gates } = record(repo);
    const reasons = list(gates).flatMap((entry) => {
      const { gate, count, tickets, capabilities, readings } = record(entry);
      if (typeof gate !== 'string' || typeof count !== 'number' || count <= 0 || !Number.isSafeInteger(count)) return [];
      const ids = names(tickets).slice(0, 5);
      if (count > ids.length && ids.length) ids.push('…');
      const samples = ids.join(', ');
      const reason = gate === 'attempts-exhausted' ? 'held attempts-exhausted'
        : gate === 'unconfirmed-end' ? `unconfirmed end${count === 1 ? '' : 's'}`
        : gate === 'missing-capability' ? 'missing capability (rule 4)'
        : gate === 'barred-tag' ? 'barred tag (rule 8)'
        : gate === 'stale-skills' ? 'course declaration not current'
        : gate;
      const writers = list(readings).slice(0, 5).flatMap((entry) => {
        const { resource, instance, writer, until } = record(entry);
        if (typeof instance !== 'string' || typeof writer !== 'string' || typeof resource !== 'string') return [];
        const at = typeof until === 'number' ? new Date(until) : null;
        return [`${resource}/${instance} unavailable, by ${writer}${at && Number.isFinite(at.valueOf()) ? ` until ${at.toISOString()}` : ''}`];
      });
      const detail = [gate === 'attempts-exhausted' ? `baton:retries open${samples ? `: ${samples}` : ''}` : samples,
        names(capabilities).join(', '), ...writers].filter(Boolean).join('; ');
      return [`${count} ${reason}${detail ? ` (${detail})` : ''}`];
    });
    return reasons.length ? [`${repos.length > 1 && typeof repository === 'string' ? `${repository}: ` : ''}${reasons.join(', ')}`] : [];
  });
  return groups.length ? `no ready ticket fits this worker: ${groups.join(' · ')}` : refusal.message;
}
