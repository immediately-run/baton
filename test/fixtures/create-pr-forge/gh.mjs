#!/usr/bin/env node
// Only the commands this course and its scripted agent use. Never falls through to real gh.
const [group, command, target, ...flags] = process.argv.slice(2);
const option = (flag) => {
  const args = process.argv.slice(2);
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};
const { TEST_FORGE_URL: origin, TEST_FORGE_REPO: repo } = process.env;
const pr = new RegExp(`^https://github\\.com/${repo}/pull/(\\d+)$`).exec(target)?.[1];
const root = `/repos/${repo}`;
async function request(path, method = 'GET', body) {
  const res = await fetch(`${origin}${root}${path}`, { method, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message ?? `forge answered ${res.status} for ${path}`);
  return json;
}
try {
  if (group === 'pr' && command === 'list' && option('--repo') === repo) {
    const fields = option('--json').split(',');
    const prs = await request('/pulls?state=all');
    const rows = prs.map((p) => ({
      number: p.number, headRefName: p.head.ref, headRefOid: p.head.sha, baseRefName: p.base.ref,
      isCrossRepository: p.head.repo.id !== p.base.repo.id, state: p.merged_at ? 'MERGED' : p.state.toUpperCase(),
    }));
    console.log(JSON.stringify(rows.filter((p) => option('--state') === 'all' || p.state.toLowerCase() === option('--state'))
      .map((p) => Object.fromEntries(fields.map((key) => [key, p[key]])))));
  } else if (group === 'pr' && command === 'comment' && pr && flags[0] === '--body') {
    console.log((await request(`/issues/${pr}/comments`, 'POST', { body: flags[1] })).html_url);
  } else if (group === 'pr' && command === 'merge' && pr) {
    await request(`/pulls/${pr}/merge`, 'PUT');
  } else {
    throw new Error(`unsupported fake gh: ${process.argv.slice(2).join(' ')}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
