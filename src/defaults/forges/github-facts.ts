import type { CodeRepoEntry, PrFact } from '../course-pr';
import type { BranchCommit } from '../pr-markers';
import type { FactContext, FactRead, ForgeRepo } from './types';

/** How long one GitHub or token call may take before the sync fails (§6.3's bound). */
const FETCH_TIMEOUT_MS = 30_000;
/** The most pages of 100 one list may span; beyond it the sync fails rather than truncate. */
const MAX_PAGES = 50;
/** The most GitHub requests one sync run may make. An Actions `GITHUB_TOKEN` has 1,000 an
 * hour and the workflow runs at least four times an hour, so a run stays well inside a quarter;
 * one that would need more fails before it is spent rather than starve the next runs. */
const MAX_REQUESTS = 200;
/** R-BTN-139's pre-filter: the `author_association` values that cannot push, dropped without a
 * read. Every other author is asked of the forge — a private org member reads as `CONTRIBUTOR` to
 * a token outside the org, so the association alone never makes an author trusted (B-119). */
const CANNOT_PUSH = new Set(['NONE', 'FIRST_TIMER', 'FIRST_TIME_CONTRIBUTOR', 'MANNEQUIN']);
/** R-BTN-139: the collaborator permissions that can push to the base. */
const PUSHERS = new Set(['admin', 'write']);
/** The most PRs one GraphQL query reads (B-35). One PR asks for up to 10 check suites of 100 runs
 * and 100 each of commits, reviews and comments — 15 connection requests, so a full batch is 375,
 * about 4 of the token's GraphQL points an hour, and some 32,500 nodes, far inside GitHub's
 * 500,000 a query; 25 keeps a query's cost and answer small while one query serves most
 * repositories' owned PRs. */
const GRAPHQL_BATCH = 25;

/** The detail of one PR that a GraphQL batch asks for (B-35): the head commit's check runs, the
 * commits' dates, the reviews and the issue comments — the four REST lists it replaces, each a
 * first page (10 check suites of 100 runs; 100 commits, reviews, comments) with `hasNextPage`,
 * so an overflowing one is read over REST in full. The
 * check runs come through the head's check suites (the latest run of each check, as REST's
 * check-runs list gives them), never `statusCheckRollup`, which takes in commit statuses too and
 * so may need a permission the sync workflow does not grant: `checks: read` covers this, as it
 * covered the REST read. */
const PR_DETAIL = `fragment D on PullRequest {
  head: commits(last: 1) { nodes { commit { oid checkSuites(first: 10) { pageInfo { hasNextPage } nodes { checkRuns(first: 100, filterBy: { checkType: LATEST }) { pageInfo { hasNextPage } nodes { status conclusion } } } } } } }
  commits(first: 100) { pageInfo { hasNextPage } nodes { commit { oid committedDate message tree { oid } parents(first: 1) { nodes { oid tree { oid } } } } } }
  reviews(first: 100) { pageInfo { hasNextPage } nodes { author { login } authorAssociation state submittedAt body } }
  comments(first: 100) { pageInfo { hasNextPage } nodes { author { login } authorAssociation createdAt body } }
}`;

/** The GraphQL query reading `numbers`' detail in one repository, each PR under alias `p<n>`. */
const detailQuery = (numbers: number[]): string =>
  `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${numbers.map((n) => `p${n}: pullRequest(number: ${n}) { ...D }`).join(' ')} } }\n${PR_DETAIL}`;

function githubConn(host: string): { host: string; rest: string; graphql: string } {
  return host === 'github.com'
    ? { host, rest: 'https://api.github.com', graphql: 'https://api.github.com/graphql' }
    : { host, rest: `https://${host}/api/v3`, graphql: `https://${host}/api/graphql` };
}

