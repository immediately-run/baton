// view.test.ts — S-BTN-76 hostile values rendered (BATON_SPEC §15, §5.5 R-BTN-112; B-54): markup
// and `javascript:` in a view's templates and table cells, and a link to a host in neither the
// ticket's repositories' `web_base` nor the instance's `link_hosts`, through all three renderers —
// `plain` draws them as text, `html` escapes every value, `ui` hands the dashboard text it sets
// through `textContent`, and the link is a link only under R-BTN-92's rule or `link_hosts`
// (R-BTN-157), else text (G-BTN-100). Beside it: each `as`, the base-chain fallback and the
// generic two-level rendering, the `std:` library's views (R-BTN-110), and core's own event
// templates with one slot for the course's view.
import { describe, it, expect } from 'vitest';
import { renderEvent, renderHtml, renderPlain, renderUi, viewLink, viewOf, VIEW_TABLE_ROWS, VIEW_TEXT_MAX, type Resolve, type UiNode } from '../../src/shared/view.mjs';
import { checkSchema } from '../../src/shared/schema.mjs';
import { STD, stdSchema } from '../../src/shared/std.mjs';

const resolveWith = (extra: Record<string, Record<string, unknown>>): Resolve => (id: string) => extra[id] ?? stdSchema(id);
const DOCS = 'https://github.com/immediately-run/docs';
const ctx = { webBases: [DOCS], linkHosts: [], now: Date.parse('2026-11-04T12:00:00Z') };

/** A course schema carrying a view, over the fields the tests need. */
const schema = (view: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, url: { type: 'string' }, rows: { type: 'array' } }, 'x-baton-view': view, ...extra,
});

