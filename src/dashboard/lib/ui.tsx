// ui.tsx — the shared pieces every screen draws with, in the mockup's language: calm, dense,
// status by shape and label before colour, real tables for tabular data, a heading per section.
// Presentation only: none of these fetches, and every value they are handed is drawn as a text
// child (§12.3). Their words are Baton's own and name no station, leg, tag or course.
import { createContext, useContext, useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { ApiError } from './api';
import { relTime, toMs, utc } from './format';

// ── the page ─────────────────────────────────────────────────────────────────────────────

/** A screen's heading: one `h1`, a line under it, and — at the right — its controls. */
export function PageHeader({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        <h1>{title}</h1>
        {sub ? <p className="page-sub">{sub}</p> : null}
      </div>
      {children ? <div className="page-actions">{children}</div> : null}
    </header>
  );
}

/** A titled section: an `h2`, its count and a one-line hint, then the content. */
export function Section({ title, count, hint, tone, children }: { title: ReactNode; count?: ReactNode; hint?: ReactNode; tone?: Tone; children: ReactNode }) {
  const id = useId();
  return (
    <section className="section" aria-labelledby={id}>
      <div className="section-head">
        <h2 id={id}>{title}</h2>
        {count !== undefined && count !== null ? <span className={`count tone-${tone ?? 'mut'}`}>{count}</span> : null}
        {hint ? <span className="hint">{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

// ── state, by shape and label ────────────────────────────────────────────────────────────

export type Tone = 'ok' | 'run' | 'warn' | 'bad' | 'mut';

/** Each tone's shape: the state reads without its colour. */
export const GLYPH: Record<Tone, string> = { ok: '●', run: '◆', warn: '▲', bad: '■', mut: '○' };

/** A state as a shape and a word; colour comes second. The label is the read's word, as text. */
export function StatusMark({ tone = 'mut', label, glyph, title }: { tone?: Tone; label: ReactNode; glyph?: string; title?: string }) {
  return (
    <span className={`status tone-${tone}`} title={title}>
      <span className="status-glyph" aria-hidden="true">{glyph ?? GLYPH[tone]}</span>
      <span className="status-label">{label}</span>
    </span>
  );
}

/** A small dashed mark for a mode or a kind — the mockup's `SHADOW`. */
export function Badge({ children, tone = 'mut', title }: { children: ReactNode; tone?: Tone; title?: string }) {
  return <span className={`badge tone-${tone}`} title={title}>{children}</span>;
}

/** An id, a sha, a command: the monospace face. */
export function Mono({ children }: { children: ReactNode }) {
  return <span className="mono">{children}</span>;
}

/** The one CLI line that does what the page does not, as text to copy. */
export function CliLine({ children }: { children: ReactNode }) {
  return <code className="cli">{children}</code>;
}

// ── containers ───────────────────────────────────────────────────────────────────────────

/** A notice across the column: `warn` for what needs a person, `mut` for a plain note. */
export function Band({ tone = 'mut', children }: { tone?: Tone; children: ReactNode }) {
  return <div className={`band band-${tone}`}>{children}</div>;
}

/** A bordered panel. With `title`, an `h3` heads it. */
export function Card({ title, aside, children, className }: { title?: ReactNode; aside?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <article className={`card${className ? ` ${className}` : ''}`}>
      {title || aside ? (
        <div className="card-head">
          {title ? <h3>{title}</h3> : null}
          {aside ? <div className="card-aside">{aside}</div> : null}
        </div>
      ) : null}
      {children}
    </article>
  );
}

/** Cards side by side, stacking at phone width. */
export function Cards({ children }: { children: ReactNode }) {
  return <div className="cards">{children}</div>;
}

/** Label and value pairs as a definition list. */
export function KeyValues({ rows }: { rows: readonly (readonly [label: ReactNode, value: ReactNode])[] }) {
  return (
    <dl className="kv">
      {rows.map(([label, value], i) => (
        <div className="kv-row" key={i}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ── tables ───────────────────────────────────────────────────────────────────────────────

export interface Column<R> {
  /** The column's heading. */
  head: ReactNode;
  /** One row's cell. Return text or elements; a read's string goes through `Text`. */
  cell: (row: R, index: number) => ReactNode;
  align?: 'left' | 'right';
  /** A CSS width (`120px`, `20%`), where the column should not flex. */
  width?: string;
  /** Draw the cell as the row's header (`th scope="row"`): the id column. */
  rowHeader?: boolean;
}

/** A real table (the brief: real tables for tabular data), scrolling sideways inside itself at
 *  phone width. `label` names it for a screen reader; `empty` is drawn when there is no row. */
export function Table<R>({ label, columns, rows, rowKey, empty }: { label: string; columns: readonly Column<R>[]; rows: readonly R[]; rowKey: (row: R, index: number) => string | number; empty?: ReactNode }) {
  if (rows.length === 0 && empty !== undefined) return <Empty>{empty}</Empty>;
  return (
    <div className="table-wrap">
      <table className="table" aria-label={label}>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i} scope="col" className={c.align === 'right' ? 'right' : undefined} style={c.width ? { width: c.width } : undefined}>{c.head}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={rowKey(row, r)}>
              {columns.map((c, i) => c.rowHeader
                ? <th key={i} scope="row" className={c.align === 'right' ? 'right' : undefined}>{c.cell(row, r)}</th>
                : <td key={i} className={c.align === 'right' ? 'right' : undefined}>{c.cell(row, r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── tabs, filter, pager ──────────────────────────────────────────────────────────────────

export interface Tab {
  id: string;
  label: ReactNode;
  count?: ReactNode;
  tone?: Tone;
}

/** A row of tabs that filter one list (the mockup's ticket states). Arrow keys move between
 *  them; the selected one is the only tab stop. */
export function Tabs({ label, tabs, value, onChange }: { label: string; tabs: readonly Tab[]; value: string; onChange: (id: string) => void }) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0 || tabs.length === 0) return;
    e.preventDefault();
    const at = Math.max(0, tabs.findIndex((t) => t.id === value));
    const next = tabs[(at + step + tabs.length) % tabs.length];
    onChange(next.id);
    const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons[(at + step + tabs.length) % tabs.length]?.focus();
  };
  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={t.id === value} tabIndex={t.id === value ? 0 : -1} className="tab" onClick={() => onChange(t.id)}>
          {t.label}
          {t.count !== undefined && t.count !== null ? <span className={`count tone-${t.tone ?? 'mut'}`}>{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** A search box that filters what the screen already holds. */
export function FilterInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input className="input filter" type="search" aria-label={label} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />;
}

/** A list read's position: the cursor to send as the read's `after` (null on the first page),
 *  and the steps a `Pager` takes. */
export interface PagerState {
  after: string | null;
  page: number;
  next: (cursor: string) => void;
  previous: () => void;
  first: () => void;
}

/** Cursor paging for a read that answers `next_cursor` (B-205): keeps the cursors it walked, so
 *  Previous works without the server knowing. Put `pager.after` in the read's query. */
export function usePager(): PagerState {
  const [trail, setTrail] = useState<string[]>([]);
  return {
    after: trail.length ? trail[trail.length - 1] : null,
    page: trail.length + 1,
    next: (cursor) => setTrail((t) => [...t, cursor]),
    previous: () => setTrail((t) => t.slice(0, -1)),
    first: () => setTrail([]),
  };
}

/** First · Previous · page n · Next, for a `usePager`; `next` is the read's `next_cursor`
 *  (null or absent on the last page). Draws nothing for a list that fits one page. */
export function Pager({ pager, next }: { pager: PagerState; next: string | null | undefined }) {
  const more = typeof next === 'string' && next !== '';
  if (pager.page === 1 && !more) return null;
  return (
    <nav className="pager" aria-label="Pages of this list">
      <button type="button" className="btn" disabled={pager.page === 1} onClick={pager.first}>First</button>
      <button type="button" className="btn" disabled={pager.page === 1} onClick={pager.previous}>Previous</button>
      <span className="pager-at">page {pager.page}</span>
      <button type="button" className="btn" disabled={!more} onClick={() => more && pager.next(next)}>Next</button>
    </nav>
  );
}

// ── nothing, not yet, and a refusal ──────────────────────────────────────────────────────

/** What a list says when it holds nothing: one plain sentence. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

/** A read that has not answered yet. */
export function Loading({ what }: { what?: ReactNode }) {
  return <p className="loading" role="status">Loading{what ? <> {what}</> : null}…</p>;
}

/** A refusal as its code and message, as text (§14's error codes). */
export function ErrorNote({ error, what }: { error: ApiError | { code: string; message: string }; what?: ReactNode }) {
  return (
    <p className="error-note" role="alert">
      {what ? <>{what}: </> : null}
      <span className="mono">{error.code}</span> — {error.message}
    </p>
  );
}

/** What a screen says of a part whose foundation is not built: the plain fact and the ticket
 *  that builds it. No placeholder number, no mock row. */
export function NotBuiltNote({ what, ticket }: { what: ReactNode; ticket: string }) {
  return <p className="empty">{what} is not built yet (<span className="mono">{ticket}</span>).</p>;
}

// ── time ─────────────────────────────────────────────────────────────────────────────────

const ClockContext = createContext<number | null>(null);

/** The shell's shared clock for relative times: one tick for the whole page. */
export function ClockProvider({ now, children }: { now: number; children: ReactNode }) {
  return <ClockContext.Provider value={now}>{children}</ClockContext.Provider>;
}

/** The browser's time as the shell last ticked it (display only). */
export function useClock(): number {
  return useContext(ClockContext) ?? Date.now();
}

/** A time from a read (epoch milliseconds or seconds, or ISO text) as "7 s ago", its UTC
 *  timestamp in the title; an em dash for none. */
export function RelTime({ at }: { at: unknown }) {
  const now = useClock();
  const ms = toMs(at);
  if (ms === null) return <span className="mut">—</span>;
  return <time dateTime={new Date(ms).toISOString()} title={utc(ms)}>{relTime(ms, now)}</time>;
}

/** A time from a read as `2026-10-16 16:56 UTC`. */
export function UtcTime({ at }: { at: unknown }) {
  const ms = toMs(at);
  if (ms === null) return <span className="mut">—</span>;
  return <time className="mono" dateTime={new Date(ms).toISOString()}>{utc(ms)}</time>;
}