/** The existing GraphQL detail reader, with one budget and permission cache per sync. */
export function githubFactReader({ log, owns, pushers: listedPushers }: FactContext) {
  // B-182: the request budget is per host (R-BTN-96) — a second forge's reading never spends the
  // first's token down, and one host's overflow refuses before its budget is spent.
  const requests = new Map<string, number>();
  /** One request of its host's budget, REST or GraphQL alike: past it the sync refuses. */
  const spend = (host: string): void => {
    const n = (requests.get(host) ?? 0) + 1;
    requests.set(host, n);
    if (n > MAX_REQUESTS) throw new Error(`GitHub (${host}): this sync would need more than ${MAX_REQUESTS} requests — refusing before the token's hourly budget is spent`);
  };
  /** `res`, or the error a failed one is: its status, and whether it is a rate limit — GitHub's
   *  403 or 429 with no requests left, or a secondary limit's retry-after — which `list` reads. */
  const checked = (res: Response, what: string): Response => {
    const limited = res.headers.get('x-ratelimit-remaining') === '0' || res.headers.has('retry-after');
    if (!res.ok) throw Object.assign(new Error(`GitHub ${what}: ${res.status}${limited ? ' (rate limited)' : ''}`), { status: res.status, limited });
    return res;
  };
  const get = async (conn: { host: string; rest: string; token: string }, url: string): Promise<Response> => {
    spend(conn.host);
    return checked(await fetch(url, { headers: { Authorization: `Bearer ${conn.token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'baton-sync' }, redirect: 'error', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }), url);
  };
  /** One GraphQL query, one request of the budget (B-35). An answer carrying `errors` fails the
   *  sync, as a failed REST read does: no partial reading is posted — except, B-226, errors that
   *  are all a refusal of a head's check suites (`checksRefused`): a fine-grained token cannot
   *  hold Checks, so on a private repository GitHub answers everything else and refuses those.
   *  Such an answer is returned with `checksRefused` set, and the caller reads the checks from
   *  the head's workflow runs instead. Every error names its path, so a refusal says what. */
  const graphql = async (conn: { host: string; graphql: string; token: string }, query: string, variables: Record<string, unknown>): Promise<{ data: any; checksRefused: boolean }> => {
    spend(conn.host);
    const res = checked(await fetch(conn.graphql, { method: 'POST', headers: { Authorization: `Bearer ${conn.token}`, 'Content-Type': 'application/json', 'User-Agent': 'baton-sync' }, body: JSON.stringify({ query, variables }), redirect: 'error', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }), `${conn.graphql} (${String(variables.owner)}/${String(variables.name)})`);
    const body = (await res.json()) as { data?: any; errors?: { message?: string; type?: string; path?: (string | number)[] }[] };
    const errors = body.errors ?? [];
    const checksRefused = errors.length > 0 && body.data != null && errors.every((e) => e.type === 'FORBIDDEN' && (e.path ?? []).includes('checkSuites'));
    if (errors.length && !checksRefused) {
      throw new Error(`GitHub GraphQL (${String(variables.owner)}/${String(variables.name)}): ${errors.map((e) => `${e.message ?? '?'}${e.path?.length ? ` (at ${e.path.join('.')})` : ''}`).join('; ')}`);
    }
    return { data: body.data, checksRefused };
  };
  /** B-226: the repositories whose check runs this token may not read — a fine-grained token on a
   *  private repository, which GitHub offers no Checks permission. Their heads' checks are the
   *  head commit's Actions workflow runs (Actions: read), said once a repository. */
  const checksFromActions = new Set<string>();
  /** The head's checks as its workflow runs give them: a run's conclusion once it has completed,
   *  null while it runs — the same "finished or not" the check runs answer. Refused too (no
   *  Actions: read), the sync fails naming both permissions. */
  const actionChecks = async (conn: { host: string; rest: string; token: string }, repo: string, sha: string): Promise<(string | null)[]> => {
    try {
      const runs = await all<any>(conn, `/repos/${repo}/actions/runs?head_sha=${sha}`, (b) => b.workflow_runs);
      return runs.map((r) => (r.status === 'completed' && r.conclusion ? String(r.conclusion) : null));
    } catch (e) {
      const { status, limited } = e as { status?: number; limited?: boolean };
      if (status === 403 && !limited) throw new Error(`${(e as Error).message} — ${repo}: this token can read neither the head's check runs (Checks, which a fine-grained token cannot hold) nor its workflow runs (give it Actions: read)`);
      throw e;
    }
  };
  /** Every item of a paged list; `pick` takes a page's items from its body. */
  const all = async <T>(conn: { host: string; rest: string; token: string }, path: string, pick: (body: any) => T[] = (b) => b as T[]): Promise<T[]> => {
    const out: T[] = [];
    let url: string | null = `${conn.rest}${path}${path.includes('?') ? '&' : '?'}per_page=100`;
    for (let page = 0; url != null; page++) {
      if (page === MAX_PAGES) throw new Error(`GitHub ${path}: more than ${MAX_PAGES * 100} items — the sync will not post a truncated reading`);
      const res = await get(conn, url);
      const items = pick(await res.json());
      if (!Array.isArray(items) || items.length > 100) throw new Error(`GitHub ${path}: malformed page`);
      out.push(...items);
      url = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '')?.[1] ?? null;
      if (url && !url.startsWith(`${conn.rest}/`)) throw new Error('GitHub pagination left its API');
    }
    return out;
  };
  /** R-BTN-139, B-182: whether `login` counts on `conn`'s host — one of two independent ways.
   *  An immutable forge user id in the owners' `pushers` for that host counts on its own
   *  (`idOf` below reads it), whatever `author_association` says and without a collaborator
   *  read. The other way is someone the forge reports can push to the repository (the
   *  collaborator permission, read once per author per repository per run); a 404 is no
   *  collaborator, which leaves only the listed-id way. A 403 that is no rate limit is a token
   *  without the scope: it degrades, failing closed — no verdict of that repository counts,
   *  said once. Any other failure aborts the run, which posts nothing. */
  const pushers = new Map<string, Promise<boolean>>();
  const unreadable = new Set<string>();
  const pusherIds = new Map<string, Set<string>>();
  for (const p of listedPushers) {
    const set = pusherIds.get(p.host) ?? new Set<string>();
    set.add(p.id);
    pusherIds.set(p.host, set);
  }
  /** The author's immutable id on `conn`'s host, or null when none is at hand — the fact's own
   *  when it carries one (REST lists do; GraphQL's `User.id` is the base64 node id, not the
   *  numeric one `pushers` holds, so GraphQL facts take the read), else one user read
   *  (`GET /users/{login}`), budgeted and cached per author per run, answered only while that
   *  host lists some pusher id to match against — a host that lists none never looks an author
   *  up, so every existing deployment reads byte for byte as before. A failed read answers
   *  null: the listed way fails closed. */
  const ids = new Map<string, Promise<string | null>>();
  const idOf = async (conn: { host: string; rest: string; token: string }, login: string, carried?: unknown): Promise<string | null> => {
    if (!(pusherIds.get(conn.host)?.size)) return null;
    if (typeof carried === 'number' || typeof carried === 'string') return String(carried);
    const key = `${conn.host}\u0000${login}`;
    if (!ids.has(key)) {
      ids.set(key, get(conn, `${conn.rest}/users/${encodeURIComponent(login)}`)
        .then(async (res) => {
          const b = (await res.json()) as { id?: unknown };
          return b.id == null ? null : String(b.id);
        })
        .catch(() => null));
    }
    return ids.get(key)!;
  };
  const canPush = (conn: { host: string; rest: string; token: string }, repo: string, login: string): Promise<boolean> => {
    const key = `${conn.host}\u0000${repo.toLowerCase()}\u0000${login}`;
    if (!pushers.has(key)) {
      pushers.set(key, get(conn, `${conn.rest}/repos/${repo}/collaborators/${encodeURIComponent(login)}/permission`)
        .then(async (res) => {
          const body = (await res.json()) as { permission?: unknown; user?: { id?: unknown } };
          const listed = body.user?.id != null && (pusherIds.get(conn.host) ?? new Set()).has(String(body.user.id));
          return listed || PUSHERS.has(String(body.permission));
        })
        .catch((e) => {
          const { status, limited } = e as { status?: number; limited?: boolean };
          if (status === 404) return false;
          if (status === 403 && !limited) {
            if (!unreadable.has(repo.toLowerCase())) log(`baton: ${repo}: this token cannot read collaborator permissions (403) — no verdict there counts (R-BTN-139, fail closed)`);
            unreadable.add(repo.toLowerCase());
            return false;
          }
          throw e;
        }));
    }
    return pushers.get(key)!;
  };
  /** The facts whose author is trusted, in their order (R-BTN-139) — a listed immutable id
   *  first, one of the two ways on its own, then the forge's own report, which
   *  `author_association` pre-filters. An author GitHub no longer names (a deleted account)
   *  cannot be asked, so does not count. */
  const trustedOnly = async <T extends { login?: string | null; userId?: unknown; association?: string }>(conn: { host: string; rest: string; token: string }, repo: string, facts: T[]): Promise<T[]> => {
    const out: T[] = [];
    for (const f of facts) {
      if (f.login == null) continue;
      const id = await idOf(conn, f.login, f.userId);
      if (id != null && (pusherIds.get(conn.host) ?? new Set()).has(id)) out.push(f);
      else if (!CANNOT_PUSH.has(String(f.association)) && (await canPush(conn, repo, f.login))) out.push(f);
    }
    return out;
  };
  return async (target: ForgeRepo, read: FactRead, token: string): Promise<PrFact[]> => {
    const out = await repoFacts({ ...githubConn(new URL(target.webBase).host), token }, target.path, read.tickets, read.entry);
    log(`baton: read ${out.length} PRs of ${target.path} (${[...requests].map(([host, n]) => `${n} requests of ${host}`).join(', ')})`);
    return out;
  };

  async function repoFacts(conn: { host: string; rest: string; graphql: string; token: string }, repo: string, tickets: string[], entry?: CodeRepoEntry): Promise<PrFact[]> {
    // B-182 (R-BTN-138): the ids decide at every read. The forge's own ids for the repository
    // are compared with the entry's; a mismatch — a path re-created by someone else — fails the
    // sync naming the entry, so the re-created path never gains reach.
    if (entry != null) {
      const res = (await (await get(conn, `${conn.rest}/repos/${repo}`)).json()) as { id?: unknown; owner?: { id?: unknown } };
      const seen = `${String(res.id ?? '?')}/${String(res.owner?.id ?? '?')}`;
      if (String(res.id ?? '') !== entry.repo_id || String(res.owner?.id ?? '') !== entry.owner_id) {
        throw new Error(`GitHub (${entry.host}) reports ids ${seen} for ${repo}, but its code_repos entry holds ${entry.repo_id}/${entry.owner_id} — the path was re-created or moved; the sync fails rather than read the wrong repository (R-BTN-138: the ids decide)`);
      }
    }
    const listed = await list(conn, repo, tickets);
    // Only a PR a live ticket owns needs its detail read; any other PR places no ticket and is
    // recorded from the list alone, so the requests a run makes grow with the live tickets, not
    // with the repository's history. A closed unmerged PR a live ticket owns is read too:
    // `create-pr` counts it as none (R-BTN-74), but `review-pr` concludes on it, and reads its
    // conclusion line from its comments.
    const owned = listed.filter((pr) => owns({ number: pr.number, head: pr.head.ref, repository: repo }));
    const detail = new Map<number, Omit<PrFact, 'number' | 'head' | 'state' | 'repository'>>();
    // The owned PRs' detail, GRAPHQL_BATCH to a query (B-35): one request where REST took four a PR.
    for (let i = 0; i < owned.length; i += GRAPHQL_BATCH) {
      const batch = owned.slice(i, i + GRAPHQL_BATCH);
      const [owner, name] = repo.split('/');
      const { data, checksRefused } = await graphql(conn, detailQuery(batch.map((pr) => pr.number)), { owner, name });
      if (checksRefused && !checksFromActions.has(repo.toLowerCase())) {
        checksFromActions.add(repo.toLowerCase());
        log(`baton: ${repo}: this token cannot read check runs (a fine-grained token holds no Checks) — its PRs' checks are their heads' workflow runs (B-226)`);
      }
      for (const pr of batch) detail.set(pr.number, await detailOf(conn, repo, pr, data?.repository?.[`p${pr.number}`]));
    }
    return listed.map((pr) => {
      const state: PrFact['state'] = pr.merged_at ? 'merged' : pr.state === 'closed' ? 'closed' : 'open';
      return { number: pr.number, head: pr.head.ref, state, ...(detail.get(pr.number) ?? { pushedAt: 0, checks: [], reviews: [] }), repository: repo, ...(typeof pr.html_url === 'string' ? { url: pr.html_url } : {}) };
    });
  }

  /** One PR's facts from its GraphQL node, mapped exactly as the REST lists are; a connection
   *  whose first page overflows, or a head the batch read at another commit, is read over REST. */
  async function detailOf(conn: { host: string; rest: string; graphql: string; token: string }, repo: string, pr: any, node: any): Promise<Omit<PrFact, 'number' | 'head' | 'state' | 'repository'>> {
    if (node == null) throw new Error(`GitHub GraphQL (${repo}): no pull request #${pr.number}, though the list has it`);
    const head = node.head?.nodes?.[0]?.commit;
    const suites = head?.checkSuites;
    const overflow = suites?.pageInfo?.hasNextPage || (suites?.nodes ?? []).some((cs: any) => cs?.checkRuns?.pageInfo?.hasNextPage);
    const checks = checksFromActions.has(repo.toLowerCase())
      ? await actionChecks(conn, repo, pr.head.sha)
      : head?.oid !== pr.head.sha || overflow
      ? (await all<any>(conn, `/repos/${repo}/commits/${pr.head.sha}/check-runs`, (b) => b.check_runs)).map((c) => c.conclusion ?? null)
      // A run not yet completed has no conclusion: null, as the REST list gives it.
      : (suites?.nodes ?? []).flatMap((cs: any) => cs?.checkRuns?.nodes ?? []).map((c: any) => (c.status === 'COMPLETED' && c.conclusion ? String(c.conclusion).toLowerCase() : null));
    // A push is read from its commits' own dates, never `updated_at`, which a comment moves.
    // B-110: the commits themselves too — sha, first parent, whether the tree changed, message —
    // for the run-tests gate's markers, which the station function counts only as the evidence
    // Baton recorded (a counted marker is no push; anything else is, whatever its message).
    type CommitNode = { oid: string; at: string; message: string; tree: string | null; parent: string | null; parentTree: string | null };
    const commitNodes: CommitNode[] = node.commits.pageInfo.hasNextPage
      ? (await all<any>(conn, `/repos/${repo}/pulls/${pr.number}/commits`)).map((c: any) => ({
        oid: c.sha, at: c.commit.committer.date, message: c.commit.message, tree: c.commit.tree?.sha ?? null, parent: c.parents?.[0]?.sha ?? null, parentTree: null,
      }))
      : node.commits.nodes.map((c: any) => ({
        oid: c.commit.oid, at: c.commit.committedDate, message: c.commit.message, tree: c.commit.tree?.oid ?? null,
        parent: c.commit.parents?.nodes?.[0]?.oid ?? null, parentTree: c.commit.parents?.nodes?.[0]?.tree?.oid ?? null,
      }));
    const treeOf = new Map(commitNodes.map((c) => [c.oid, c.tree]));
    const commits: BranchCommit[] = commitNodes.map((c) => {
      const parentTree = c.parentTree ?? (c.parent ? treeOf.get(c.parent) ?? null : null);
      return { sha: c.oid, at: Date.parse(c.at), parent: c.parent, empty: c.tree != null && parentTree != null && c.tree === parentTree, message: c.message ?? '' };
    });
    const pushes = commits.map((c) => c.at);
    // A verdict counts only from someone who can push to the repository (R-BTN-139) — never a
    // drive-by comment on a public PR. The REST mappings carry `user.id` too: an author's
    // immutable id is the owners' `pushers`' other way to count, consulted before any
    // collaborator read (the GraphQL mapping has no numeric id to carry; `idOf` reads it).
    const reviews = (await trustedOnly(conn, repo, node.reviews.pageInfo.hasNextPage
      ? (await all<any>(conn, `/repos/${repo}/pulls/${pr.number}/reviews`)).map((r) => ({ login: r.user?.login, userId: r.user?.id, association: r.author_association, state: r.state, at: r.submitted_at, body: r.body }))
      : node.reviews.nodes.map((r: any) => ({ login: r.author?.login, association: r.authorAssociation, state: r.state, at: r.submittedAt, body: r.body }))))
      .map((r: any) => ({ author: r.login ?? '?', state: r.state, submittedAt: Date.parse(r.at), body: r.body ?? '' }));
    const comments = (await trustedOnly(conn, repo, node.comments.pageInfo.hasNextPage
      ? (await all<any>(conn, `/repos/${repo}/issues/${pr.number}/comments`)).map((c) => ({ login: c.user?.login, userId: c.user?.id, association: c.author_association, at: c.created_at, body: c.body }))
      : node.comments.nodes.map((c: any) => ({ login: c.author?.login, association: c.authorAssociation, at: c.createdAt, body: c.body }))))
      .map((c: any) => ({ author: c.login ?? '?', state: 'COMMENTED' as const, submittedAt: Date.parse(c.at), body: c.body ?? '' }));
    return { pushedAt: Math.max(0, ...pushes), pushes, checks, reviews: [...reviews, ...comments], commits };
  }

  /** A repository's PRs. A named repository whose list GitHub refuses (403) or does not find
   *  (404) fails the whole sync — no partial reading — naming the tickets whose `repos:` name it;
   *  any other failure, as a timeout, a 5xx, a rate limit or the budget, is passed through as it is. */
  async function list(conn: { host: string; rest: string; graphql: string; token: string }, repo: string, tickets: string[]): Promise<any[]> {
    try {
      const author = process.env.BATON_PR_AUTHOR;
      if (author) return await byAuthor(conn, repo, author);
      return await all<any>(conn, `/repos/${repo}/pulls?state=all`);
    } catch (e) {
      const { status, limited } = e as { status?: number; limited?: boolean };
      if (!tickets.length || limited || (status !== 403 && status !== 404)) throw e;
      throw new Error(`${(e as Error).message} — ${repo} is named in repos: by ${tickets.join(', ')}; the sync's token cannot read it, or it does not exist`);
    }
  }

  /** `BATON_PR_AUTHOR`: only that login's PRs, for a repository whose full PR list is longer than
   *  the sync reads (MAX_PAGES). The leg agents open PRs as the operator, so a PR a ticket owns is
   *  among them. GraphQL search, 100 a request, mapped to the REST fields `repoFacts` reads. */
  async function byAuthor(conn: { host: string; rest: string; graphql: string; token: string }, repo: string, author: string): Promise<any[]> {
    const query = `query($q: String!, $after: String) { search(query: $q, type: ISSUE, first: 100, after: $after) {
      issueCount pageInfo { hasNextPage endCursor }
      nodes { ... on PullRequest { number headRefName headRefOid state mergedAt } } } }`;
    const [owner, name] = repo.split('/');
    const out: any[] = [];
    let after: string | null = null;
    for (;;) {
      const s: any = (await graphql(conn, query, { q: `repo:${repo} is:pr author:${author}`, after, owner, name })).data?.search;
      // Search answers at most 1000 results: past that the reading would be truncated.
      if ((s?.issueCount ?? 0) > 1000) throw new Error(`GitHub search (${repo}, author ${author}): ${s.issueCount} PRs, past search's 1000 — the sync will not post a truncated reading`);
      for (const n of s?.nodes ?? []) {
        if (n?.number == null) continue;
        out.push({ number: n.number, head: { ref: n.headRefName, sha: n.headRefOid }, state: n.state === 'OPEN' ? 'open' : 'closed', merged_at: n.mergedAt });
      }
      if (!s?.pageInfo?.hasNextPage) return out;
      after = s.pageInfo.endCursor;
    }
  }
}
