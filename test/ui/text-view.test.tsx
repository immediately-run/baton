// text-view.test.tsx — B-206's two rendering components (§12.3): `Text` draws any value as a
// text child; `View` maps R-BTN-112's node tree to elements with text children only, fetching
// the schema once per id (B-217's `repo.schemas`), and falls back to pretty-printed JSON for a
// schema the read does not know or one with no view. A hostile string is text on every path.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { Text, textOf } from '../../src/dashboard/lib/Text';
import { View } from '../../src/dashboard/lib/View';
import { mockFetch, renderWithShell, repoList, repoRow, resetShell } from './helpers';

const HOSTILE = '<img src=x onerror="alert(1)"><script>alert(2)</script>';

const SCHEMA = {
  type: 'object',
  properties: { title: { type: 'string' }, state: { type: 'string' }, url: { type: 'string' }, rows: { type: 'array', items: { type: 'object', properties: { a: { type: 'string' } } } } },
  'x-baton-view': {
    title: '{/title}',
    fields: [
      { label: 'State', pointer: '/state', as: 'status' },
      { label: 'Link', pointer: '/url', as: 'link' },
    ],
  },
};

afterEach(() => {
  cleanup();
  resetShell();
});

describe('Text (B-206 item 2)', () => {
  it('coerces every value to text', () => {
    expect([textOf('a'), textOf(3), textOf(true), textOf(null), textOf(undefined), textOf({ a: 1 })]).toEqual(['a', '3', 'true', '—', '—', '{"a":1}']);
  });

  it('draws a hostile string as a text node, never as elements', () => {
    const { container } = render(<p><Text value={HOSTILE} /></p>);
    expect(container.querySelector('img, script')).toBeNull();
    expect(container.textContent).toBe(HOSTILE);
  });
});

describe('View (B-206 item 3)', () => {
  it('maps the renderer’s node tree to elements, with a hostile value as text', async () => {
    const { calls } = mockFetch({ '/v1/repositories/docs/schemas': { schemas: { 'course-a:thing@1': SCHEMA } } });
    const repos = repoList([repoRow('docs')]);
    const { container } = renderWithShell(<View repository="docs" schema="course-a:thing@1" value={{ title: HOSTILE, state: 'ok', url: 'https://github.com/example-org/docs/pull/7' }} />, { repos });
    await waitFor(() => expect(container.querySelector('.view')).not.toBeNull());
    expect(calls.map((c) => c.path)).toEqual(['/v1/repositories/docs/schemas?ids=course-a%3Athing%401']);
    expect(container.querySelector('img, script')).toBeNull();
    expect(container.querySelector('.view-title')?.textContent).toBe(HOSTILE);
    expect(screen.getByText('State:')).toBeDefined();
    // A link under the repository's web_base passes the link rule and opens apart.
    const a = container.querySelector('a');
    expect([a?.getAttribute('href'), a?.getAttribute('target'), a?.getAttribute('rel')]).toEqual(['https://github.com/example-org/docs/pull/7', '_blank', 'noopener noreferrer']);
  });

  it('draws a link the rule refuses as text', async () => {
    mockFetch({ '/v1/repositories/docs/schemas': { schemas: { 'course-a:thing@1': SCHEMA } } });
    const { container } = renderWithShell(<View repository="docs" schema="course-a:thing@1" value={{ title: 't', state: 'ok', url: 'https://evil.example/x' }} />, { repos: repoList([repoRow('docs')]) });
    await waitFor(() => expect(container.querySelector('.view')).not.toBeNull());
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('https://evil.example/x');
  });

  it('fetches a schema once per id for the session', async () => {
    const { calls } = mockFetch({ '/v1/repositories/docs/schemas': { schemas: { 'course-a:thing@1': SCHEMA } } });
    const first = renderWithShell(<View repository="docs" schema="course-a:thing@1" value={{ title: 'one' }} />);
    await waitFor(() => expect(first.container.querySelector('.view')).not.toBeNull());
    const second = renderWithShell(<View repository="docs" schema="course-a:thing@1" value={{ title: 'two' }} />);
    expect(second.container.querySelector('.view-title')?.textContent).toBe('two');
    expect(calls).toHaveLength(1);
  });

  it('falls back to pretty-printed JSON for an unknown schema, a schema with no view, and no schema', async () => {
    const { calls } = mockFetch({ '/v1/repositories/docs/schemas': { schemas: { 'course-a:plain@1': { type: 'object' } } } });
    const value = { note: HOSTILE, n: 1 };
    const unknown = renderWithShell(<View repository="docs" schema="course-a:missing@1" value={value} />);
    await waitFor(() => expect(calls).toHaveLength(1));
    const plain = renderWithShell(<View repository="docs" schema="course-a:plain@1" value={value} />);
    await waitFor(() => expect(calls).toHaveLength(2));
    const none = renderWithShell(<View repository="docs" schema={null} value={value} />);
    for (const r of [unknown, plain, none]) {
      expect(r.container.querySelector('.view')).toBeNull();
      expect(r.container.querySelector('img, script')).toBeNull();
      expect(r.container.querySelector('pre.json')?.textContent).toBe(JSON.stringify(value, null, 2));
    }
    expect(calls).toHaveLength(2); // no schema id, no fetch
  });
});
