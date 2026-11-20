// View.tsx — R-BTN-112's `ui` renderer on the page (B-206, §12.3): a value and its schema id go
// to the shared library's `renderUi`, which answers a tree of `{tag, cls, text, children}`; this
// maps that tree to React elements with text children only. The schema is fetched once per id
// through `GET /v1/repositories/{repository}/schemas` (B-217) and kept for the session, per
// repository. A schema the read does not know, or one with no view, is drawn as pretty-printed
// JSON, as text. No markup is parsed anywhere on this path, and no element is filled by a ref.
import { createElement, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { renderUi, viewOf, type UiNode } from '../../shared/view.mjs';
import { schemaRefs, type Schema } from '../../shared/schema.mjs';
import { apiGet } from './api';
import { safeHref, useLinkContext, type LinkContext } from './links';

// ── the schema cache ─────────────────────────────────────────────────────────────────────

/** `repository\nid` → the schema, or null where the read does not know the id. */
const known = new Map<string, Schema | null>();
const pending = new Map<string, Promise<void>>();
const MAX_HOPS = 8; // a base chain deeper than the validator admits is not followed
const IDS_PER_CALL = 50; // B-217's cap

const keyOf = (repository: string, id: string) => `${repository}\n${id}`;

/** Forget every schema: sign-out, and a test's teardown. */
export function resetSchemaCache() {
  known.clear();
  pending.clear();
}

async function fetchSchemas(repository: string, ids: string[]): Promise<void> {
  const path = `/v1/repositories/${encodeURIComponent(repository)}/schemas?ids=${ids.map(encodeURIComponent).join(',')}`;
  let got: Record<string, unknown> = {};
  try {
    const res = await apiGet(path);
    const body = res.changed ? (res.data as { schemas?: unknown }) : null;
    if (body && typeof body.schemas === 'object' && body.schemas !== null) got = body.schemas as Record<string, unknown>;
  } catch {
    got = {}; // a refusal draws the JSON fallback; the polling layer names the refusal itself
  }
  for (const id of ids) {
    const s = got[id];
    known.set(keyOf(repository, id), typeof s === 'object' && s !== null && !Array.isArray(s) ? (s as Schema) : null);
  }
}

/** Load `id` and every schema it refers to (its base chain, its `$ref`s), once each. */
function loadSchema(repository: string, id: string): Promise<void> {
  const key = keyOf(repository, id);
  const running = pending.get(key);
  if (running) return running;
  const run = (async () => {
    let want = [id];
    for (let hop = 0; hop < MAX_HOPS && want.length > 0; hop++) {
      const missing = [...new Set(want)].filter((i) => !known.has(keyOf(repository, i))).slice(0, IDS_PER_CALL);
      if (missing.length > 0) await fetchSchemas(repository, missing);
      want = want.flatMap((i) => {
        const s = known.get(keyOf(repository, i));
        return s ? schemaRefs(s).filter((r) => !known.has(keyOf(repository, r))) : [];
      });
    }
  })().finally(() => pending.delete(key));
  pending.set(key, run);
  return run;
}

// ── the node tree, as elements ───────────────────────────────────────────────────────────

/** The elements a view may become; any other tag is a `span`. */
const TAGS = new Set(['div', 'span', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td']);
const CLASS = /^[A-Za-z0-9_ -]{1,200}$/;
const PERCENT = /^\d{1,3}(\.\d{1,2})?%$/;

function element(node: UiNode, links: LinkContext, key: number): ReactNode {
  const tag = TAGS.has(node.tag) ? node.tag : 'span';
  const props: Record<string, unknown> = { key };
  if (typeof node.cls === 'string' && CLASS.test(node.cls)) props.className = node.cls;
  const attrs = node.attrs ?? {};
  // The gauge's fill is the one position a view sets (R-BTN-112): a width in percent.
  if (node.style && typeof node.style.width === 'string' && PERCENT.test(node.style.width)) props.style = { width: node.style.width } satisfies CSSProperties;
  if ((tag === 'td' || tag === 'th') && /^\d{1,3}$/.test(attrs.colspan ?? '')) props.colSpan = Number(attrs.colspan);
  let as = tag;
  if (tag === 'a') {
    // The renderer gated the link already; the page asks the same rule again before it draws one.
    const href = safeHref(attrs.href, links);
    if (href === null) as = 'span';
    else Object.assign(props, { href, target: '_blank', rel: 'noopener noreferrer' });
  }
  const children: ReactNode[] = [];
  if (typeof node.text === 'string') children.push(node.text);
  (node.children ?? []).forEach((child, i) => children.push(element(child, links, i)));
  return createElement(as, props, ...children);
}

/** A value as pretty-printed JSON, as text (§12.3's fallback for any blob). */
export function JsonText({ value }: { value: unknown }) {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    text = String(value);
  }
  return <pre className="json">{text}</pre>;
}

/** One value drawn by its schema's view. `schema` is the value's schema id as the read names
 *  it; `repository` the repository whose registry holds it. */
export function View({ value, schema, repository }: { value: unknown; schema: string | null | undefined; repository: string }) {
  const links = useLinkContext();
  const [, setLoaded] = useState(0);
  const id = typeof schema === 'string' && schema !== '' ? schema : null;
  const ready = id === null || known.has(keyOf(repository, id));
  useEffect(() => {
    if (id === null || known.has(keyOf(repository, id))) return;
    let live = true;
    void loadSchema(repository, id).then(() => {
      if (live) setLoaded((n) => n + 1);
    });
    return () => {
      live = false;
    };
  }, [repository, id]);
  if (id === null || !ready) return <JsonText value={value} />;
  const resolve = (ref: string) => known.get(keyOf(repository, ref)) ?? null;
  let tree: UiNode | null = null;
  try {
    tree = viewOf(id, resolve) === null ? null : renderUi(value, id, resolve, { webBases: links.webBases, linkHosts: links.linkHosts, now: Date.now() });
  } catch {
    tree = null; // a schema the renderer cannot read is a blob like any other
  }
  return tree === null ? <JsonText value={value} /> : <>{element(tree, links, 0)}</>;
}
