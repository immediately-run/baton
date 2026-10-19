// A recorded api.github.com for the GitHub adapter's tests (R-BTN-96; B-35). Routes are REST-shaped:
// a path without host or per_page maps to its JSON, and a `[json, next]` pair answers with a Link to
// the next page. A POST to /graphql is answered from the same routes — each `p<n>: pullRequest(number:
// n)` alias built from that PR's check-runs, commits, reviews and comments routes, as GitHub's GraphQL
// would give them — so one fixture states a PR's facts for both paths, and a REST list of more than
// 100 items is a connection whose first page overflows.

type Routes = Record<string, unknown>;

const page = (r: unknown): [unknown, string | null] =>
  (Array.isArray(r) && r.length === 2 && typeof r[1] === 'string' && r[1].startsWith('/') ? (r as [unknown, string]) : [r, null]);

/** Every item of a REST list route, following its `[json, next]` pages. */
function items(routes: Routes, path: string, pick: (b: any) => any[] = (b) => b): any[] | null {
  if (!(path in routes)) return null;
  const out: any[] = [];
  for (let p: string | null = path; p != null && p in routes;) {
    const [body, next] = page(routes[p]);
    out.push(...pick(body));
    p = next;
  }
  return out;
}

const first = (list: any[]) => ({ pageInfo: { hasNextPage: list.length > 100 }, nodes: list.slice(0, 100) });

/** One PR's GraphQL node from its REST routes in `repo`; null when the list does not have it. */
function prNode(routes: Routes, repo: string, n: number): unknown {
  const pr = (items(routes, `/repos/${repo}/pulls?state=all`) ?? []).find((p) => p.number === n);
  if (pr == null) return null;
  const runs = items(routes, `/repos/${repo}/commits/${pr.head.sha}/check-runs`, (b) => b.check_runs) ?? [];
  const commits = items(routes, `/repos/${repo}/pulls/${n}/commits`) ?? [];
  const reviews = items(routes, `/repos/${repo}/pulls/${n}/reviews`) ?? [];
  const comments = items(routes, `/repos/${repo}/issues/${n}/comments`) ?? [];
  return {
    // One check suite holding every run; a list of more than 100 runs overflows its first page.
    head: { nodes: [{ commit: { oid: pr.head.sha, checkSuites: { pageInfo: { hasNextPage: false }, nodes: runs.length ? [{ checkRuns: first(runs.map((c) => (c.conclusion == null ? { status: 'IN_PROGRESS', conclusion: null } : { status: 'COMPLETED', conclusion: String(c.conclusion).toUpperCase() }))) }] : [] } } }] },
    commits: first(commits.map((c) => ({ commit: { committedDate: c.commit.committer.date } }))),
    reviews: first(reviews.map((r) => ({ author: r.user ? { login: r.user.login } : null, authorAssociation: r.author_association, state: r.state, submittedAt: r.submitted_at, body: r.body }))),
    comments: first(comments.map((c) => ({ author: c.user ? { login: c.user.login } : null, authorAssociation: c.author_association, createdAt: c.created_at, body: c.body }))),
  };
}

/** A fetch answering `routes`; `calls` records each request as its REST key, or `graphql <owner/name> <numbers>`. */
export function githubFake(routes: Routes, calls: string[] = []) {
  return async (url: string, init?: { method?: string; body?: string }): Promise<Response> => {
    const u = new URL(url);
    if (u.pathname === '/graphql') {
      const { query, variables } = JSON.parse(String(init?.body)) as { query: string; variables: { owner: string; name: string } };
      const repo = `${variables.owner}/${variables.name}`;
      const numbers = [...query.matchAll(/p(\d+): pullRequest\(number: (\d+)\)/g)].map((m) => Number(m[2]));
      calls.push(`graphql ${repo} ${numbers.join(',')}`);
      if (!(`/repos/${repo}/pulls?state=all` in routes)) return Response.json({ data: { repository: null }, errors: [{ type: 'NOT_FOUND', message: `Could not resolve to a Repository with the name '${repo}'.` }] });
      return Response.json({ data: { repository: Object.fromEntries(numbers.map((n) => [`p${n}`, prNode(routes, repo, n)])) } });
    }
    u.searchParams.delete('per_page');
    const key = `${u.pathname}${u.search}`;
    calls.push(key);
    if (!(key in routes)) return new Response('{}', { status: 404 });
    const [body, next] = page(routes[key]);
    return new Response(JSON.stringify(body), { headers: next ? { link: `<https://api.github.com${next}>; rel="next"` } : {} });
  };
}
