// governance.test.tsx — B-200 and B-198: the governance screens, read-only, from reads that
// exist — `/policy` (the policy read and its log: guarantees met, the floors marked, the
// versions newest first), `/settings` (the grants read's settings, and `tiers` and `weight`
// from `repo.list`), `/bars` (owner bars in force and scheduled, required bars), `/consents`
// (the dependency consents and the code repositories) — and `/goals`, which says goals are not
// built. Each names its commands, draws no control, and draws a hostile reason as text.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { COMMANDS } from '../../src/dashboard/screens/credentials/commands';
import { GoalsScreen } from '../../src/dashboard/screens/goals/GoalsScreen';
import { BarsScreen, ConsentsScreen, PolicyScreen, SettingsScreen } from '../../src/dashboard/screens/governance/GovernanceScreens';
import { mockFetch, refuse, renderWithShell, repoList, repoRow, resetShell } from './helpers';
import { cliLines, expectNoControl, FP, HOSTILE, propsFor, tableText } from './readonlyFixture';

const GRANTS = '/v1/owner/docs/grants';
const T = Date.parse('2026-11-20T12:00:00Z');
const DAY = 86_400_000;

const repos = repoList([repoRow('docs', { tiers: ['routine', 'careful'], weight: 3 })]);
const at = (id: string) => propsFor(id, repos, { repository: 'docs' });

const grants = {
  repository: 'docs', owners: [], grants: [], sync_keys: [],
  settings: {
    repository_id: 'docs', forge: 'github', web_base: 'https://github.com/example-org/docs',
    required_bars: JSON.stringify([{ course: 'course-a', leg: '*', except: ['leg-x'], tag_prefix: 'family:' }]),
    retry: JSON.stringify({ backoff_ms: [60000], max_failed: 3 }), transcript_repos: null, unblocked_trigger: null, remind_after: 86400,
    scope_policy: 'report', runner_pushers: null, pushers: null, require_signed_control: 1,
    code_repos: [{ path: 'example-org/app', forge: 'github', host: 'github.com', repo_id: '1', owner_id: '2', web_base: 'https://github.com/example-org/app' }],
    a_setting_this_page_does_not_know: HOSTILE,
  },
  bars: [
    { id: 4, repository_id: 'docs', course: '*', tag: 'family:x', legs: [], applies: 'claim', starts_at: T - DAY, ends_at: null, release_holders: false, reason: HOSTILE, set_by: `owner:${FP}` },
    { id: 7, repository_id: 'docs', course: 'course-a', tag: 'family:y', legs: ['leg-a', 'leg-b'], applies: 'claim+advance', starts_at: T + DAY, ends_at: T + 2 * DAY, release_holders: true, reason: 'audit', set_by: 'mcp:key-9' },
  ],
  dependency_consents: [{ repository: 'ops', granted_by: `owner:${FP}`, granted_at: T }],
  not_built: { tokens: 'R-BTN-117', mcp_keys: 'B-124', check_runners: 'B-290', grant_acceptance: 'R-BTN-146', code_repo_consents: 'R-BTN-140' },
  server_time: T,
};

const policy = {
  repository: 'docs', tenant: 't', version: 2, hash: 'h2h2h2h2h2h2h2h2h2h2h2h2h2h2h2h2', policy: { merge: { trusted: true }, note: HOSTILE },
  guarantees: { 'no-runner-lands': true, 'independent-review': false, 'human-gates': true },
  floors: [{ repository_id: 'docs', name: 'deploy', guarantees: ['no-runner-lands', 'independent-review'], remove_by: 'human', added_by: `owner:${FP}`, added_at: T }],
  at: T, kid: 'k', signature: 'SIGNATURE-VALUE-XYZ',
};
const log = { versions: [
  { version: 1, hash: 'h1', previous_hash: null, changed_by: 'baton', approver: null, preset: null, at: T - DAY, changed: [] },
  { version: 2, hash: 'h2h2h2h2h2h2h2h2h2h2h2h2h2h2h2h2', previous_hash: 'h1', changed_by: `owner:${FP}`, approver: `owner:${FP}`, preset: 'protected', at: T, changed: ['merge.trusted', 'floors'] },
] };