describe('S-BTN-76 hostile values rendered, through all three renderers', () => {
  // A view whose every value is hostile: markup in the template's pointers and the table's cells,
  // a script URL, and a link to a host the context does not list.
  const HOSTILE = schema({
    title: 'check {/title} {javascript:alert(1)} {/no/such <img>}',
    summary: '{/url}',
    fields: [
      { label: 'url', pointer: '/url', as: 'link' },
      { label: 'rows', pointer: '/rows', as: 'table' },
    ],
  });
  const value = {
    title: '<script>alert(1)</script>',
    url: 'https://evil.example.com/x',
    rows: [{ cell: '<img src=x onerror=alert(1)>', other: 'javascript:alert(1)' }],
  };
  const resolve = resolveWith({ 'c:hostile@1': HOSTILE });

  it('plain: every hostile value as text, the template replacing only {<JSON Pointer>}', () => {
    const text = renderPlain(value, 'c:hostile@1', resolve, ctx);
    expect(text).toContain('check <script>alert(1)</script>');
    // Not a resolving pointer: stays as written, never interpreted.
    expect(text).toContain('{javascript:alert(1)}');
    expect(text).toContain('{/no/such <img>}');
    // The summary's pointer resolves to the hostile url, drawn as text like every value.
    expect(text).toContain('https://evil.example.com/x');
    expect(text).toContain('rows:');
    expect(text).toContain('<img src=x onerror=alert(1)> | javascript:alert(1)');
    expect(text).not.toContain('<a href');
  });

  it('html: every value escaped, no script, no image, no remote resource, the link no <a>', () => {
    const html = renderHtml(value, 'c:hostile@1', resolve, ctx);
    expect(html).toContain('check &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('{javascript:alert(1)}');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;</td>');
    expect(html).toContain('>javascript:alert(1)</td>');
    expect(html).not.toContain('<a ');
    // Every tag is one the renderer wrote: no hostile value opened one of its own, and every
    // attribute is quoted over escaped text.
    expect([...new Set(html.match(/<\/?[a-z]+/g))].sort()).toEqual(
      ['</div', '</span', '</table', '</td', '</th', '</tr', '<div', '<span', '<table', '<td', '<th', '<tr']);
    // Inline styles only, from fixed vocabulary: no style carries anything a value said.
    for (const style of html.match(/style="[^"]*"/g) ?? []) expect(style).toMatch(/^style="[a-z0-9:;.,#\s-]*"$/);
  });

  it('ui: nodes the dashboard mounts through textContent — text verbatim, no href for the refused link', () => {
    const root = renderUi(value, 'c:hostile@1', resolve, ctx);
    const mounted = mount(root, document0());
    expect(mounted.text).toContain('check <script>alert(1)</script>');
    expect(mounted.text).toContain('{javascript:alert(1)}');
    // The table's cells are sibling nodes: each hostile value verbatim, no markup built.
    expect(mounted.text).toContain('rows:cell');
    expect(mounted.text).toContain('other<img src=x onerror=alert(1)>');
    expect(mounted.text).toContain('javascript:alert(1)');
    expect(mounted.hrefs).toEqual([]);
    // No node builds markup: every value sits in `text`, set by the page's textContent.
    for (const n of flatten(root)) expect(n).not.toHaveProperty('html');
  });

  it('the same link under web_base or on link_hosts is the one link; everything else is text', () => {
    const LINK = schema({ fields: [{ label: 'url', pointer: '/url', as: 'link' }] });
    const r = resolveWith({ 'c:link@1': LINK });
    const cases: [string, string[], string[], string | null][] = [
      ['https://github.com/immediately-run/docs/pull/7', [], [], 'https://github.com/immediately-run/docs/pull/7'],
      ['https://GitHub.com/Immediately-Run/Docs/blob/main/x', [], [], 'https://GitHub.com/Immediately-Run/Docs/blob/main/x'],
      ['https://status.example.com/x', [], ['status.example.com'], 'https://status.example.com/x'],
      ['https://status.example.com/x', [], [], null],
      // docs-evil is not under docs: the path must begin with web_base's whole segments.
      ['https://github.com/immediately-run/docs-evil/x', [], [], null],
      ['https://user:pass@github.com/immediately-run/docs/pull/7', [], [], null],
      ['javascript:alert(1)', [], ['evil.example.com'], null],
      ['http://github.com/immediately-run/docs/pull/7', [], ['github.com'], null],
    ];
    for (const [url, webBases, linkHosts, want] of cases) {
      expect([url, viewLink(url, { webBases: webBases.length ? webBases : ctx.webBases, linkHosts })]).toEqual([url, want]);
      const html = renderHtml({ url }, 'c:link@1', r, { ...ctx, webBases: webBases.length ? webBases : ctx.webBases, linkHosts });
      if (want === null) {
        expect([url, html]).toEqual([url, expect.stringMatching(/<span>[^<]*<\/span>/)]);
        expect(html).not.toContain('<a ');
        expect(flattenAttr(renderUi({ url }, 'c:link@1', r, { ...ctx, linkHosts }), 'href')).toBeUndefined();
      } else {
        expect([url, html]).toEqual([url, expect.stringContaining(`href="${want}"`)]);
        expect([url, flattenAttr(renderUi({ url }, 'c:link@1', r, { ...ctx, linkHosts }), 'href')]).toEqual([url, want]);
      }
    }
  });
});

describe('each `as` (R-BTN-112)', () => {
  const FIELDS = schema({
    fields: [
      { label: 'plain text', pointer: '/text', as: 'text' },
      { label: 'n', pointer: '/n', as: 'number', unit: 'ms' },
      { label: 'when', pointer: '/when', as: 'time' },
      { label: 'left', pointer: '/left', as: 'gauge', max: 10, unit: 'runs' },
      { label: 'state', pointer: '/state', as: 'status', tones: { pass: 'ok', fail: 'bad' } },
      { label: 'unmapped', pointer: '/state', as: 'status', tones: { pass: 'ok' } },
      { label: 'gone', pointer: '/missing', as: 'text' },
      { label: 'rows', pointer: '/rows', as: 'table' },
      { label: 'odd', pointer: '/n', as: 'verbose' },
    ],
  });
  const r = resolveWith({ 'c:fields@1': FIELDS });
  const value = { text: 'hello', n: 42, when: '2026-11-04T11:57:00Z', left: 7, state: 'fail', rows: [{ a: 1, b: 'x' }, { a: 2 }] };

  it('plain lays each out as text: units, relative and absolute time, gauge, tone as text', () => {
    expect(renderPlain(value, 'c:fields@1', r, ctx)).toEqual([
      'plain text: hello',
      'n: 42 ms',
      'when: 3 min ago (2026-11-04 11:57 UTC)',
      'left: 7/10 runs',
      'state: fail',
      'unmapped: fail',
      'gone: —',
      'rows:',
      '  a | b',
      '  1 | x',
      '  2 | ',
      'odd: 42',
    ].join('\n'));
  });

  it("html escapes and styles: a tone's colour, a gauge's fill from its numbers alone", () => {
    const html = renderHtml(value, 'c:fields@1', r, ctx);
    expect(html).toContain('n:</span> 42 ms');
    expect(html).toContain('when:</span> 3 min ago (2026-11-04 11:57 UTC)');
    expect(html).toContain('color:#cf222e');                      // fail → bad
    expect(html).toMatch(/width:70%/);                             // 7 of 10
    expect(html).toContain('<th style="');                         // a table's head
    expect(html).not.toContain('color:undefined');
  });

  it("ui carries the tone as a class and the gauge's fill through the CSSOM", () => {
    const flat = flatten(renderUi(value, 'c:fields@1', r, ctx));
    const tone = flat.find((n) => n.cls === 'view-tone-bad');
    expect(tone?.text).toBe('fail');
    const fill = flat.find((n) => n.cls === 'view-gauge-fill');
    expect(fill?.style).toEqual({ width: '70%' });
    const th = flat.find((n) => n.tag === 'th');
    expect(th?.text).toBe('a');
  });

  it('a table shows at most 50 rows, naming the rest', () => {
    const rows = Array.from({ length: VIEW_TABLE_ROWS + 1 }, (_, i) => ({ i }));
    const text = renderPlain({ rows }, 'c:fields@1', r, ctx);
    expect(text.match(/^  \d+$/gm)?.length).toBe(VIEW_TABLE_ROWS);
    expect(text).toContain(`+1 more rows`);
    expect(renderHtml({ rows }, 'c:fields@1', r, ctx)).toContain('+1 more rows');
    expect(mount(renderUi({ rows }, 'c:fields@1', r, ctx), document0()).text).toContain('+1 more rows');
  });

  it('every drawn text is truncated at the free-text bound', () => {
    const long = 'x'.repeat(VIEW_TEXT_MAX + 10);
    expect(renderPlain({ text: long }, 'c:fields@1', r, ctx)).toContain(`${'x'.repeat(VIEW_TEXT_MAX)}…`);
    expect(renderPlain({ text: long }, 'c:fields@1', r, ctx)).not.toContain('x'.repeat(VIEW_TEXT_MAX + 1));
  });
});

describe('the fallback (R-BTN-112)', () => {
  it("the value's own view, else the nearest up its base chain, else the generic rendering", () => {
    const base = schema({ title: 'base {/text}' }, { 'x-baton-base': 'std:url@1' });
    const own = { ...schema({ title: 'own {/text}' }), 'x-baton-base': 'c:two@1' };
    const r = resolveWith({ 'c:one@1': base, 'c:two@1': base, 'c:own@1': own });
    expect(viewOf('c:own@1', r)).toEqual(own['x-baton-view']);
    expect(renderPlain({ text: 'x', url: 'https://github.com/immediately-run/docs/pull/1' }, 'c:own@1', r, ctx)).toContain('own x');
    expect(viewOf('c:one@1', r)).toEqual(base['x-baton-view']);
    expect(viewOf('c:missing@1', r)).toBeNull();
  });

  it('the generic rendering: keys and values two levels deep, truncated', () => {
    const deep = { a: 1, b: { c: 'x', d: { e: 'three levels' } }, list: ['one', 'two'], s: 'top' };
    const text = renderPlain(deep, 'c:nothing@1', stdSchema, ctx);
    expect(text).toContain('a: 1');
    expect(text).toContain('b.c: x');
    // The third level never opens: the object is the value, as text.
    expect(text).toContain(`b.d: ${JSON.stringify({ e: 'three levels' })}`);
    expect(text).toContain('list[0]: one');
    expect(text).toContain('s: top');
    expect(renderHtml(deep, 'c:nothing@1', stdSchema, ctx)).toContain('b.c:</span> x');
    expect(mount(renderUi(deep, 'c:nothing@1', stdSchema, ctx), document0()).text).toContain('list[0]:one');
  });

  it('the generic rendering bounds its fields and names the cut', () => {
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i]));
    const text = renderPlain(many, 'c:nothing@1', stdSchema, ctx);
    expect(text).toContain('+6 more');
    expect(text.split('\n').length).toBe(25);
    // A value that is no object at all is still rendered, one field.
    expect(renderPlain('just text', 'c:nothing@1', stdSchema, ctx)).toBe('value: just text');
  });
});

