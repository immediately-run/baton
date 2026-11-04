// view.mjs — Baton's three renderers for a schema's `x-baton-view` (BATON_SPEC §5.5 R-BTN-112;
// B-54). A view is declarative — a course never ships rendering code — and every value it draws is
// untrusted text (§12.3): `plain` renders it as text (the CLI, a forge-check summary, a handler
// course's text), `html` escapes every value (a handler course's mail: inline styles only, no
// script, image or remote resource) and `ui` hands the dashboard a tree of nodes it mounts with
// `createElement` and `textContent` only. Plain's medium is a terminal, so it draws every control
// and bidi character inert: no OSC escape or forged line survives into it. A `link` field is a
// link only under R-BTN-92's link rule for the ticket's repositories (`ctx.webBases`) or with its
// host on the instance's `link_hosts` (R-BTN-157: `https`, no userinfo; an administrator's
// setting, default empty) — else text (S-BTN-76, G-BTN-100).
//
// The fallback is the value's own schema's view, else the nearest up its `x-baton-base` chain,
// else a generic rendering of keys and values two levels deep, truncated. Core's events render by
// core's own templates (`renderEvent`), each with one slot for the course's view of the relevant
// value.

import { baseChain } from './schema.mjs';
import { cleanUrl, underWebBase } from './links.mjs';

/** §10.4's free-text bound: every value a renderer draws is truncated to it, hostile or not. */
export const VIEW_TEXT_MAX = 500;
/** R-BTN-112: a table shows at most 50 rows; past that a marker names the rest. */
export const VIEW_TABLE_ROWS = 50;
/** R-BTN-112: a view has at most 24 fields; the generic rendering keeps the same bound. */
const VIEW_FIELDS_MAX = 24;
/** R-BTN-112's `tones` values, the tones a status may take. */
const TONES = new Set(['ok', 'warn', 'bad', 'info']);

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

const clip = (s) => ([...s].length > VIEW_TEXT_MAX ? `${[...s].slice(0, VIEW_TEXT_MAX).join('')}…` : s);

/** A value as text: a string as it is, anything else its JSON — never interpreted further. */
function textOf(v) {
  if (typeof v === 'string') return v;
  if (v === undefined) return '';
  try { return JSON.stringify(v) ?? 'null'; } catch { return String(v); }
}

// ── JSON Pointer (RFC 6901), the only thing a template interprets ───────────────────────────

/** A pointer is `/`-prefixed tokens of anything but a bare `~` (`~0` is `~`, `~1` `/`); RFC 6901's
 *  empty tokens are tokens too (`/a//b` has `a`, ``, `b`; `/` is the empty-string key). */
const POINTER = /^(?:\/(?:[^/~]|~[01])*)*$/;

/** The value at `pointer`, or `{ok: false}` when it does not resolve. */
function atPointer(value, pointer) {
  if (pointer === '') return { ok: true, value };
  let cur = value;
  for (const raw of pointer.split('/').slice(1)) {
    const token = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(cur)) {
      if (!/^(0|[1-9][0-9]*)$/.test(token) || Number(token) >= cur.length) return { ok: false };
      cur = cur[Number(token)];
    } else if (isObj(cur) && own(cur, token)) {
      cur = cur[token];
    } else {
      return { ok: false };
    }
  }
  return { ok: true, value: cur };
}

/** A `title`/`summary` template (R-BTN-112): each `{<JSON Pointer>}` span whose pointer resolves
 *  is replaced by the value at it as text; nothing else is interpreted, so a span that is not a
 *  resolving pointer — `{javascript:alert(1)}`, a stray `{` — stays as written. */
function template(text, value) {
  return text.replace(/\{([^{}]*)\}/g, (whole, inner) => {
    if (!POINTER.test(inner)) return whole;
    const at = atPointer(value, inner);
    return at.ok ? clip(textOf(at.value)) : whole;
  });
}

// ── the link gate (R-BTN-92, R-BTN-157) ─────────────────────────────────────────────────────

/** A render context: `webBases` the ticket's repositories' `web_base`s, `linkHosts` the
 *  instance's `link_hosts` (default empty), `now` the clock `time` fields read (default the
 *  wall clock). Hosts compare case-insensitively. Idempotent: an already-normalized context
 *  (`viewLink` receives one from `fieldOf`) passes through unchanged. */
function ctxOf(ctx) {
  const c = isObj(ctx) ? ctx : {};
  return {
    webBases: Array.isArray(c.webBases) ? c.webBases.filter((b) => typeof b === 'string') : [],
    linkHosts: c.linkHosts instanceof Set ? c.linkHosts
      : new Set(Array.isArray(c.linkHosts) ? c.linkHosts.filter((h) => typeof h === 'string').map((h) => h.trim().toLowerCase()) : []),
    now: typeof c.now === 'number' && Number.isFinite(c.now) ? c.now : Date.now(),
  };
}

