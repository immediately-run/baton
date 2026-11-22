// forge.test.ts — the request command's forge adapters (B-174, BATON_SPEC §5.8 R-BTN-131,
// §12.8 R-BTN-180): which refusals say "protected", each forge recognised by its own words;
// which adapter decides (the one --forge names, else github on github.com); and the one call
// that opens the request's PR with the caller's forge credential. Pure: the refusals are git's
// recorded stderr, the PR answers an injected fetch — the pushed branches and real git are
// request-protected.test.ts's, through the command itself.
import { describe, expect, it, vi } from 'vitest';
import { forgeApi, hostOf, NAMED_FORGES, openRequestPr, protectedRefusal, requestForge, tokenOf } from '../../src/defaults/forge';
import { forgeReader } from '../../src/defaults/forges';
import { FORGE_SHAPES } from '../../src/core/forges';
import { ticketRepositories } from '../../src/defaults/pr-verify';
import { ticketsMarkdown } from '../../src/defaults/tickets-markdown';
import { gateOfBranch, readHomePrCommits, verifiedMarkers } from '../../src/defaults/pr-markers';

/** git's stderr from a refused push, as each forge writes it over the `remote:` lines. */
const REFUSALS = {
  gh006: [
    'remote: error: GH006: Protected branch update failed for refs/heads/main.',
    'remote: error: Cannot push to this protected branch',
    "To github.com:immediately-run/baton",
    ' ! [remote rejected] HEAD -> main (protected branch hook declined)',
    "error: failed to push some refs to 'github.com:immediately-run/baton'",
  ].join('\n'),
  gh013PullRequest: [
    'remote: error: GH013: Rule violation found for refs/heads/main.',
    'remote: error: Changes must be made through a pull request.',
    ' ! [remote rejected] HEAD -> main (push declined due to repository ruleset violation)',
    "error: failed to push some refs to 'github.com:immediately-run/baton'",
  ].join('\n'),
  gh013Checks: [
    'remote: error: GH013: Rule violation found for refs/heads/main.',
    'remote: error: - Required status check "ci" is expected to pass.',
    ' ! [remote rejected] HEAD -> main (push declined due to repository ruleset violation)',
  ].join('\n'),
  gh013Secrets: [
    'remote: error: GH013: Rule violation found for refs/heads/main.',
    'remote: error: - Push cannot contain secrets.',
    'remote: error: GitHub found 2 potential secrets in your changes.',
    ' ! [remote rejected] HEAD -> main (push declined due to repository ruleset violation)',
  ].join('\n'),
  gh013OtherRule: [
    'remote: error: GH013: Rule violation found for refs/heads/main.',
    'remote: error: - This rule requires commit signatures.',
    ' ! [remote rejected] HEAD -> main (push declined due to repository ruleset violation)',
  ].join('\n'),
  gitlab: [
    'remote: GitLab: You are not allowed to push code to protected branches on this project.',
    'To gitlab.com:immediately-run/baton',
    ' ! [remote rejected] HEAD -> main (pre-receive hook declined)',
  ].join('\n'),
  gitea: ['remote: Gitea: Not allowed to push to protected branch', ' ! [remote rejected] HEAD -> main (protected branch hook declined)'].join('\n'),
  hook: ['remote: error: this repository wants no tickets by push', ' ! [remote rejected] HEAD -> main (pre-receive hook declined)'].join('\n'),
  permission: ["git@github.com: permission denied (publickey).", 'fatal: Could not read from remote repository.'].join('\n'),
} as const;