describe('the std: library\'s views (R-BTN-110, R-BTN-112)', () => {
  it('each schema carries a view inside R-BTN-108\'s subset', () => {
    for (const [id, s] of Object.entries(STD)) {
      expect([id, checkSchema(s)]).toEqual([id, []]);
      expect([id, typeof s['x-baton-view']]).toEqual([id, 'object']);
    }
  });

  it('renders a std: value through each channel', () => {
    const check = { repository: 'docs', sha: 'a'.repeat(40), name: 'verify', conclusion: 'failure' };
    const plain = renderPlain(check, 'std:forge.check@1', stdSchema, ctx);
    expect(plain).toContain('verify');
    expect(plain).toContain('a check in docs at aaaa');
    expect(plain).toContain('conclusion: failure');
    const html = renderHtml(check, 'std:forge.check@1', stdSchema, ctx);
    expect(html).toMatch(/color:#cf222e/);
    const change = { repository: 'docs', number: 7, url: `${DOCS}/pull/7`, head_sha: 'b'.repeat(40), state: 'open' };
    expect(renderHtml(change, 'std:forge.change@1', stdSchema, ctx)).toContain(`href="${DOCS}/pull/7"`);
    expect(flattenAttr(renderUi(change, 'std:forge.change@1', stdSchema, ctx), 'href')).toBe(`${DOCS}/pull/7`);
    // std:object@1's uri is a git: or s3: pointer or any uri: the gate leaves it text.
    expect(renderHtml({ uri: 'git:owner/name@' + 'a'.repeat(40) + ':path', digest: `sha256:${'0'.repeat(64)}`, media_type: 'text/plain', size: 12 },
      'std:object@1', stdSchema, ctx)).not.toContain('<a ');
  });
});

describe('core\'s own event templates (R-BTN-112)', () => {
  it('one line per kind, Baton\'s words alone', () => {
    expect(renderEvent('leg-started', { leg: 'implement', run: 2 })).toBe('leg implement started (run 2)');
    expect(renderEvent('leg-finished', { leg: 'review', reached: 'reviewed' })).toBe('leg review finished at reviewed');
    expect(renderEvent('leg-abandoned', { leg: 'fix', detail: { end_reason: 'released:provider-suspended' } })).toBe('leg fix abandoned (released:provider-suspended)');
    expect(renderEvent('git-moved', { reached: 'pr-open', detail: { from: 'filed', to: 'pr-open' } })).toBe('git moved the ticket to pr-open');
    expect(renderEvent('regressed', { reached: 'reviewed' })).toBe('git has the ticket back at reviewed');
    expect(renderEvent('decision-opened', { detail: { decision: 'd-1' } })).toBe('decision d-1 opened');
    expect(renderEvent('blocked', { detail: { blocks: [{}, {}] } })).toBe('blocked (2 blocks)');
    expect(renderEvent('discrepancy', { detail: { sub: 'foreign-write' } })).toBe('discrepancy (foreign-write)');
    expect(renderEvent('an-unknown-kind')).toBe('an-unknown-kind');
  });

  it('each with one slot for the course\'s view of the relevant value', () => {
    const view = renderPlain({ url: 'https://evil.example.com/x' }, 'std:url@1', stdSchema, ctx);
    expect(renderEvent('outputs', {}, view)).toBe(`outputs recorded — ${view}`);
    expect(renderEvent('leg-finished', { leg: 'implement', reached: 'pr-open' }, 'pr #7')).toBe('leg implement finished at pr-open — pr #7');
    expect(renderEvent('outputs', {}, '')).toBe('outputs recorded');
  });

  it('bounds what a hostile row may say', () => {
    expect(renderEvent('leg-started', { leg: 'x'.repeat(600) })).toBe(`leg ${'x'.repeat(VIEW_TEXT_MAX - 4)}…`);
  });
});

// ── what the dashboard would build (src/ui/app.js's el, without a DOM) ──────────────────────

interface FakeNode { tag: string; textContent: string; attrs: Record<string, string>; style: Record<string, string>; children: FakeNode[] }

/** A stand-in for document.createElement: everything a node shows goes to textContent. */
function document0() {
  return {
    createElement(tag: string): FakeNode { return { tag, textContent: '', attrs: {}, style: {}, children: [] }; },
    createTextNode(text: string): FakeNode { return { tag: '#text', textContent: text, attrs: {}, style: {}, children: [] }; },
  };
}

/** Mount as src/ui/app.js's `el` does: text through textContent, attributes by name, positions
 *  through the CSSOM. */
function mount(n: UiNode, doc: ReturnType<typeof document0>): FakeNode & { text: string; hrefs: string[] } {
  const hrefs: string[] = [];
  const build = (x: UiNode): FakeNode => {
    const node = doc.createElement(x.tag);
    if (x.text !== undefined) node.textContent = x.text;
    for (const [k, v] of Object.entries(x.attrs ?? {})) {
      node.attrs[k] = v;
      if (k === 'href') hrefs.push(v);
    }
    for (const [k, v] of Object.entries(x.style ?? {})) node.style[k] = v;
    node.children = (x.children ?? []).map(build);
    return node;
  };
  const root = build(n);
  const text = (node: FakeNode): string => node.textContent + node.children.map(text).join('');
  return { ...root, text: text(root), hrefs };
}

function flatten(n: UiNode): UiNode[] {
  return [n, ...(n.children ?? []).flatMap(flatten)];
}

/** The one value of `attr` anywhere in the tree, or undefined. */
function flattenAttr(n: UiNode, attr: string): string | undefined {
  for (const node of flatten(n)) if (node.attrs && node.attrs[attr] !== undefined) return node.attrs[attr];
  return undefined;
}
