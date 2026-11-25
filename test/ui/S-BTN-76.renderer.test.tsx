// S-BTN-76 hostile values rendered, against the V2 renderer (BATON_SPEC §12.3 R-BTN-112,
// G-BTN-13, G-BTN-100; B-216 item 2): the dashboard's real screens — mounted by the app's own
// router over a mocked `fetch` — draw every value of a read as text. A ticket's title, a hold's
// reason, an activity's label, a reading's detail, a condition's free text and an attestation's
// value carry markup with an event handler, a template expression, a backtick template and a
// `javascript:` anchor; the ticket page, the Tickets table, the runner page, `/instances`, the
// Resolve page and `/attestations` (and the runners list, the Conditions list and Sync beside
// them) show the characters and make no element of them. A link is built only from a URL the
// link rule passes: a `javascript:` or `data:` URL and an `https:` URL whose host is not in
// `link_hosts`, `session_hosts` or under a repository's `web_base` are text, and one that is
// listed is a link — so the rule is seen to pass something. The source gate
// (test/ui/source-gate.test.ts) is the other half: no file under `src/dashboard/` names a
// markup-parsing API.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, waitFor } from '@testing-library/react';
import { mockFetch, renderApp, resetShell } from './helpers';
import { PAGES, screenRoutes, type PageId } from './screenFixtures';

const MARKUP = '<img src=x onerror=alert(1)>';
const TEMPLATE = '{{x}}';
const BACKTICKS = '`${alert(1)}`';
const SCRIPT_ANCHOR = '<a href="javascript:alert(1)">open</a>';
/** One value carrying all four, as a hostile writer would send it. */
const HOSTILE = `${MARKUP} ${TEMPLATE} ${BACKTICKS} ${SCRIPT_ANCHOR}`;
const PARTS = [MARKUP, TEMPLATE, BACKTICKS, SCRIPT_ANCHOR];

/** A session link on `session_hosts` (the fixture's instance lists `claude.ai`). */
const LISTED = 'https://claude.ai/code/session_1';
const UNLISTED = ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'https://evil.example/s/1', 'https://claude.ai.evil.example/s/1', '//evil.example/s/1'];

afterEach(() => {
  cleanup();
  resetShell();
});

async function draw(page: PageId, url: string) {
  mockFetch(screenRoutes(HOSTILE, url));
  renderApp(PAGES[page]);
  await waitFor(() => expect(document.querySelector('main')?.textContent ?? '').toContain(MARKUP));
  return document.querySelector('main') as HTMLElement;
}

/** Nothing a read's text could have become: no element of the hostile string's, no handler
 *  attribute, no script-scheme or unlisted link. */
function expectText(main: HTMLElement) {
  for (const part of PARTS) expect(main.textContent).toContain(part);
  expect([...document.querySelectorAll('img, script, iframe, object, embed, style, link[rel="stylesheet"]')].map((e) => e.outerHTML.slice(0, 80))).toEqual([]);
  const all = [...document.querySelectorAll('*')];
  expect(all.flatMap((e) => e.getAttributeNames().filter((n) => n.startsWith('on')).map((n) => `${e.tagName} ${n}`))).toEqual([]);
  const hrefs = [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')!);
  expect(hrefs.filter((h) => /^\s*(javascript|data|vbscript):/i.test(h))).toEqual([]);
  expect(hrefs.filter((h) => h.includes('evil.example'))).toEqual([]);
  // An anchor's own text never came from the hostile anchor.
  expect([...document.querySelectorAll('a')].filter((a) => a.textContent === 'open')).toEqual([]);
}

/** Where each of the ticket's named values is drawn: the element that holds it, by screen. */
const NAMED: [PageId, string, string][] = [
  ['repository/tickets/{ticket}', 'a ticket title', 'h1'],
  ['repository/tickets', 'a ticket title', 'tr.tk-row'],
  ['repository/tickets', 'a hold reason', 'table'],
  ['repository/runners/{runner}', 'an activity label', 'table[aria-label="The window’s claims and activities"]'],
  ['repository/runners', 'an activity label', '.runner-card'],
  ['tenant/instances', 'a reading detail', 'table[aria-label="Instances"]'],
  ['repository/conditions/{condition}', 'a condition’s free text', '.page-sub'],
  ['repository/conditions', 'a hold reason', '.needs-list'],
  ['repository/attestations', 'an attestation value', '.value-cell'],
  ['repository/sync', 'a discrepancy’s kind', 'main'],
];

describe('S-BTN-76 hostile values are text on every V2 screen (B-216)', () => {
  it.each(Object.keys(PAGES) as PageId[])('%s draws markup, a template, backticks and a script anchor as text', async (page) => {
    const main = await draw(page, UNLISTED[0]);
    expectText(main);
  });

  it.each(NAMED)('%s: %s is drawn, as text, where the screen shows it', async (page, _what, selector) => {
    await draw(page, UNLISTED[0]);
    const holders = [...document.querySelectorAll(selector)];
    expect(holders.length).toBeGreaterThan(0);
    // A value drawn as a pretty-printed blob (a reading's detail, an attestation's value) shows
    // its quotes escaped, as JSON writes them: the anchor is looked for in either spelling.
    const shows = (h: Element) => [MARKUP, TEMPLATE, BACKTICKS].every((part) => (h.textContent ?? '').includes(part))
      && [SCRIPT_ANCHOR, JSON.stringify(SCRIPT_ANCHOR).slice(1, -1)].some((anchor) => (h.textContent ?? '').includes(anchor));
    expect(holders.some(shows)).toBe(true);
    // The characters are a text node's: no child element was made of them.
    for (const h of holders) expect(h.querySelector('img, script, a[href^="javascript:"]')).toBeNull();
  });

  it.each(Object.keys(PAGES) as PageId[])('%s makes no link of a URL the link rule does not pass', async (page) => {
    for (const url of UNLISTED) {
      const main = await draw(page, url);
      expectText(main);
      const hrefs = [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')!);
      expect([url, hrefs.filter((h) => h === url || h.startsWith(url))]).toEqual([url, []]);
      cleanup();
      resetShell();
    }
  });

  it('a listed session host is a link; the neutral label never exposes the address', async () => {
    for (const page of ['repository/tickets/{ticket}', 'repository/runners/{runner}', 'repository/conditions/{condition}'] as PageId[]) {
      await draw(page, LISTED);
      const linked = [...document.querySelectorAll('a[href]')].filter((a) => a.getAttribute('href') === LISTED);
      expect([page, linked.length > 0]).toEqual([page, true]);
      // A link out opens without a handle on this page.
      for (const a of linked) expect([a.getAttribute('rel'), a.getAttribute('target')]).toEqual(['noopener noreferrer', '_blank']);
      cleanup();
      resetShell();
      const main = await draw(page, 'https://evil.example/s/1');
      expect([...document.querySelectorAll('a[href*="evil.example"]')]).toEqual([]);
      expect([...main.querySelectorAll('.unlinked')].some((el) => el.textContent === 'Open leg page')).toBe(true);
      cleanup();
      resetShell();
    }
  });
});
