// tenant.test.tsx — B-214 and B-215: the tenant screens, read-only for an administrator's
// session. The registry marks `seed_owners` and retired rows; `/instances` marks a stale
// reading and expands to every reading by instrument; `/resources` lists the probe keys;
// `/capacities` links the holders; `/settings` gives each instance setting its meaning;
// `/state` draws each live figure against its envelope with a bar — and none where no envelope
// names one — and the two instance-wide listings that need an administrator; `/sessions` marks
// the caller's own. Each names its commands, draws no control, and draws a hostile string as
// text; anyone but an administrator is told the page is not theirs.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { COMMANDS } from '../../src/dashboard/screens/credentials/commands';
import { CapacitiesScreen, InstanceSettingsScreen, InstancesScreen, RegistryScreen, ResourcesScreen, SessionsScreen, StateScreen } from '../../src/dashboard/screens/tenant/TenantScreens';
import { mockFetch, refuse, renderApp, renderWithShell, repoList, repoRow, resetShell } from './helpers';
import { cliLines, expectNoControl, FP, FP2, HOSTILE, propsFor, tableText } from './readonlyFixture';

const T = Date.parse('2026-11-20T12:00:00Z');
const MIN = 60_000;
const repos = repoList([repoRow('docs'), repoRow('ops')]);
const at = (id: string) => propsFor(id, repos);

afterEach(() => {
  cleanup();
  resetShell();
});

