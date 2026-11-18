// forge.test.ts — the request command's forge adapters (B-174, BATON_SPEC §5.8 R-BTN-131,
// §12.8 R-BTN-180): which refusals say "protected", each forge recognised by its own words;
// which adapter decides (the one --forge names, else github on github.com); and the one call
// that opens the request's PR with the caller's forge credential. Pure: the refusals are git's
// recorded stderr, the PR answers an injected fetch — the pushed branches and real git are
// request-protected.test.ts's, through the command itself.
import { describe, expect, it } from 'vitest';
import { forgeApi, hostOf, NAMED_FORGES, openRequestPr, protectedRefusal, requestForge, tokenOf } from '../../src/defaults/forge';

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
  it('GitHub: GH006, and GH013 naming an update rule — never secret push protection', () => {
    expect(protectedRefusal('github', REFUSALS.gh006)).toBe(true);
    expect(protectedRefusal('github', REFUSALS.gh013PullRequest)).toBe(true);
    expect(protectedRefusal('github', REFUSALS.gh013Checks)).toBe(true);
    // A GH013 about content, not about how the branch updates: a PR does not answer it.
    expect(protectedRefusal('github', REFUSALS.gh013Secrets)).toBe(false);
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
    // A local path or file:// remote is no forge's.
    expect(hostOf('/srv/git/baton.git')).toBeNull();
    expect(hostOf('file:///srv/git/baton.git')).toBeNull();
  });

  it('github where origin is on github.com; nothing for any other host or a local path', () => {
    expect(requestForge(undefined, 'https://github.com/immediately-run/baton')).toBe('github');
    expect(requestForge(undefined, 'git@github.com:immediately-run/baton')).toBe('github');
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
      const { seen, fetchImpl } = answer(201, { [wants]: `https://forge/pr/7` });
      const got = await openRequestPr({ forge, host: forge === 'github' ? 'github.com' : `${forge}.com`, repo: 'immediately-run/baton', head: 'baton-request/B-1', base: 'main', title: 'T' }, 'tok', fetchImpl);
      expect(got).toBe('https://forge/pr/7');
      expect(seen[0].method).toBe('POST');
      expect(seen[0].url).toBe(url);
      expect(seen[0].headers.get('authorization')).toBe('Bearer tok');
      expect(JSON.parse(await seen[0].text())).toEqual(body);
    }
  });

  it('a GitHub Enterprise host serves its API under its own name; each forge names its token', () => {
    expect(forgeApi('github', 'github.company.com')).toBe('https://github.company.com/api/v3');
    expect(forgeApi('gitlab', 'gitlab.company.com')).toBe('https://gitlab.company.com/api/v4');
    expect(forgeApi('gitea', 'gitea.company.com')).toBe('https://gitea.company.com/api/v1');
    expect(tokenOf('github')).toBe('GITHUB_TOKEN');
    expect(tokenOf('gitlab')).toBe('GITLAB_TOKEN');
    expect(tokenOf('gitea')).toBe('GITEA_TOKEN');
  });

  it('a refusal is one line naming the forge, its answer, and the branch that is pushed', async () => {
    const { fetchImpl } = answer(403, { message: 'Resource not accessible by integration' });
    await expect(
      openRequestPr({ forge: 'github', host: 'github.com', repo: 'immediately-run/baton', head: 'baton-request/B-2', base: 'main', title: 'T' }, 'tok', fetchImpl),
    ).rejects.toThrow('github (github.com) answered 403 opening the PR from baton-request/B-2: Resource not accessible by integration — the request is pushed on baton-request/B-2; open the PR yourself');
  });
});