describe('the protected-branch matchers (R-BTN-131): each forge by its own words', () => {
  it('GitHub: GH006, and GH013 naming an update rule — never secret push protection, nor any other rule', () => {
    expect(protectedRefusal('github', REFUSALS.gh006)).toBe(true);
    expect(protectedRefusal('github', REFUSALS.gh013PullRequest)).toBe(true);
    expect(protectedRefusal('github', REFUSALS.gh013Checks)).toBe(true);
    // A GH013 about content, not about how the branch updates: a PR does not answer it.
    expect(protectedRefusal('github', REFUSALS.gh013Secrets)).toBe(false);
    // A GH013 naming a rule of neither kind (round 1): not protection, whatever the rule is.
    expect(protectedRefusal('github', REFUSALS.gh013OtherRule)).toBe(false);
    expect(protectedRefusal('github', REFUSALS.hook)).toBe(false);
    expect(protectedRefusal('github', REFUSALS.permission)).toBe(false);
  });

  it('GitLab and Gitea: their own protected-branch messages, and no other refusal', () => {
    expect(protectedRefusal('gitlab', REFUSALS.gitlab)).toBe(true);
    expect(protectedRefusal('gitea', REFUSALS.gitea)).toBe(true);
    // Not each other's, and not GitHub's: a forge's words are read by its own adapter alone.
    expect(protectedRefusal('gitlab', REFUSALS.gitea)).toBe(false);
    expect(protectedRefusal('gitea', REFUSALS.gitlab)).toBe(false);
    expect(protectedRefusal('gitlab', REFUSALS.gh006)).toBe(false);
    expect(protectedRefusal('gitlab', REFUSALS.hook)).toBe(false);
    expect(protectedRefusal('gitea', REFUSALS.hook)).toBe(false);
  });
});

describe('the adapter that decides (R-BTN-131): --forge names it, else github on github.com', () => {
  it('the origin host, of every remote form a checkout names', () => {
    expect(hostOf('https://github.com/immediately-run/baton')).toBe('github.com');
    expect(hostOf('https://gitlab.com/group/sub/baton.git')).toBe('gitlab.com');
    expect(hostOf('ssh://git@github.company.com:22/immediately-run/baton')).toBe('github.company.com');
    expect(hostOf('git@github.com:immediately-run/baton')).toBe('github.com');
    expect(hostOf('GIT@Gitea.com:immediately-run/baton')).toBe('gitea.com');
    // The user-less scp form (round 1): its colon parses as a scheme with no hostname, and the
    // host must still be read — a github.com origin engages the adapter with no --forge.
    expect(hostOf('github.com:immediately-run/baton')).toBe('github.com');
    // An https URL's explicit port rides along — it serves the forge's API as the repository —
    // an ssh URL's names the ssh channel, never the API's origin.
    expect(hostOf('https://git.example:8443/o/n')).toBe('git.example:8443');
    expect(hostOf('ssh://git@git.example:2222/o/n')).toBe('git.example');
    // A local path or file:// remote is no forge's.
    expect(hostOf('/srv/git/baton.git')).toBeNull();
    expect(hostOf('file:///srv/git/baton.git')).toBeNull();
  });

  it('github where origin is on github.com; nothing for any other host or a local path', () => {
    expect(requestForge(undefined, 'https://github.com/immediately-run/baton')).toBe('github');
    expect(requestForge(undefined, 'git@github.com:immediately-run/baton')).toBe('github');
    expect(requestForge(undefined, 'github.com:immediately-run/baton')).toBe('github');
    expect(requestForge(undefined, 'https://gitlab.com/immediately-run/baton')).toBeNull();
    expect(requestForge(undefined, 'https://gitea.com/immediately-run/baton')).toBeNull();
    expect(requestForge(undefined, '/srv/git/baton.git')).toBeNull();
    expect(requestForge(undefined, null)).toBeNull();
  });

  it('--forge names the adapter, git among the names names none', () => {
    expect(requestForge('github', '/srv/git/baton.git')).toBe('github');
    expect(requestForge('gitlab', 'https://github.com/immediately-run/baton')).toBe('gitlab');
    expect(requestForge('gitea', null)).toBe('gitea');
    expect(requestForge('git', 'https://github.com/immediately-run/baton')).toBeNull();
    expect([...NAMED_FORGES]).toEqual(['github', 'gitlab', 'gitea', 'git']);
  });
});

