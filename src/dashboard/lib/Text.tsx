// Text.tsx — the one way a string from a read reaches the DOM besides `View` (B-206, §12.3):
// string coercion, then a React text child. Nothing here parses, links or styles the value.

/** A read's value as the text the page draws: a string as itself, null and undefined as an em
 *  dash, a number or boolean by `String`, anything else as compact JSON. */
export function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** One value as a text child. `mono` draws it in the monospace face ids and shas use. */
export function Text({ value, mono, className }: { value: unknown; mono?: boolean; className?: string }) {
  const cls = [mono ? 'mono' : '', className ?? ''].filter(Boolean).join(' ');
  return cls ? <span className={cls}>{textOf(value)}</span> : <>{textOf(value)}</>;
}
