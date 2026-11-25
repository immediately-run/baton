// credentials.test.tsx — B-199: the credential screens, each a table from one field of the one
// grants read (`GET /v1/owner/{repository}/grants`). Each lists its rows, names the command
// that changes it (lines the commands test holds to the CLI), draws no control, and draws a
// hostile label as text; a kind Baton does not hold says so and names what builds it, with no
// row; the six screens make one read between them; a refused read is the repository's refusal.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { COMMANDS } from '../../src/dashboard/screens/credentials/commands';
import { CheckRunnersScreen, GrantsScreen, McpKeysScreen, OwnersScreen, SyncKeysScreen, TokensScreen } from '../../src/dashboard/screens/credentials/CredentialScreens';
import { mockFetch, refuse, renderApp, renderWithShell, repoList, repoRow, resetShell } from './helpers';
import { cliLines, expectNoControl, FP, FP2, HOSTILE, propsFor, tableText } from './readonlyFixture';

const GRANTS = '/v1/owner/docs/grants';
const T = Date.parse('2026-11-20T12:00:00Z');

const answer = {
  repository: 'docs',
  owners: [
    { repository_id: 'docs', fingerprint: FP, added_by: 'admin:seed', added_at: T, kind: 'ssh', human_only: true },
    { repository_id: 'docs', fingerprint: 'bak_0123456789abcdef', added_by: `owner:${FP}`, added_at: T, kind: 'api', human_only: false },
  ],
  grants: [
    { credential_id: FP2, hostname: 'lab-box', label: HOSTILE, repository_id: 'docs', capabilities: '["agent-venue","key:x"]', max_tier: 'careful', max_claims: 2,
      granted_by: `owner:${FP}`, granted_at: T, other_repositories: ['ops'], role: 'trusted-runner', domain: 'lab.example', set_by: `owner:${FP}` },
    { credential_id: 'SHA256:short', hostname: 'vm-2', label: null, repository_id: 'docs', capabilities: '[]', max_tier: null, max_claims: 1,
      granted_by: `admin:${FP}`, granted_at: T, other_repositories: [], role: null, domain: null, set_by: null },
  ],
  settings: { repository_id: 'docs' },
  bars: [],
  sync_keys: [{ fingerprint: FP2, role: 'sync', added_by: `admin:${FP}`, added_at: T }, { fingerprint: FP, role: 'mirror', added_by: `admin:${FP}`, added_at: T }],
  dependency_consents: [],
  not_built: { tokens: 'R-BTN-117', mcp_keys: 'B-124', check_runners: 'B-290', grant_acceptance: 'R-BTN-146', code_repo_consents: 'R-BTN-140' },
  server_time: T,
};

const repos = repoList([repoRow('docs'), repoRow('ops')]);
const at = (id: string, list = repos) => propsFor(id, list, { repository: 'docs' });

afterEach(() => {
  cleanup();
  resetShell();
});

