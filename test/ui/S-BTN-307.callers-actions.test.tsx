// S-BTN-307 a screen draws only its caller's actions (BATON_SPEC §11.3 R-BTN-129, §11.4
// R-BTN-155; B-191's scenario, B-216 item 2): a control on a screen is a registry entry the
// calling session was listed (`GET /v1/actions`) whose `ui.view` names that screen — never one
// the screen knows of itself. Over the real screens, mounted by the app's router on a mocked
// `fetch` whose reads allow everything they can:
//   1. every control drawn is one of the session's entries, placed on that screen by `ui.view`;
//   2. an administrator's session is drawn more than an owner's on the ticket's page (the
//      force-reap, the fence clear, the completion's confirm and release are an
//      administrator's), and neither is drawn an entry the other alone holds;
//   3. a session listed no entry is drawn no control, on any screen — the reads' `allowed`
//      words alone draw nothing;
//   4. the screens no entry names — the Resolve page, Attestations, `/instances`
//      — draw no control for any caller.
// The registry is the real one (src/core/actions.ts): an entry added to a screen is covered
// here without an edit.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, waitFor } from '@testing-library/react';
import { ACTIONS, actionsFor, type ListedAction } from '../../src/core/actions';
import { SCREENS } from '../../src/core/screens';
import { mockFetch, renderApp, resetShell } from './helpers';
import { PAGES, screenRoutes, type PageId } from './screenFixtures';

/** The screen a page's controls are placed on: the runners list draws each runner's own. */
const VIEW: Record<PageId, string> = {
  'repository/tickets': 'repository/tickets',
  'repository/tickets/{ticket}': 'repository/tickets/{ticket}',
  'repository/runners': 'repository/runners/{runner}',
  'repository/runners/{runner}': 'repository/runners/{runner}',
  'repository/conditions': 'repository/conditions',
  'repository/conditions/{condition}': 'repository/conditions/{condition}',
  'repository/attestations': 'repository/attestations',
  'repository/sync': 'repository/sync',
  'tenant/instances': 'tenant/instances',
};
const WITH_CONTROLS: PageId[] = ['repository/tickets', 'repository/tickets/{ticket}', 'repository/runners', 'repository/runners/{runner}', 'repository/sync', 'repository/conditions'];
const WITHOUT: PageId[] = ['repository/conditions/{condition}', 'repository/attestations', 'tenant/instances'];

const CALLERS: [string, 'administrator' | 'owner', ListedAction[]][] = [
  ['an administrator’s session', 'administrator', actionsFor('administrator')],
  ['an owner’s session', 'owner', actionsFor('owner', { ownsRepository: true })],
];

afterEach(() => {
  cleanup();
  resetShell();
});

/** The registry entries behind the controls drawn: a control's button carries its entry's
 *  summary as its description (`title`), and nothing else on a screen is a `.control`. */
async function drawn(page: PageId, role: 'administrator' | 'owner', actions: ListedAction[]): Promise<string[]> {
  const routes = screenRoutes('a value', 'https://claude.ai/code/session_1', actions, role);
  Object.assign(routes['/v1/repositories/docs/needs-you'] as object, {
    retry_decisions: [{ ticket_id: 'docs:HELD', station: 'station-a' }],
  });
  mockFetch(routes);
  renderApp(PAGES[page]);
  // A tenant screen is an administrator's: an owner's session is shown no such page, and so
  // nothing of it.
  const shown = page.startsWith('tenant/') && role !== 'administrator' ? 'No such page' : 'a value';
  await waitFor(() => expect(document.querySelector('main')?.textContent ?? '').toContain(shown));
  const summaries = [...document.querySelectorAll('.controls .control button[type="submit"], .controls .control-cli')].map((b) => b.getAttribute('title') ?? '');
  // Every control stands inside a `Controls` group: none is drawn by a screen's own hand.
  expect(document.querySelectorAll('.control').length).toBe(document.querySelectorAll('.controls .control').length);
  return summaries.map((summary) => {
    const entry = ACTIONS.find((a) => a.summary === summary);
    expect([page, summary, entry !== undefined]).toEqual([page, summary, true]);
    return entry!.id;
  });
}

describe('S-BTN-307 a screen draws only its caller’s actions (B-191, B-216)', () => {
  it('the fixture’s pages are screens, and the screens with a control are the ones the registry names', () => {
    for (const view of Object.values(VIEW)) expect([view, SCREENS.some((s) => s.id === view)]).toEqual([view, true]);
    const named = new Set(ACTIONS.flatMap((a) => a.ui?.view ?? []));
    expect([...named].sort()).toEqual([...new Set(WITH_CONTROLS.map((p) => VIEW[p]))].sort());
    for (const page of WITHOUT) expect([page, named.has(VIEW[page])]).toEqual([page, false]);
  });

  it.each(CALLERS)('%s: every control on a screen is one of its entries, placed there by ui.view', async (_who, role, actions) => {
    const held = new Map(actions.map((a) => [a.id, a]));
    for (const page of WITH_CONTROLS) {
      const ids = await drawn(page, role, actions);
      if (page === 'repository/tickets') {
        expect(ids).toEqual(role === 'administrator' ? ['claim.confirm', 'claim.release'] : []);
      } else if (page === 'repository/conditions') {
        expect(ids).toEqual(role === 'administrator' ? ['owner.resolve-all'] : []);
      } else {
        expect([page, ids.length > 0]).toEqual([page, role === 'administrator' || ids.length > 0]);
      }
      for (const id of ids) {
        expect([page, id, held.has(id)]).toEqual([page, id, true]);
        expect([page, id, held.get(id)!.ui?.view.includes(VIEW[page])]).toEqual([page, id, true]);
      }
      cleanup();
      resetShell();
    }
  });

  it('an administrator is drawn what an owner is not, and no session an entry it does not hold', async () => {
    const page: PageId = 'repository/tickets/{ticket}';
    const admin = await drawn(page, 'administrator', actionsFor('administrator'));
    cleanup();
    resetShell();
    const ownerEntries = actionsFor('owner', { ownsRepository: true });
    const owner = await drawn(page, 'owner', ownerEntries);
    const ownerHolds = new Set(ownerEntries.map((a) => a.id));
    expect(admin).toEqual(expect.arrayContaining(['claim.force-reap']));
    expect(ownerHolds.has('claim.force-reap')).toBe(false);
    expect(owner).not.toContain('claim.force-reap');
    expect(owner.filter((id) => !ownerHolds.has(id))).toEqual([]);
    expect(admin.length).toBeGreaterThan(owner.length);
  });

  it('a session listed no entry is drawn no control on any screen, whatever the reads allow', async () => {
    for (const page of Object.keys(PAGES) as PageId[]) {
      expect([page, await drawn(page, 'owner', [])]).toEqual([page, []]);
      expect([page, document.querySelectorAll('.controls, .control').length]).toEqual([page, 0]);
      cleanup();
      resetShell();
    }
  });

  it.each(CALLERS)('%s: the screens no entry names draw no control', async (_who, role, actions) => {
    for (const page of WITHOUT) {
      expect([page, await drawn(page, role, actions)]).toEqual([page, []]);
      expect([page, document.querySelectorAll('.controls, .control').length]).toEqual([page, 0]);
      cleanup();
      resetShell();
    }
  });
});