describe('the tenant screens, part one (B-214)', () => {
  it('/repositories lists the registry, marking seed_owners and retired rows', async () => {
    const { calls } = mockFetch({ '/v1/admin/repositories?retired=1': {
      repositories: [
        { id: 'docs', github: 'example-org/docs', forge: 'github', web_base: 'https://github.com/example-org/docs', default_branch: 'main', weight: 2,
          head: { sha: 'cabec94c0123456789abcdef0123456789abcdef', received_at: T }, mode: { mode: 'cut-over' }, courses: [{ id: 'course-a', version: 3 }],
          sync_keys: [{ fingerprint: FP, role: 'sync' }], ci_identity: { kind: 'github-actions' }, retired_at: null },
        { id: 'ops', github: HOSTILE, forge: 'git', web_base: 'javascript:alert(1)', default_branch: 'main', weight: 1, head: null, mode: { mode: 'shadow' }, courses: [], sync_keys: [], ci_identity: null, retired_at: null },
        { id: 'old', github: '~retired/old', forge: 'github', web_base: 'https://github.com/example-org/old', default_branch: 'main', weight: 1, head: null, mode: 'shadow', courses: [], sync_keys: [], ci_identity: null, retired_at: T },
      ],
      seed_owners: ['ops'],
    } });
    const { container } = renderWithShell(<RegistryScreen {...at('tenant/repositories')} />, { repos, now: T + MIN });
    await screen.findByRole('table', { name: 'The registry' });
    const rows = tableText(container, 'The registry');
    expect(rows.map((r) => r[0])).toEqual(['docs', 'opsSEED OWNERS', 'oldRETIRED 1 min ago']);
    expect(rows[0].slice(1, 5)).toEqual(['example-org/docs (github.com)', 'github', 'main', '2']);
    expect([rows[0][6], rows[0][7], rows[0][9], rows[1][5], rows[1][8]]).toEqual(['cut-over', 'course-a', 'github-actions', 'no board yet', 'none']);
    // A live repository opens its board; a retired one opens nothing and links no forge.
    expect(within(container).getByRole('link', { name: 'docs' }).getAttribute('href')).toBe('/repositories/docs/board');
    expect(within(container).queryByRole('link', { name: 'old' })).toBeNull();
    expect(within(container).queryByRole('link', { name: /retired\/old/ })).toBeNull();
    // A hostile forge path is text, and a web_base that is no clean https URL is no link.
    expect(rows[1][1]).toBe(HOSTILE);
    expect(container.querySelectorAll('a[href^="javascript"]').length).toBe(0);
    expect(screen.getByText(/leans on the deploy for its owners/)).toBeDefined();
    expect(cliLines(container)).toEqual([COMMANDS.repoAdd.line, COMMANDS.repoSet.line, COMMANDS.repoRetire.line]);
    expect(calls.map((c) => c.path)).toEqual(['/v1/admin/repositories?retired=1']);
    expectNoControl(container);
  });

  it('/instances draws each state as a shape and a word, marks a stale reading, and expands by instrument', async () => {
    mockFetch({ '/v1/admin/instances': { instances: [
      { name: 'acct:one', repositories: ['docs'], serves: ['llm:cap'], state: 'unavailable', until: T + 30 * MIN, readings: [
        { source: `probe:${FP}`, writer: 'instrument', kind: 'state', available: false, until: T + 30 * MIN, observed_at: T, lapses_at: T + 30 * MIN, detail: { used: 9, note: HOSTILE }, stale: false },
        { source: `admin:${FP2}`, writer: 'admin', kind: 'state', available: true, until: null, observed_at: T - MIN, lapses_at: T - 1, detail: null, stale: true },
      ] },
      { name: HOSTILE, repositories: [], serves: ['disk:fs'], state: 'available', until: null, readings: [
        { source: 'runner:12', writer: 'runner', kind: 'state', available: true, until: null, observed_at: T, lapses_at: T - 1, detail: null, stale: true }] },
      { name: 'acct:idle', repositories: ['docs'], serves: ['llm:cap'], state: 'unknown', until: null, readings: [] },
    ], server_time: T } });
    const { container } = renderWithShell(<InstancesScreen {...at('tenant/instances')} />, { repos, now: T + MIN });
    await screen.findByRole('table', { name: 'Instances' });
    const rows = [...container.querySelectorAll('table[aria-label="Instances"] tbody tr')] as HTMLElement[];
    expect(rows.map((r) => r.children[0].textContent)).toEqual(['acct:one', HOSTILE, 'acct:idle']);
    expect(rows.map((r) => r.children[3].querySelector('.status')?.textContent)).toEqual(['▲unavailable', '●available', '○unknown']);
    expect(rows[0].children[3].textContent).toContain('until 2026-11-20 12:30 UTC');
    expect(rows[1].children[2].textContent).toBe('every repository');
    // The newest reading's line; the stale mark where the read says so, and nowhere else.
    const newest = (r: HTMLElement) => [...r.children[4].childNodes].filter((n) => (n as HTMLElement).tagName !== 'DETAILS').map((n) => n.textContent).join('');
    expect(newest(rows[0])).toMatch(/^unavailable until 2026-11-20 12:30 UTC · probe · 1 min ago$/);
    expect(newest(rows[1])).toMatch(/^available · runner · 1 min ago STALE$/);
    expect(newest(rows[2])).toBe('no reading in force');
    // Every reading by instrument, the detail pretty-printed as text.
    const details = rows[0].querySelector('details') as HTMLDetailsElement;
    expect(details.querySelector('summary')?.textContent).toBe('All 2 readings, by instrument');
    fireEvent.click(details.querySelector('summary') as HTMLElement);
    const readings = [...details.querySelectorAll('.reading')] as HTMLElement[];
    expect(readings).toHaveLength(2);
    expect(readings[0].textContent).toContain('(instrument)');
    expect(readings[0].querySelector('pre')?.textContent).toBe(JSON.stringify({ used: 9, note: HOSTILE }, null, 2));
    expect(readings[1].textContent).toMatch(/\(admin\) — available STALE/);
    expect(rows[2].querySelector('details')).toBeNull();
    expect(cliLines(container)).toEqual([COMMANDS.readingSet.line, COMMANDS.instanceAdd.line]);
    // `details` is the page's one disclosure: no button, no form.
    expectNoControl(container);
  });

  it('/resources lists each resource with its schema and instances, and the probe keys', async () => {
    mockFetch({ '/v1/admin/resources': {
      resources: [{ name: 'llm:cap', scope: 'account', detail_schema: { type: 'object', description: HOSTILE }, instances: ['acct:one', 'acct:two'] }, { name: 'disk:fs', scope: 'service', detail_schema: { type: 'object' }, instances: [] }],
      probes: [{ fingerprint: FP, label: HOSTILE, instances: ['acct:one'], added_by: `admin:${FP2}` }],
    } });
    const { container } = renderWithShell(<ResourcesScreen {...at('tenant/resources')} />, { repos });
    await screen.findByRole('table', { name: 'Probe keys' });
    const cards = [...container.querySelectorAll('.card')] as HTMLElement[];
    expect(cards.map((c) => c.querySelector('h3')?.textContent)).toEqual(['llm:cap', 'disk:fs']);
    expect(cards[0].querySelector('pre')?.textContent).toBe(JSON.stringify({ type: 'object', description: HOSTILE }, null, 2));
    expect(within(cards[0]).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([['acct:one', '/instances'], ['acct:two', '/instances']]);
    expect(cards[1].textContent).toContain('none');
    const probes = tableText(container, 'Probe keys');
    expect(probes).toHaveLength(1);
    expect(probes[0].slice(1, 3)).toEqual([HOSTILE, 'acct:one']);
    expect(probes[0][0]).toContain(FP);
    expect(cliLines(container)).toEqual([COMMANDS.resourceAdd.line, COMMANDS.instanceAdd.line, COMMANDS.probeAdd.line, COMMANDS.keyRevoke.line]);
    expectNoControl(container);
  });

  it('/capacities shows the seats held and links each holder’s ticket and runner', async () => {
    mockFetch({ '/v1/admin/capacities': { capacities: [
      { capability: 'capability:lab', capacity: 2, set_by: `admin:${FP}`, set_at: T, held: 1, holders: [{ claim_id: 41, ticket_id: 'docs:T-1', runner_id: 7 }] },
      { capability: 'capability:bench', capacity: 1, set_by: `admin:${FP}`, set_at: T, held: 0, holders: [] },
      { capability: 'capability:odd', capacity: 1, set_by: `admin:${FP}`, set_at: T, held: 1, holders: [{ claim_id: 42, ticket_id: HOSTILE, runner_id: 8 }] },
    ] } });
    const { container } = renderWithShell(<CapacitiesScreen {...at('tenant/capacities')} />, { repos });
    await screen.findByRole('table', { name: 'Capacities' });
    const rows = tableText(container, 'Capacities');
    expect(rows.map((r) => [r[0], r[1]])).toEqual([['capability:lab', '1 of 2'], ['capability:bench', '0 of 1'], ['capability:odd', '1 of 1']]);
    expect(rows[1][2]).toBe('no claim');
    expect(within(container).getByRole('link', { name: 'docs:T-1' }).getAttribute('href')).toBe('/repositories/docs/tickets/T-1');
    expect(within(container).getByRole('link', { name: '7' }).getAttribute('href')).toBe('/repositories/docs/runners/7');
    // A ticket id that fits no page is text, never a link.
    expect(rows[2][2]).toContain(HOSTILE);
    expect(within(container).getAllByRole('link').map((a) => a.textContent)).toEqual(['State', 'docs:T-1', '7']);
    expect(cliLines(container)).toEqual([COMMANDS.capacitySet.line, COMMANDS.capacityClear.line]);
    expectNoControl(container);
  });
});

describe('the tenant screens, part two (B-215)', () => {
  it('/settings lists each instance setting with its meaning', async () => {
    mockFetch({ '/v1/admin/settings': { link_hosts: ['ci.example.org', HOSTILE], session_hosts: [], check_app_id: null, recommended_client: '1.4.0' } });
    const { container } = renderWithShell(<InstanceSettingsScreen {...at('tenant/settings')} />, { repos });
    await screen.findByRole('table', { name: 'Instance settings' });
    const rows = tableText(container, 'Instance settings');
    expect(rows.map((r) => [r[0], r[1]])).toEqual([
      ['link_hosts', `ci.example.org${HOSTILE}`], ['session_hosts', 'none — no session link is accepted'], ['check_app_id', 'not set'], ['recommended_client', '1.4.0']]);
    for (const r of rows) expect(r[2].length).toBeGreaterThan(20);
    expect(cliLines(container)).toEqual([COMMANDS.instanceSettingsSet.line]);
    expectNoControl(container);
  });

  const tenant = {
    envelope: { live_runners: 50, repositories: 20, live_tickets: 5000, history_rows: 1000000, requests_per_second: 20, burst_in_5s: 100 },
    figures: [
      { figure: 'live_runners', value: 3, envelope: 50, ratio: 0.06, over: false },
      { figure: 'repositories', value: 2, envelope: 20, ratio: 0.1, over: false },
      { figure: 'live_tickets', value: 241, envelope: 5000, ratio: 0.0482, over: false },
      { figure: 'history_rows', value: 12345, envelope: 1000000, ratio: 0.012345, over: false },
      { figure: 'requests_per_second', value: 0.63, envelope: 20, ratio: 0.0315, over: false },
      { figure: 'burst_in_5s', value: 86, envelope: 100, ratio: 0.86, over: true },
    ],
    day: { day: '2026-11-20', requests: 25000, rows_written: 1200, limits: { requests: 100000, rows_written: 100000 } },
    live_claims: 2, frozen_at: null, sealed_at: null,
    needs_you: { keys: { refused: HOSTILE, revoked_listed: ['SHA256:gone'] }, capacity: [{ figure: 'burst_in_5s', value: 86, envelope: 100 }] },
    not_built: { storage_bytes: 'B-202' }, server_time: T,
  };

  it('/state draws each figure against its envelope with a bar, and none where no envelope names one', async () => {
    mockFetch({ '/v1/admin/tenant': tenant });
    const { container } = renderWithShell(<StateScreen {...at('tenant/state')} />, { repos });
    await screen.findByRole('heading', { name: 'Capacity' });
    const cards = [...container.querySelectorAll('.meter-card')] as HTMLElement[];
    const card = (title: string) => cards.find((c) => c.querySelector('h3')?.textContent === title)!;
    const figure = (title: string) => card(title).querySelector('.meter-figure')?.textContent;
    expect(cards.map((c) => c.querySelector('h3')?.textContent)).toEqual(['Live runners', 'Repositories', 'Live tickets', 'History rows', 'Requests a second', 'Largest burst', 'Live claims', 'Requests handled', 'Rows written']);
    expect([figure('Live runners'), figure('Live tickets'), figure('History rows'), figure('Requests a second'), figure('Largest burst')]).toEqual(['3 / 50', '241 / 5,000', '12,345 / 1,000,000', '0.63 / 20', '86 / 100']);
    // The bar's width is the read's own ratio, and its numbers are text beside it.
    expect((card('Largest burst').querySelector('.meter-fill') as HTMLElement).style.width).toBe('86%');
    expect(card('Largest burst').querySelector('.meter')?.getAttribute('aria-label')).toBe('86 of 100');
    expect(card('Largest burst').textContent).toContain('over 80%');
    expect(card('Live runners').textContent).not.toContain('over 80%');
    expect(card('Requests a second').textContent).toContain('5-minute mean');
    // Live claims has no envelope figure: a number, and no bar.
    expect([figure('Live claims'), card('Live claims').querySelector('.meter')]).toEqual(['2', null]);
    expect(figure('Requests handled')).toBe('25,000 / 100,000');
    expect((card('Requests handled').querySelector('.meter-fill') as HTMLElement).style.width).toBe('25%');
    // The mockup's per-credential "600 a minute" is not a tenant figure: not drawn.
    expect(container.textContent).not.toContain('600');
  });

  it('/state lists what needs an administrator, names the move’s commands, and offers no export', async () => {
    mockFetch({ '/v1/admin/tenant': tenant });
    const { container } = renderWithShell(<StateScreen {...at('tenant/state')} />, { repos });
    const needs = (await screen.findByRole('heading', { name: 'Needs an administrator' })).closest('section') as HTMLElement;
    expect(needs.querySelector('.count')?.textContent).toBe('2');
    expect(needs.textContent).toContain(`The list was refused and the keys in force stay: ${HOSTILE}`);
    expect(needs.textContent).toContain('SHA256:gone');
    expect(needs.textContent).toContain('Largest burst is over 80% of the envelope: 86 of 100');
    expect(cliLines(container)).toEqual([COMMANDS.freeze.line, COMMANDS.unfreeze.line, COMMANDS.seal.line, COMMANDS.exportState.line, COMMANDS.importState.line]);
    expect(container.querySelectorAll('a[href*="export"], a[download]').length).toBe(0);
    expect(screen.getByText(/The store’s size is not reported yet/)).toBeDefined();
    expect(container.querySelector('.band-bad')).toBeNull();
    expectNoControl(container);
  });

  it('/state lists the instance-wide listings V1’s Needs you drew: an unknown instance, a runner on an old client, a runner declaring no course (B-203)', async () => {
    mockFetch({ '/v1/admin/tenant': { ...tenant, needs_you: {
      keys: null, capacity: [],
      instances_unknown: [{ instance: `neon:${HOSTILE}`, since: T }],
      stale_clients: [{ hostname: 'vm-a', session_name: HOSTILE, client_version: '0.9.0', recommended: '1.4.0' }],
      stale_skills_no_course: [{ id: 7, hostname: HOSTILE, session_name: 's-7' }],
    } } });
    const { container } = renderWithShell(<StateScreen {...at('tenant/state')} />, { repos });
    const needs = (await screen.findByRole('heading', { name: 'Needs an administrator' })).closest('section') as HTMLElement;
    expect(needs.querySelector('.count')?.textContent).toBe('3');
    const bands = [...needs.querySelectorAll('.band-warn')].map((b) => b.textContent);
    expect(bands[0]).toContain(`Instance neon:${HOSTILE} has been unknown since 2026-11-20 12:00 UTC, and a posted leg needs what it serves`);
    expect(bands[1]).toContain(`Runner vm-a / ${HOSTILE} runs client 0.9.0, below the recommended 1.4.0`);
    expect(bands[2]).toContain(`Runner ${HOSTILE} / s-7 declares no course`);
    // The hostile values are text: no element of theirs exists.
    expect(needs.querySelector('img, script')).toBeNull();
    expect(within(needs).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/instances']);
    expectNoControl(container);
  });

  it('/state says nothing needs an administrator when nothing does, and shows a freeze', async () => {
    mockFetch({ '/v1/admin/tenant': { ...tenant, needs_you: { keys: null, capacity: [] }, frozen_at: T } });
    const { container } = renderWithShell(<StateScreen {...at('tenant/state')} />, { repos });
    expect(await screen.findByText(/Nothing: the runner key list seeded/)).toBeDefined();
    expect(container.querySelector('.band-warn')?.textContent).toContain('Frozen 2026-11-20 12:00 UTC');
  });

  it('/sessions lists the live sessions and marks the caller’s own', async () => {
    mockFetch({ '/v1/admin/sessions': { sessions: [
      { role: 'administrator', key_fingerprint: FP, created_at: T, expires_at: T + 12 * 60 * MIN, current: false },
      { role: 'administrator', key_fingerprint: FP2, created_at: T - 60 * MIN, expires_at: T + 11 * 60 * MIN, current: true },
      { role: HOSTILE, key_fingerprint: HOSTILE, created_at: T, expires_at: T, current: false },
    ], not_built: { last_seen_at: 'B-76', client_addr: 'B-76' }, server_time: T } });
    const { container } = renderWithShell(<SessionsScreen {...at('tenant/sessions')} />, { repos, now: T });
    await screen.findByRole('table', { name: 'Live sessions' });
    const rows = tableText(container, 'Live sessions');
    expect(rows.map((r) => r[0].includes('THIS SESSION'))).toEqual([false, true, false]);
    expect(rows.map((r) => r[1])).toEqual(['administrator', 'administrator', HOSTILE]);
    expect(rows[1][3]).toBe('2026-11-20 23:00 UTC');
    expect(rows[2][0]).toContain(HOSTILE);
    expect(cliLines(container)).toEqual([COMMANDS.open.line]);
    expect(screen.getByText(/there is no command that revokes one session/)).toBeDefined();
    const note = screen.getByText(/last use and its client’s address are not recorded yet/).closest('.band') as HTMLElement;
    expect(within(note).getByText('B-76')).toBeDefined();
    expectNoControl(container);
  });

  it('a tenant read refused to the caller says the page is an administrator’s', async () => {
    mockFetch({ '/v1/admin/sessions': () => refuse('forbidden') });
    renderWithShell(<SessionsScreen {...at('tenant/sessions')} />, { repos });
    expect(await screen.findByRole('heading', { name: 'This page is an administrator’s' })).toBeDefined();
    expect(screen.queryByText(/This repository is not yours/)).toBeNull();
  });

  it('each tenant screen is mounted at its path for an administrator’s session', async () => {
    mockFetch({ '/v1/repositories': repos, '/v1/actions': { actions: [] }, '/v1/admin/tenant': tenant, '/v1/admin/capacities': { capacities: [] } });
    const state = renderApp('/state');
    expect(await screen.findByRole('heading', { name: 'State' })).toBeDefined();
    expect(document.title).toBe('State — Baton');
    state.unmount();
    renderApp('/capacities');
    expect(await screen.findByText(/No capability has a capacity/)).toBeDefined();
  });
});