describe('the credential screens (B-199)', () => {
  it('/grants lists each grant from the read, a hostile label as text, and names its commands', async () => {
    mockFetch({ [GRANTS]: answer });
    const { container } = renderWithShell(<GrantsScreen {...at('repository/grants')} />, { repos });
    await screen.findByRole('table', { name: 'Grants in force' });
    const rows = tableText(container, 'Grants in force');
    expect(rows).toHaveLength(2);
    expect(rows[0].slice(1, 7)).toEqual(['lab-box', HOSTILE, 'agent-venuekey:x', 'careful', '2', `trusted-runner · domain lab.exampleset by owner: ${FP.slice(0, 18)}…${FP}`]);
    expect(rows[1].slice(1, 7)).toEqual(['vm-2', '—', 'none', 'any', '1', 'runner']);
    expect(rows[1][7]).toMatch(/by admin: SHA256:/);
    // The fingerprint: short, the whole of it one focus away, and never a link.
    const fp = container.querySelector('tbody th .fp') as HTMLElement;
    expect([fp.getAttribute('title'), fp.getAttribute('tabindex'), fp.querySelector('.fp-short')?.textContent]).toEqual([FP2, '0', `${FP2.slice(0, 18)}…`]);
    expect(fp.closest('a')).toBeNull();
    // The other repositories a key is granted on link their own Grants screen.
    expect(within(container).getByRole('link', { name: 'ops' }).getAttribute('href')).toBe('/repositories/ops/grants');
    expect(cliLines(container)).toEqual([COMMANDS.grantAdd.line, COMMANDS.grantRevoke.line]);
    // No grant is drawn pending: acceptance is not built, and the screen says so.
    expect(screen.getByText(/none is pending/)).toBeDefined();
    expect(screen.getByText(/acceptance by its holder.*not built yet/)).toBeDefined();
    expect(container.textContent).toContain('R-BTN-146');
    expectNoControl(container);
  });

  it('/owners lists kind and human-only, and the seed notice where repo.list flags the repository', async () => {
    mockFetch({ [GRANTS]: answer });
    const plain = renderWithShell(<OwnersScreen {...at('repository/owners')} />, { repos });
    await screen.findByRole('table', { name: 'Owner keys' });
    const rows = tableText(plain.container, 'Owner keys');
    expect(rows.map((r) => [r[1], r[2], r[3]])).toEqual([['ssh', '● human-only', 'admin: seed'], ['api', '○ no', `owner: ${FP.slice(0, 18)}…${FP}`]]);
    expect(rows[1][0]).toBe('bak_0123456789abcdef');
    expect(plain.queryByText(/owned only by the keys the deployment seeded/)).toBeNull();
    expect(cliLines(plain.container)).toEqual([COMMANDS.ownerAdd.line, COMMANDS.ownerRemove.line]);
    expectNoControl(plain.container);
    plain.unmount();

    const seeded = repoList([repoRow('docs')], 'administrator', { seed_owners: ['docs'] });
    const flagged = renderWithShell(<OwnersScreen {...at('repository/owners', seeded)} />, { repos: seeded });
    const note = (await flagged.findByText(/owned only by the keys the deployment seeded/)).closest('.band') as HTMLElement;
    expect(within(note).getByText(COMMANDS.seedOwnerAdd.line)).toBeDefined();
  });

  it('/sync-keys lists each key with its role', async () => {
    mockFetch({ [GRANTS]: answer });
    const { container } = renderWithShell(<SyncKeysScreen {...at('repository/sync-keys')} />, { repos });
    await screen.findByRole('table', { name: 'Sync keys' });
    expect(tableText(container, 'Sync keys').map((r) => r[1])).toEqual(['sync', 'mirror']);
    expect(cliLines(container)).toEqual([COMMANDS.syncKeyAdd.line, COMMANDS.mirrorKeyAdd.line, COMMANDS.syncKeyRemove.line]);
    expectNoControl(container);
  });

  it('a kind Baton does not hold says so, names what builds it, and draws no row', async () => {
    mockFetch({ [GRANTS]: answer });
    for (const [Screen, id, lead, by] of [
      [TokensScreen, 'repository/tokens', /Registration tokens are not built yet/, 'R-BTN-117'],
      [McpKeysScreen, 'repository/mcp-keys', /MCP keys are not built yet/, 'B-124'],
      [CheckRunnersScreen, 'repository/check-runners', /The check-runner is not built, and will not be/, 'B-290'],
    ] as const) {
      const { container, unmount } = renderWithShell(<Screen {...at(id)} />, { repos });
      const note = (await screen.findByText(lead)).closest('.band') as HTMLElement;
      expect(within(note).getByText(by)).toBeDefined();
      expect(container.querySelector('table')).toBeNull();
      expect(cliLines(container)).toEqual([]);
      expectNoControl(container);
      unmount();
    }
  });

  it('an empty list says so in one sentence', async () => {
    mockFetch({ [GRANTS]: { ...answer, grants: [], owners: [], sync_keys: [] } });
    const grants = renderWithShell(<GrantsScreen {...at('repository/grants')} />, { repos });
    expect(await grants.findByText('No runner key is granted on this repository.')).toBeDefined();
    grants.unmount();
    const keys = renderWithShell(<SyncKeysScreen {...at('repository/sync-keys')} />, { repos });
    expect(await keys.findByText(/This repository has no sync key/)).toBeDefined();
  });

  it('the screens make one read between them, and a refused read is the repository’s refusal', async () => {
    const { calls } = mockFetch({ '/v1/repositories': repos, '/v1/actions': { actions: [] }, [GRANTS]: answer });
    const app = renderApp('/repositories/docs/grants');
    await screen.findByRole('table', { name: 'Grants in force' });
    expect(document.title).toBe('Grants — Baton');
    expect([...new Set(calls.map((c) => c.path))].sort()).toEqual(['/v1/actions', '/v1/owner/docs/grants', '/v1/repositories']);
    app.unmount();
    resetShell();

    mockFetch({ [GRANTS]: () => refuse('forbidden') });
    renderWithShell(<OwnersScreen {...at('repository/owners')} />, { repos });
    expect(await screen.findByRole('heading', { name: 'This repository is not yours or does not exist' })).toBeDefined();
  });
});