describe('opening the request’s PR with the caller’s forge credential', () => {
  /** One recorded answer: what the call saw, and what it answers. */
  const answer = (status: number, body: unknown): { seen: Request[]; fetchImpl: typeof fetch } => {
    const seen: Request[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      seen.push(new Request(String(input), init));
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    };
    return { seen, fetchImpl };
  };

  it('each forge at its own endpoint, the credential as a bearer, and the URL it answers', async () => {
    for (const [forge, url, body, wants] of [
      ['github', 'https://api.github.com/repos/immediately-run/baton/pulls', { title: 'T', head: 'baton-request/B-1', base: 'main' }, 'html_url'],
      ['gitlab', 'https://gitlab.com/api/v4/projects/immediately-run%2Fbaton/merge_requests', { title: 'T', source_branch: 'baton-request/B-1', target_branch: 'main' }, 'web_url'],
      ['gitea', 'https://gitea.com/api/v1/repos/immediately-run/baton/pulls', { title: 'T', head: 'baton-request/B-1', base: 'main' }, 'html_url'],
    ] as const) {
      const prUrl = `https://${forge}.com/immediately-run/baton/${forge === 'gitlab' ? '-/merge_requests' : forge === 'gitea' ? 'pulls' : 'pull'}/7`;
      const { seen, fetchImpl } = answer(201, { [wants]: prUrl });
      const got = await openRequestPr({ forge, host: forge === 'github' ? 'github.com' : `${forge}.com`, repo: 'immediately-run/baton', head: 'baton-request/B-1', base: 'main', title: 'T' }, 'tok', fetchImpl);
      expect(got).toBe(prUrl);
      expect(seen[0].method).toBe('POST');
      expect(seen[0].url).toBe(url);
      expect(seen[0].headers.get('authorization')).toBe(forge === 'gitea' ? 'token tok' : 'Bearer tok');
      expect(JSON.parse(await seen[0].text())).toEqual(body);
    }
  });

  it('a GitHub Enterprise host serves its API under its own name; each forge names its token', () => {
    expect(forgeApi('github', 'github.company.com')).toBe('https://github.company.com/api/v3');
    expect(forgeApi('gitlab', 'gitlab.company.com')).toBe('https://gitlab.company.com/api/v4');
    expect(forgeApi('gitea', 'gitea.company.com')).toBe('https://gitea.company.com/api/v1');
    // An explicit port rides along (round 1): a self-hosted forge on a non-default port gets
    // its API call sent to the origin that serves it.
    expect(forgeApi('gitea', 'git.example:8443')).toBe('https://git.example:8443/api/v1');
    expect(tokenOf('github')).toBe('GITHUB_TOKEN');
    expect(tokenOf('gitlab')).toBe('GITLAB_TOKEN');
    expect(tokenOf('gitea')).toBe('GITEA_TOKEN');
  });

  it('a forge that is not reached at all says so, naming the branch that is pushed (round 1)', async () => {
    const unreachable: typeof fetch = async () => {
      throw new TypeError('fetch failed');
    };
    await expect(
      openRequestPr({ forge: 'github', host: 'github.com', repo: 'immediately-run/baton', head: 'baton-request/B-3', base: 'main', title: 'T' }, 'tok', unreachable),
    ).rejects.toThrow('github (github.com) could not open the PR from baton-request/B-3: github was not reached — the request is pushed on baton-request/B-3; open the PR yourself');
  });

  it('a refusal is one line naming the forge, its answer, and the branch that is pushed', async () => {
    const { fetchImpl } = answer(403, { message: 'Resource not accessible by integration' });
    await expect(
      openRequestPr({ forge: 'github', host: 'github.com', repo: 'immediately-run/baton', head: 'baton-request/B-2', base: 'main', title: 'T' }, 'tok', fetchImpl),
    ).rejects.toThrow('github (github.com) could not open the PR from baton-request/B-2: github answered 403 at /repos/immediately-run/baton/pulls — the request is pushed on baton-request/B-2; open the PR yourself');
  });
});

