// B-193 — the dashboard's shell on both hosts (R-BTN-55): the front answers `index.html` for
// `/`, `/login` and every §11.4 screen path with its parameters id-shaped (src/core/screens.ts),
// one set of bytes and no data; the two assets with their content types; the R-BTN-16 headers on
// every answer; and `404` outside the tree — V1's `/ui/*` paths and `src/ui/` with it, the owner
// ruling the transition needs no smoothing.
import { describe, expect, it } from 'vitest';
import { call } from '../helpers';
import { SCREENS } from '../../src/core/screens';

/** One screen path with its parameters filled by id-shaped segments, as a browser would link
 *  it. The front checks shape, never existence — that is the screen's own reads' refusal. */
const filled = (path: string): string => path
  .replace('{repository}', 'docs')
  .replace('{ticket}', 'B-1')
  .replace('{course}', 'roadmap-pr')
  .replace('{condition}', 'baton.stalled')
  .replace('{runner}', '7');

describe('the dashboard shell (B-193)', () => {
  it('answers index.html for /, /login, every screen path, and /conditions/{id} until B-195 redirects', async () => {
    const first = await call('/');
    expect(first.status).toBe(200);
    expect(first.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    const page = await first.text();
    expect(page).toContain('src="/dashboard/app.js"');
    for (const path of ['/login', ...SCREENS.map((s) => filled(s.path)), '/conditions/baton.stalled']) {
      const res = await call(path);
      expect([path, res.status]).toEqual([path, 200]);
      expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
      // One set of bytes, no data: an unauthenticated browser meets the same page everywhere.
      expect(await res.text()).toBe(page);
    }
  });

  it('answers the two assets with their content types', async () => {
    const js = await call('/dashboard/app.js');
    expect([js.status, js.headers.get('Content-Type')]).toEqual([200, 'text/javascript; charset=utf-8']);
    expect((await js.text()).length).toBeGreaterThan(0);
    const css = await call('/dashboard/app.css');
    expect([css.status, css.headers.get('Content-Type')]).toEqual([200, 'text/css; charset=utf-8']);
    expect(await css.text()).toContain('color-scheme');
  });

  it('answers 404 outside the tree: an unknown path, V1’s /ui/* paths, a screen segment without its repository, and a parameter that is not id-shaped', async () => {
    for (const path of ['/nope', '/ui/app.js', '/ui/app.css', '/board', '/repositories/docs/tickets/.hidden', '/conditions/not%20an%20id']) {
      const res = await call(path);
      expect([path, res.status]).toEqual([path, 404]);
    }
  });

  it('carries the R-BTN-16 headers on every answer, the refusals included', async () => {
    for (const path of ['/', '/login', '/instances', '/dashboard/app.js', '/dashboard/app.css', '/nope']) {
      const res = await call(path);
      expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'self'; frame-ancestors 'none'");
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    }
  });
});
