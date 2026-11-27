import { once } from 'node:events';
import { createServer } from 'node:http';
import { githubFake } from '../githubFake';

export const CODE_REPO = 'acme/code';
export const PR_URL = `https://github.com/${CODE_REPO}/pull/7`;
const api = `/repos/${CODE_REPO}`;
const author = { login: 'fixture-bot', id: 91 };
const ids = { id: 7001, owner: { id: 31 }, default_branch: 'main' };

/** One in-memory forge. gh and the sync see the same comments, PR and merge state. */
export async function createPrForge(sha: string, now: () => number) {
  const pr = {
    number: 7, html_url: PR_URL, state: 'open', merged_at: null as string | null,
    head: { ref: 'claude/T-1-fixture', sha, repo: { id: ids.id } },
    base: { ref: 'main', repo: { id: ids.id } },
  };
  const comments: { id: number; html_url: string; user: typeof author; author_association: string; body: string; created_at: string }[] = [];
  const reviews: unknown[] = [];
  const checks: { conclusion: string | null }[] = [{ conclusion: 'success' }];
  const merge = { refusal: null as string | null, attempts: 0 };
  const calls: string[] = [];
  const routes: Record<string, unknown> = {
    [api]: ids,
    [`${api}/pulls?state=all`]: [pr],
    [`${api}/pulls/7/commits`]: [{ sha, commit: { committer: { date: new Date(now() - 1000).toISOString() }, message: 'fixture work' } }],
    [`${api}/pulls/7/reviews`]: reviews,
    [`${api}/issues/7/comments`]: comments,
    [`${api}/commits/${sha}/check-runs`]: { check_runs: checks },
    [`${api}/collaborators/${author.login}/permission`]: { permission: 'write', user: author },
  };
  const read = githubFake(routes, calls);
  const server = createServer(async (req, res) => {
    try {
      let body = '';
      for await (const chunk of req) body += chunk;
      const path = req.url;
      let answer;
      if (req.method === 'POST' && path === `${api}/issues/7/comments`) {
        const id = 1000 + comments.length;
        const comment = { id, html_url: `${PR_URL}#issuecomment-${id}`, user: author, author_association: 'MEMBER',
          body: JSON.parse(body).body, created_at: new Date(now()).toISOString() };
        comments.push(comment);
        routes[`${api}/issues/comments/${id}`] = comment;
        answer = Response.json(comment, { status: 201 });
      } else if (req.method === 'PUT' && path === `${api}/pulls/7/merge`) {
        merge.attempts++;
        const refusal = merge.refusal ?? (checks.some((run) => run.conclusion !== 'success') ? 'required check did not pass' : null);
        if (refusal != null) answer = Response.json({ message: refusal }, { status: 405 });
        else {
          pr.state = 'closed';
          pr.merged_at = new Date(now()).toISOString();
          answer = Response.json({ merged: true });
        }
      } else if (req.method === 'GET' || (req.method === 'POST' && path === '/graphql')) {
        answer = await read(`https://api.github.com${path}`, { method: req.method, body });
      } else {
        answer = Response.json({ message: `unexpected ${req.method} ${path}` }, { status: 404 });
      }
      answer.headers.forEach((value, name) => res.setHeader(name, value));
      res.writeHead(answer.status);
      res.end(await answer.text());
    } catch (error) {
      res.writeHead(500).end(String(error));
    }
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address == null || typeof address === 'string') throw new Error('expected a TCP address');
  return {
    url: `http://127.0.0.1:${address.port}`, calls, pr, comments, reviews, checks, merge,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())),
  };
}