afterEach(() => {
  cleanup();
  resetShell();
});

describe('the governance screens (B-200)', () => {
  it('/policy shows the version in force, marks each guarantee met and the floors, and lists the log newest first', async () => {
    mockFetch({ '/v1/repositories/docs/policy': policy, '/v1/owner/docs/policy/log': log });
    const { container } = renderWithShell(<PolicyScreen {...at('repository/policy')} />, { repos });
    await screen.findByRole('table', { name: 'Policy versions' });
    const kv = Object.fromEntries([...container.querySelectorAll('.kv-row')].map((r) => [r.querySelector('dt')?.textContent, r.querySelector('dd')?.textContent]));
    expect([kv.version, kv['preset applied']]).toEqual(['2', 'protected']);
    // The guarantees are the read's: met or not, a floor where a floor lists it — none computed here.
    const items = [...container.querySelectorAll('.guarantees li')].map((li) => li.textContent);
    expect(items).toEqual(['●no-runner-lands — met FLOOR', '○independent-review — not met FLOOR', '●human-gates — met']);
    expect(tableText(container, 'Floors')[0].slice(0, 3)).toEqual(['deploy', 'no-runner-landsindependent-review', 'human']);
    // The document: pretty-printed text, a hostile value inside it text.
    const doc = container.querySelector('.doc-box pre') as HTMLElement;
    expect(doc.textContent).toBe(JSON.stringify(policy.policy, null, 2));
    expect(container.querySelector('img')).toBeNull();
    const versions = tableText(container, 'Policy versions');
    expect(versions.map((v) => v[0])).toEqual(['2 IN FORCE', '1']);
    expect([versions[0][5], versions[0][7], versions[1][2], versions[1][5]]).toEqual(['protected', 'merge.trustedfloors', '—', '—']);
    expect(cliLines(container)).toEqual([COMMANDS.policySet.line, COMMANDS.policyApply.line, COMMANDS.policyFloorAdd.line]);
    // The signature is the read's own check, not the page's: not drawn.
    expect(container.textContent).not.toContain('SIGNATURE-VALUE-XYZ');
    expectNoControl(container);
  });

  it('/policy is drawn while its log is refused, and says which read failed', async () => {
    mockFetch({ '/v1/repositories/docs/policy': policy, '/v1/owner/docs/policy/log': () => refuse('invalid-params', 'no log today') });
    const { container } = renderWithShell(<PolicyScreen {...at('repository/policy')} />, { repos });
    expect((await screen.findByRole('alert')).textContent).toContain('no log today');
    expect(container.querySelectorAll('.guarantees li')).toHaveLength(3);
  });

  it('/settings shows each owner setting with its meaning, and tiers and weight from repo.list', async () => {
    const { calls } = mockFetch({ [GRANTS]: grants });
    const { container } = renderWithShell(<SettingsScreen {...at('repository/settings')} />, { repos });
    await screen.findByRole('table', { name: 'Owner settings' });
    const rows = tableText(container, 'Owner settings');
    const byKey = Object.fromEntries(rows.map((r) => [r[0], r]));
    // The registry's columns and the required bars are drawn elsewhere, not among the settings.
    expect(Object.keys(byKey).sort()).toEqual(['a_setting_this_page_does_not_know', 'code_repos', 'pushers', 'remind_after', 'require_signed_control', 'retry', 'runner_pushers', 'scope_policy', 'transcript_repos', 'unblocked_trigger']);
    expect([byKey.remind_after[1], byKey.scope_policy[1], byKey.pushers[1], byKey.require_signed_control[1]]).toEqual(['86400', 'report', 'not set', '● yes']);
    expect(byKey.remind_after[2]).toMatch(/waits for its decision/);
    // A setting stored as JSON text is drawn as the blob it is, and a list as chips.
    expect(byKey.retry[1]).toBe(JSON.stringify({ backoff_ms: [60000], max_failed: 3 }, null, 2));
    expect(byKey.code_repos[1]).toContain('"path": "example-org/app"');
    expect(byKey.a_setting_this_page_does_not_know.slice(1)).toEqual([HOSTILE, '—']);
    const kv = Object.fromEntries([...container.querySelectorAll('.kv-row')].map((r) => [r.querySelector('dt')?.textContent, r.querySelector('dd')?.textContent]));
    expect([kv.tiers, kv.weight]).toEqual(['routinecareful', '3']);
    expect(cliLines(container)).toEqual([COMMANDS.settingsSet.line, COMMANDS.registrySet.line]);
    expect(within(container).getByRole('link', { name: 'Bars' }).getAttribute('href')).toBe('/repositories/docs/bars');
    // One read: no administrator read is needed for the registry's two fields.
    expect([...new Set(calls.map((c) => c.path))]).toEqual([GRANTS]);
    expectNoControl(container);
  });

  it('/bars lists the owner bars in force and scheduled with who set each, and the required bars', async () => {
    mockFetch({ [GRANTS]: grants });
    const { container } = renderWithShell(<BarsScreen {...at('repository/bars')} />, { repos });
    await screen.findByRole('table', { name: 'Owner bars' });
    const bars = tableText(container, 'Owner bars');
    expect(bars.map((b) => [b[0], b[1], b[2], b[3], b[4], b[5]])).toEqual([
      ['4', '▲in force', 'every course', 'family:x', 'every leg', 'claim'],
      ['7', '○scheduled', 'course-a', 'family:y', 'leg-aleg-b', 'claim+advance'],
    ]);
    expect([bars[0][7], bars[0][9], bars[1][8], bars[1][10]]).toEqual(['until lifted', HOSTILE, '● yes', 'mcp: key-9']);
    expect(tableText(container, 'Required bars')).toEqual([['course-a', '*', 'leg-x', 'family:']]);
    expect(cliLines(container)).toEqual([COMMANDS.barAdd.line, COMMANDS.barLift.line, COMMANDS.requiredBarsSet.line, COMMANDS.requiredBarsClear.line]);
    expect(screen.getByText(/an approver’s, by key — never a session’s/)).toBeDefined();
    expectNoControl(container);
  });

  it('/consents lists the dependency consents and the code repositories, and says what is not built', async () => {
    mockFetch({ [GRANTS]: grants });
    const { container } = renderWithShell(<ConsentsScreen {...at('repository/consents')} />, { repos });
    await screen.findByRole('table', { name: 'Dependency consents' });
    expect(tableText(container, 'Dependency consents').map((r) => [r[0], r[1]])).toEqual([['ops', '● consented']]);
    expect(tableText(container, 'Code repositories')).toEqual([['example-org/app', 'github', 'github.com']]);
    // No command gives this consent: the page names the signed request, as text.
    expect(screen.getByText(/POST \/v1\/owner\/<repository>\/dependency-consents/)).toBeDefined();
    const note = screen.getByText(/own consent to being a code repository is not built yet/).closest('.band') as HTMLElement;
    expect(within(note).getByText('R-BTN-140')).toBeDefined();
    expectNoControl(container);
  });
});

describe('the goals screen (B-198)', () => {
  it('says goals are not built, names the ticket, reads nothing and draws no goal', async () => {
    const { calls } = mockFetch({});
    const { container } = renderWithShell(<GoalsScreen {...at('repository/goals')} />, { repos });
    expect(screen.getByRole('heading', { name: 'Goals' })).toBeDefined();
    expect(screen.getByText(/The goals read is not built yet/)).toBeDefined();
    expect(screen.getByText('B-122')).toBeDefined();
    expect(container.querySelector('table, .card, .meter')).toBeNull();
    expect(within(container).getByRole('link', { name: 'Board' }).getAttribute('href')).toBe('/repositories/docs/board');
    expect(calls).toEqual([]);
    expectNoControl(container);
  });
});
