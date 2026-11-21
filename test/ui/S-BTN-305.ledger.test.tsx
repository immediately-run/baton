// S-BTN-305, the client's half (B-203; test/integration/S-BTN-305 is the served half): each
// home the listing ledger names (test/lib/needsYouLedger.ts) is a screen that draws the field.
// The Conditions screen has a named row for every repository listing the ledger homes there;
// the State screen draws each of the instance's; the Sync screen draws an adoption with its
// control. A listing the ledger gave a home and no screen drew would be a listing lost.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { actionsFor } from '../../src/core/actions';
import { SCREENS } from '../../src/core/screens';
import { LISTINGS } from '../../src/dashboard/screens/conditions/ConditionsScreen';
import { LEDGER } from '../lib/needsYouLedger';
import { mockFetch, renderApp, repoList, repoRow, resetShell } from './helpers';
import { screenRoutes } from './screenFixtures';

const homes = Object.entries(LEDGER).flatMap(([key, list]) => list.map((home) => ({ key, ...home })));

afterEach(() => {
  cleanup();
  resetShell();
});

describe('S-BTN-305 each home in the ledger is a screen that draws it (B-203)', () => {
  it('every home’s screen is a registered screen', () => {
    for (const h of homes) expect([h.key, h.screen, SCREENS.some((s) => s.id === h.screen)]).toEqual([h.key, h.screen, true]);
    expect([...new Set(homes.map((h) => h.screen))].sort()).toEqual(['repository/conditions', 'repository/sync', 'tenant/state']);
  });

  it('Conditions names every repository listing the ledger homes there', () => {
    const named = new Set(LISTINGS.map((l) => l.key));
    const listed = homes.filter((h) => h.screen === 'repository/conditions' && h.field.startsWith('listings.')).map((h) => h.field.slice('listings.'.length));
    expect(listed.length).toBe(19);
    for (const key of listed) expect([key, named.has(key)]).toEqual([key, true]);
    // And nothing the screen names is a listing the ledger forgot.
    expect([...named].sort()).toEqual([...listed].sort());
  });

  it('Conditions draws a row of each listing, the questions and the conditions, from the read', async () => {
    const now = Date.now();
    const row = (key: string) => ({ ticket_id: `docs:${key}`, repository_id: 'docs', since: now, at: now, payload: { ticket_id: `docs:${key}` } });
    const routes = screenRoutes('a value', 'https://claude.ai/s/1');
    mockFetch({ ...routes, '/v1/repositories/docs/needs-you': {
      repository: 'docs',
      conditions: [{ condition_id: 4, ticket_id: 'docs:COND', leg: 'leg-a', run_id: 'r_1', type: 'type-a', disposition: 'suspend', severity: 'high', raised_at: now, url: null, restarts: null, default: null,
        outcome: 'open', closed_at: null, closed_how: null, resolve_url: '/repositories/docs/conditions/4', allowed: [] }],
      questions: [{ ticket_id: 'docs:QUESTION', leg: 'leg-p', asks: 'owner', title: 'a question', question_id: 'q-1', url: null, severity: 'high', options: [], answerable: false, why: 'not yours', human_only: false }],
      listings: Object.fromEntries(LISTINGS.map((l) => [l.key, [row(l.key)]])),
      held_posts: 0, elsewhere: ['instances_unknown', 'keys', 'capacity', 'stale_clients', 'stale_skills_no_course'], not_built: {}, server_time: now,
    } });
    renderApp('/repositories/docs/conditions');
    await screen.findByRole('heading', { name: 'Also waiting' });
    const text = document.querySelector('main')!.textContent!;
    for (const l of LISTINGS) expect([l.key, text.includes(l.label)]).toEqual([l.key, true]);
    expect(document.querySelectorAll('.needs-list')[1].querySelectorAll('.needs-row').length).toBe(LISTINGS.length);
    expect(text).toContain('docs:QUESTION');
    expect(text).toContain('docs:COND');
    // The instance's listings are named, with the way to the screen that draws them.
    expect([...document.querySelectorAll('main a')].some((a) => a.getAttribute('href') === '/state')).toBe(true);
  });

  it('State draws every instance-wide listing the ledger homes there', async () => {
    const tenantHomes = homes.filter((h) => h.screen === 'tenant/state').map((h) => h.field.replace(/^needs_you\./, ''));
    expect(tenantHomes.sort()).toEqual(['capacity', 'instances_unknown', 'keys', 'stale_clients', 'stale_skills_no_course']);
    mockFetch({
      '/v1/repositories': repoList([repoRow('docs')]), '/v1/actions': { actions: [] },
      '/v1/admin/tenant': { envelope: {}, figures: [], day: {}, live_claims: 0, frozen_at: null, sealed_at: null, not_built: {}, server_time: Date.now(), needs_you: {
        keys: { refused: 'the-keys-notice' },
        capacity: [{ figure: 'the-capacity-figure', value: 9, envelope: 10 }],
        instances_unknown: [{ instance: 'the-unknown-instance', since: Date.now() }],
        stale_clients: [{ hostname: 'the-old-client', session_name: 's', client_version: '0.1.0', recommended: '0.2.0' }],
        stale_skills_no_course: [{ id: 3, hostname: 'the-courseless-runner', session_name: 's' }],
      } },
    });
    renderApp('/state');
    const needs = (await screen.findByRole('heading', { name: 'Needs an administrator' })).closest('section') as HTMLElement;
    for (const word of ['the-keys-notice', 'the-capacity-figure', 'the-unknown-instance', 'the-old-client', 'the-courseless-runner']) expect([word, needs.textContent!.includes(word)]).toEqual([word, true]);
    expect(needs.querySelector('.count')?.textContent).toBe('5');
  });

  it('Sync draws an adoption, with its control for the administrator who confirms it', async () => {
    mockFetch(screenRoutes('the-adopting-session', 'https://claude.ai/s/1', actionsFor('administrator')));
    renderApp('/repositories/docs/sync');
    await waitFor(() => expect(document.querySelector('main')?.textContent ?? '').toContain('the-adopting-session'));
    const titles = [...document.querySelectorAll('.controls .control button[type="submit"]')].map((b) => b.getAttribute('title'));
    expect(titles).toContain(actionsFor('administrator').find((a) => a.id === 'adoption.confirm')!.summary);
  });
});