/** R-BTN-112's link gate: the url a view may draw as a link — under one of the ticket's
 *  repositories' `web_base`s (R-BTN-92, which checks `https`, no userinfo and clean whole-segment
 *  paths) or with its host on `link_hosts` (R-BTN-157: an `https` URL with no userinfo) — or null,
 *  when every channel draws it as text. Both branches check the text as written (`cleanUrl`): a
 *  backslash, a stray control character or a scheme-only `https:host` can name a listed host to
 *  this parser and another to the one that opens the link. */
export function viewLink(url, ctx = {}) {
  if (typeof url !== 'string') return null;
  const c = ctxOf(ctx);
  for (const base of c.webBases) if (underWebBase(url, base)) return url;
  const u = cleanUrl(url, true);
  return u && c.linkHosts.has(u.hostname.toLowerCase()) ? url : null;
}

// ── one view, resolved to channel-neutral parts ─────────────────────────────────────────────

/** A field of a view, resolved for every channel: the text each channel draws, and what laying it
 *  out needs — a gated `href`, a status's `tone`, a gauge's `pct` fill, a table's `columns`,
 *  `rows` and `more`. No channel interprets a value further. */
function fieldOf(spec, value, ctx) {
  const label = typeof spec.label === 'string' ? clip(spec.label) : '';
  // A field's pointer is a pointer — the template path's own `POINTER` guard: anything else (an
  // `a` without its leading `/`) does not resolve, rather than reading the whole value as text.
  const ptr = typeof spec.pointer === 'string' ? spec.pointer : '';
  const at = POINTER.test(ptr) ? atPointer(value, ptr) : { ok: false };
  const v = at.ok ? at.value : undefined;
  const unit = typeof spec.unit === 'string' ? ` ${clip(spec.unit)}` : '';
  switch (spec.as) {
    case 'number': {
      const text = !at.ok ? '—'
        : typeof v === 'number' && Number.isFinite(v) ? `${v}${unit}`.trim() : clip(textOf(v));
      return { kind: 'number', label, text };
    }
    case 'time': {
      const t = typeof v === 'string' ? Date.parse(v) : NaN;
      if (!Number.isFinite(t)) return { kind: 'time', label, text: at.ok ? clip(textOf(v)) : '—' };
      const s = Math.abs(t - ctx.now) / 1000;
      const span = s < 60 ? `${Math.round(s)} s` : s < 3600 ? `${Math.round(s / 60)} min` : s < 86_400 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86_400)} d`;
      const abs = `${new Date(t).toISOString().replace('T', ' ').slice(0, 16)} UTC`;
      return { kind: 'time', label, text: `${t <= ctx.now ? `${span} ago` : `in ${span}`} (${abs})` };
    }
    case 'gauge': {
      const max = typeof spec.max === 'number' && Number.isFinite(spec.max) && spec.max > 0 ? spec.max : null;
      const n = typeof v === 'number' && Number.isFinite(v) ? v : null;
      const pct = max !== null && n !== null ? Math.max(0, Math.min(100, (n / max) * 100)) : null;
      return { kind: 'gauge', label, text: n === null ? (at.ok ? clip(textOf(v)) : '—') : `${n}${max !== null ? `/${max}` : ''}${unit}`.trim(), pct };
    }
    case 'status': {
      const tone = isObj(spec.tones) && typeof spec.tones[v] === 'string' && TONES.has(spec.tones[v]) ? spec.tones[v] : null;
      return { kind: 'status', label, text: at.ok ? clip(textOf(v)) : '—', tone };
    }
    case 'table': {
      const items = Array.isArray(v) ? v.filter(isObj) : [];
      const keys = items.length ? Object.keys(items[0]) : [];
      const columns = keys.map((k) => clip(k));
      const rows = items.slice(0, VIEW_TABLE_ROWS).map((row) => keys.map((k) => (own(row, k) ? clip(textOf(row[k])) : '')));
      return { kind: 'table', label, columns, rows, more: Math.max(0, items.length - VIEW_TABLE_ROWS) };
    }
    case 'link':
      return { kind: 'link', label, text: at.ok ? clip(typeof v === 'string' ? v : textOf(v)) : '—', href: at.ok ? viewLink(v, ctx) : null };
    default:
      // `text`, and anything else a view says: drawn as text, never interpreted.
      return { kind: 'text', label, text: at.ok ? clip(textOf(v)) : '—' };
  }
}

/** R-BTN-112's last fallback: the value's keys and values two levels deep — a container inside
 *  (object or array) opens one level, and an object inside an array opens its keys too, so an
 *  array of objects shows its scalars as an object's object values do; anything deeper is text —
 *  truncated to the field and text bounds. */
function genericFields(value) {
  const fields = [];
  let cut = 0;
  const add = (label, v) => {
    if (fields.length >= VIEW_FIELDS_MAX) cut++;
    else fields.push({ kind: 'text', label, text: clip(textOf(v)) });
  };
  const open = (prefix, v) => {
    if (isObj(v)) for (const [k, x] of Object.entries(v)) add(clip(`${prefix}.${k}`), x);
    else if (Array.isArray(v)) v.forEach((x, i) => {
      if (isObj(x)) for (const [k, y] of Object.entries(x)) add(clip(`${prefix}[${i}].${k}`), y);
      else add(clip(`${prefix}[${i}]`), x);
    });
    else add(clip(prefix || 'value'), v);
  };
  if (isObj(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (isObj(v) || Array.isArray(v)) open(k, v);
      else add(clip(k), v);
    }
  } else {
    open('', value);
  }
  return cut ? [...fields, { kind: 'text', label: '', text: `+${cut} more` }] : fields;
}

/** The view a value renders by (R-BTN-112's fallback): its own schema's `x-baton-view`, else the
 *  nearest up its `x-baton-base` chain, else null — the generic rendering. A `x-baton-view` with
 *  no `title`, `summary` or `fields` is no view. */
export function viewOf(schemaId, resolve) {
  for (const id of baseChain(schemaId, resolve)) {
    const s = resolve(id);
    const v = isObj(s) ? s['x-baton-view'] : null;
    if (isObj(v) && (typeof v.title === 'string' || typeof v.summary === 'string' || Array.isArray(v.fields))) return v;
  }
  return null;
}

/** One view resolved to channel-neutral parts: `title` and `summary` with their pointers replaced,
 *  each `fields` entry resolved per its `as`, every text truncated — or, with `generic` set, the
 *  fallback rendering of the value itself. */
function modelOf(value, schemaId, resolve, ctx) {
  const view = viewOf(schemaId, resolve);
  if (!view) return { title: null, summary: null, fields: genericFields(value), generic: true };
  const fields = (Array.isArray(view.fields) ? view.fields : [])
    .filter(isObj).slice(0, VIEW_FIELDS_MAX).map((f) => fieldOf(f, value, ctx));
  return {
    title: typeof view.title === 'string' ? clip(template(view.title, value)) : null,
    summary: typeof view.summary === 'string' ? clip(template(view.summary, value)) : null,
    fields,
    generic: false,
  };
}

// ── the plain channel: the CLI, a forge-check summary, a handler course's text ───────────────

/** What the plain channel's medium cannot carry, drawn inert: C0 and C1 controls (an OSC 8 escape
 *  draws a clickable link into the terminal, a `\n` forges whole lines) and the bidi marks and
 *  embeddings that reorder what a terminal shows. §12.3 bans them in free text; where one reaches
 *  a renderer anyway it draws as `?`, inert — core's own `safeText` precedent (src/core/courses.ts). */
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
const inert = (s) => [...s].map((ch) => (CONTROL.test(ch) ? '?' : ch)).join('');

/** One field as plain text; a table's rows follow indented, its columns `|`-separated. Every text
 *  is drawn inert — no control or bidi character a terminal would act on survives. */
function plainField(f) {
  const head = f.label ? `${f.label}: ` : '';
  switch (f.kind) {
    case 'table': {
      const out = f.label ? [`${f.label}:`] : [];
      if (f.columns.length) out.push(`  ${f.columns.join(' | ')}`);
      for (const row of f.rows) out.push(`  ${row.join(' | ')}`);
      if (f.more) out.push(`  +${f.more} more rows`);
      return out.map(inert).join('\n');
    }
    default:
      return inert(`${head}${f.text}`);
  }
}

/** The `plain` renderer (R-BTN-112): every value as text, controls and bidi marks drawn inert — a
 *  link as its URL, whether or not the gate passed, for plain has no markup to click. */
export function renderPlain(value, schemaId, resolve, ctx = {}) {
  const m = modelOf(value, schemaId, resolve, ctxOf(ctx));
  return [m.title !== null ? inert(m.title) : null, m.summary !== null ? inert(m.summary) : null, ...m.fields.map(plainField)]
    .filter((x) => x !== null && x !== '').join('\n');
}

// ── the html channel: a handler course's mail ───────────────────────────────────────────────

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

/** Fixed colours and shapes only: no style value carries anything a value said. */
const HTML = {
  box: 'font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.5',
  title: 'font-weight:600',
  muted: 'color:#57606a',
  link: 'color:#0969da',
  tone: { ok: '#1a7f37', warn: '#9a6700', bad: '#cf222e', info: '#0969da' },
  cell: 'padding:2px 8px;text-align:left;vertical-align:top',
  head: 'padding:2px 8px;text-align:left;vertical-align:top;border-bottom:1px solid #d0d7de;font-weight:600',
  track: 'background:#d0d7de;height:4px;width:120px;border-radius:2px;margin-top:2px',
  fill: 'background:#0969da;height:4px;border-radius:2px',
};

/** One field as html: every value escaped, styles inline and fixed, a link an `<a>` only when the
 *  gate passed. */
function htmlField(f) {
  const head = f.label ? `<span style="${HTML.muted}">${esc(f.label)}:</span> ` : '';
  switch (f.kind) {
    case 'status':
      return `<div>${head}<span style="font-weight:600${f.tone ? `;color:${HTML.tone[f.tone]}` : ''}">${esc(f.text)}</span></div>`;
    case 'gauge':
      return `<div>${head}${esc(f.text)}${f.pct === null ? '' : `<div style="${HTML.track}"><div style="${HTML.fill};width:${Math.round(f.pct)}%"></div></div>`}</div>`;
    case 'link':
      return `<div>${head}${f.href === null ? `<span>${esc(f.text)}</span>` : `<a href="${esc(f.href)}" style="${HTML.link}">${esc(f.text)}</a>`}</div>`;
    case 'table': {
      if (!f.columns.length && !f.rows.length) return `<div>${head}</div>`;
      const head_ = `<tr>${f.columns.map((c) => `<th style="${HTML.head}">${esc(c)}</th>`).join('')}</tr>`;
      const body = f.rows.map((r) => `<tr>${r.map((cell) => `<td style="${HTML.cell}">${esc(cell)}</td>`).join('')}</tr>`);
      if (f.more) body.push(`<tr><td style="${HTML.cell};${HTML.muted}" colspan="${f.columns.length || 1}">+${f.more} more rows</td></tr>`);
      return `<div>${head}<table style="border-collapse:collapse;margin:4px 0">${head_}${body.join('')}</table></div>`;
    }
    default:
      return `<div>${head}${esc(f.text)}</div>`;
  }
}

/** The `html` renderer (R-BTN-112): every value escaped, inline styles only — no script, image or
 *  remote resource, and no link the gate refused. */
export function renderHtml(value, schemaId, resolve, ctx = {}) {
  const m = modelOf(value, schemaId, resolve, ctxOf(ctx));
  const parts = [];
  if (m.title !== null) parts.push(`<div style="${HTML.title}">${esc(m.title)}</div>`);
  if (m.summary !== null) parts.push(`<div style="${HTML.muted}">${esc(m.summary)}</div>`);
  parts.push(...m.fields.map(htmlField));
  return `<div style="${HTML.box}">${parts.join('')}</div>`;
}

// ── the ui channel: the dashboard, through textContent ──────────────────────────────────────

/** A node for the dashboard: `{ text, cls, attrs, style }`, the shape src/ui/app.js's `el()`
 *  builds — except `style`, which today's `el()` drops: B-56/B-57 must extend it to set each entry
 *  through the CSSOM (never a parsed style attribute), the only position a gauge's fill needs.
 *  Every text is set through `textContent` (§12.3: no markup is ever built from server text). */
function node(tag, opts = {}, ...children) {
  const n = { tag };
  if (opts.text !== undefined) n.text = String(opts.text);
  if (opts.cls) n.cls = opts.cls;
  if (opts.attrs) n.attrs = opts.attrs;
  if (opts.style) n.style = opts.style;
  if (children.length) n.children = children;
  return n;
}

/** One field as ui nodes: text set by the page's `textContent`, a link an `<a>` only when the gate
 *  passed, a gauge's fill positioned through the CSSOM. */
function uiField(f) {
  const labelled = (value) => node('div', { cls: 'view-field' }, ...(f.label ? [node('span', { cls: 'view-label', text: `${f.label}:` })] : []), value);
  switch (f.kind) {
    case 'status':
      return labelled(node('span', { cls: f.tone ? `view-tone-${f.tone}` : undefined, text: f.text }));
    case 'gauge':
      return labelled(node('span', {}, node('span', { text: f.text }),
        ...(f.pct === null ? [] : [node('span', { cls: 'view-gauge' }, node('span', { cls: 'view-gauge-fill', style: { width: `${Math.round(f.pct)}%` } }))])));
    case 'link':
      return labelled(f.href === null ? node('span', { text: f.text })
        : node('a', { cls: 'view-link', text: f.text, attrs: { href: f.href, target: '_blank', rel: 'noopener' } }));
    case 'table': {
      const head = node('thead', {}, node('tr', {}, ...f.columns.map((c) => node('th', { text: c }))));
      const body = node('tbody', {}, ...f.rows.map((r) => node('tr', {}, ...r.map((cell) => node('td', { text: cell })))));
      if (f.more) body.children.push(node('tr', {}, node('td', { text: `+${f.more} more rows`, attrs: { colspan: String(f.columns.length || 1) } })));
      return node('div', { cls: 'view-field' }, ...(f.label ? [node('span', { cls: 'view-label', text: `${f.label}:` })] : []), node('table', { cls: 'view-table' }, head, body));
    }
    default:
      return labelled(node('span', { text: f.text }));
  }
}

/** The `ui` renderer (R-BTN-112): a tree of nodes the dashboard mounts with `textContent` — the
 *  renderer itself runs where the page's code does, so it builds data, not DOM. */
export function renderUi(value, schemaId, resolve, ctx = {}) {
  const m = modelOf(value, schemaId, resolve, ctxOf(ctx));
  const children = [];
  if (m.title !== null) children.push(node('div', { cls: 'view-title', text: m.title }));
  if (m.summary !== null) children.push(node('div', { cls: 'view-summary', text: m.summary }));
  children.push(...m.fields.map(uiField));
  return node('div', { cls: `view${m.generic ? ' view-generic' : ''}` }, ...children);
}

// ── core's own event templates (R-BTN-112) ──────────────────────────────────────────────────

/** One line for each of the ticket history's kinds (§4.7 R-BTN-81): Baton's words, never a
 *  course's — courses ship no rendering code. `row` is the history row; every id it names is
 *  Baton-validated. */
function eventLine(kind, row) {
  const d = isObj(row.detail) ? row.detail : {};
  const leg = typeof row.leg === 'string' && row.leg ? row.leg : 'a leg';
  const run = row.run != null ? ` (run ${row.run})` : '';
  const at = typeof row.reached === 'string' && row.reached ? ` at ${row.reached}` : '';
  const next = typeof row.next_leg === 'string' && row.next_leg ? `; next ${row.next_leg}` : '';
  switch (kind) {
    case 'leg-started': return `leg ${leg} started${run}`;
    case 'leg-finished': return `leg ${leg} finished${at}${next}`;
    case 'leg-abandoned': return `leg ${leg} abandoned${typeof d.end_reason === 'string' ? ` (${d.end_reason})` : ''}`;
    case 'position-confirmed': return `position confirmed${at}`;
    case 'position-replaced': return `position replaced${at}`;
    case 'git-moved': return `git moved the ticket${typeof d.to === 'string' ? ` to ${d.to}` : at}`;
    case 'regressed': return `git has the ticket back${at}`;
    case 're-routed': return `re-routed${typeof row.next_leg === 'string' && row.next_leg ? ` to ${row.next_leg}` : ''}`;
    case 'blocked': return `blocked${Array.isArray(d.blocks) ? ` (${d.blocks.length} block${d.blocks.length === 1 ? '' : 's'})` : ''}`;
    case 'unblocked': return `unblocked${Array.isArray(d.cleared) ? ` (${d.cleared.length} cleared)` : ''}`;
    case 'decision-opened': return `decision ${typeof d.decision === 'string' ? d.decision : '?'} opened`;
    case 'decision-answered': return `decision ${typeof d.decision === 'string' ? d.decision : '?'} answered`;
    case 'inputs': return 'inputs recorded';
    case 'outputs': return 'outputs recorded';
    case 'discrepancy': return `discrepancy (${typeof d.sub === 'string' ? d.sub : 'unknown'})`;
    case 'spawned': return `children filed${Array.isArray(d.ids) ? ` (${d.ids.length})` : ''}`;
    default: return String(kind);
  }
}

/** Core's own templates for its events (R-BTN-112): one line each, with one slot — `slot`, the
 *  course's view of the relevant value, rendered by `renderPlain` by the caller — appended where
 *  the event carries one (`outputs` does; most kinds carry no value and leave the slot empty).
 *  The line itself is drawn inert, like every plain text (the slot already is, by renderPlain). */
export function renderEvent(kind, row = {}, slot = '') {
  const line = inert(clip(eventLine(kind, isObj(row) ? row : {})));
  return slot ? `${line} — ${slot}` : line;
}