// S-BTN-231, S-BTN-106: each wire format serves the same course contract.
it.each(['github', 'gitlab', 'gitea'] as const)('%s client opens, lists, comments, reads facts, and recognizes protection', async (forge) => {
  const path = forge === 'gitlab' ? 'o/group/r' : 'o/r';
  const host = `${forge}.example`;
  const base = `https://${host}/${path}`;
  const page = `${base}${FORGE_SHAPES[forge].pr}9`;
  const branch = 'claude/B-273-test';
  const sha = 'a'.repeat(40);
  const gl = forge === 'gitlab';
  const pr = gl ? { iid: 9, source_branch: branch, sha, source_project_id: 17, target_project_id: 17, state: 'opened', web_url: page }
    : { number: 9, head: { ref: branch, sha, repo: { id: 17 }, repo_id: 17 }, base: { repo: { id: 17 }, repo_id: 17 }, state: 'open', html_url: page };
  const end = gl ? '/merge_requests' : '/pulls';
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    expect(url.host).toBe(host);
    expect(init?.redirect).toBe('error');
    expect(new Headers(init?.headers).get('Authorization')).toBe(forge === 'gitea' ? 'token fake' : 'Bearer fake');
    if (url.pathname.endsWith(end)) return Response.json(init?.method === 'POST' ? pr : [pr]);
    if (init?.method === 'POST') return Response.json(gl ? { id: 2 } : { html_url: `${page}#issuecomment-2` });
    throw new Error(`unexpected request ${url}`);
  });
  // GitHub's existing reader takes fetch from the sync runtime.
  vi.stubGlobal('fetch', fetchImpl);
  try {
    const connect = forgeReader({ log: () => {}, owns: () => false, pushers: [] });
    const client = connect({ forge, path, webBase: base }, { env: { [tokenOf(forge)]: 'fake' }, fetchImpl });
    expect(await client.openPr({ head: branch, base: 'main', title: 'Test' })).toBe(page);
    expect(await client.listOpenPrs()).toEqual([{ number: 9, headRefName: branch, headRefOid: sha, sameRepository: true }]);
    expect(await client.comment(9, 'baton: verdict')).toBe(`${page}${gl ? '#note_2' : '#issuecomment-2'}`);
    expect(await client.facts({ tickets: [] })).toEqual([{ number: 9, head: branch, repository: path, state: 'open', url: page, sameRepository: true, ...(forge === 'github' ? {} : { headOid: sha }), pushedAt: 0, checks: [], reviews: [] }]);
    expect(client.protectedRefusal(gl ? 'not allowed to push code to protected branches' : forge === 'gitea' ? 'not allowed to push to protected branch' : 'GH006')).toBe(true);
    expect(client.protectedRefusal('access denied')).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('S-BTN-106: sync and verification both resolve a literal subgroup', () => {
  const text = '---\nid: B-1\nrepos: [o/group/r, alias]\n---\n';
  const repos = { alias: 'o/r' };
  expect(ticketRepositories(text, repos)).toEqual(['o/group/r', 'o/r']);
  expect(ticketsMarkdown([{ path: 'B-1.md', text }], { repos }).tickets[0].repos).toEqual(['o/group/r', 'o/r']);
});

it('S-BTN-230: a GitLab MR leaves marker trees to git, bound to the observed head', async () => {
  const content = 'a'.repeat(40), marker = 'b'.repeat(40), tree = 'c'.repeat(40), parent = 'd'.repeat(40);
  const branch = 'claude/B-1-patch', path = 'o/group/r';
  const date = '2026-11-22T20:00:00Z';
  const body = `gate\n\nBaton-Tests: green\nBaton-Tested: ${content}\nBaton-Claim: n1`;
  const client = forgeReader({ log: () => {}, owns: () => true, pushers: [] })({ forge: 'gitlab', path, webBase: `https://lab.example/${path}` }, {
    env: { GITLAB_TOKEN: 'fake' },
    fetchImpl: async (url) => {
      const endpoint = new URL(String(url)).pathname;
      if (endpoint.endsWith('/merge_requests')) return Response.json([{ iid: 1, state: 'opened', source_project_id: 17, target_project_id: 17, source_branch: branch, sha: marker, web_url: `https://lab.example/${path}/-/merge_requests/1` }]);
      if (endpoint.endsWith('/1/commits')) return Response.json([{ id: marker, parent_ids: [content], message: body, committed_date: date }]);
      if (endpoint.endsWith('/notes') || endpoint.endsWith('/statuses')) return Response.json([]);
      throw new Error(`unexpected endpoint ${endpoint}`);
    },
  });
  const [fact] = await client.facts({ tickets: ['B-1'] });
  expect(fact.commits).toBeUndefined();
  const git = (args: string[]) => {
    if (args[0] === 'fetch') expect(args.at(-1)).toBe(`refs/heads/${branch}`);
    else if (args[0] === 'rev-parse') return marker;
    else if (args[0] === 'log') return `${marker}\x1f${content}\x1f${tree}\x1f20\x1f${body}\x1e${content}\x1f${parent}\x1f${tree}\x1f10\x1fwork\x1e`;
    return '';
  };
  const commits = readHomePrCommits(git, fact.head, fact.headOid);
  const counted = verifiedMarkers(commits, 'B-1', [{ ticket: 'B-1', leg: 'run-tests', claim_nonce: 'n1', evidence: marker }]);
  expect(gateOfBranch(commits, counted)).toBe('green');
  expect(() => readHomePrCommits(git, fact.head, content)).toThrow('the branch moved');
});
