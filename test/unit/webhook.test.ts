// R3-1247 — GitHub App deliveries (BATON_SPEC §7.1 R-BTN-73): the signature before anything is
// read, the one field parser, the self-filter, the repository map and the trailing dispatch.
// S-BTN-42.
import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { deliverySignature, pickDelivery, verifyDelivery, Webhooks, ACTIONS_BOT, MIRROR_EMAIL } from '../../src/core/webhook';
import { front } from '../../src/core/front';
import { armedAt, ORIGIN, withCore } from '../helpers';

const SECRET = env.BATON_GITHUB_WEBHOOK_SECRET!;
const enc = new TextEncoder();
const delivery = async (body: string, sig?: string) =>
  new Request(`${ORIGIN}/v1/github/webhook`, { method: 'POST', headers: { 'X-Hub-Signature-256': sig ?? (await deliverySignature(SECRET, enc.encode(body))) }, body });
const reason = (p: Promise<unknown>) => p.then(() => 'passed', (e: { code: string }) => e.code);

/** A payload that records every property path read from it. */
function recording(value: unknown, reads: Set<string>, path = ''): unknown {
  if (value === null || typeof value !== 'object') return value;
  return new Proxy(value as object, {
    get(t, k) {
      if (typeof k !== 'string') return Reflect.get(t, k);
      const p = path ? `${path}.${k}` : k;
      reads.add(p);
      return recording((t as Record<string, unknown>)[k], reads, p);
    },
  });
}

describe('the signature comes first (R-BTN-73)', () => {
  it('verifies X-Hub-Signature-256 under the secret; a wrong, missing or malformed one is unauthenticated; no secret, forbidden', async () => {
    const body = '{"repository":{"full_name":"a/b"}}';
    expect(new TextDecoder().decode(await verifyDelivery(await delivery(body), SECRET))).toBe(body);
    expect(await reason(verifyDelivery(await delivery(body, await deliverySignature('other', enc.encode(body))), SECRET))).toBe('unauthenticated');
    expect(await reason(verifyDelivery(await delivery(body, 'sha1=abc'), SECRET))).toBe('unauthenticated');
    expect(await reason(verifyDelivery(new Request(`${ORIGIN}/v1/github/webhook`, { method: 'POST', body }), SECRET))).toBe('unauthenticated');
    expect(await reason(verifyDelivery(await delivery(body), undefined))).toBe('forbidden');
  });

  it('the front reads nothing of a forged delivery and forwards only R-BTN-73’s fields', async () => {
    const seen: (string | null)[] = [];
    const to = async (r: Request) => (seen.push(r.headers.get('X-Baton-Webhook')), new Response('{}'));
    const body = JSON.stringify({ repository: { full_name: 'immediately-run/sandbox' }, comment: { body: 'secret' } });
    const forged = await delivery(body, await deliverySignature('other', enc.encode(body)));
    forged.headers.set('X-GitHub-Event', 'issue_comment');
    expect((await front(forged, env, to)).status).toBe(401);
    expect(seen).toEqual([]);
    const good = await delivery(body);
    good.headers.set('X-GitHub-Event', 'issue_comment');
    good.headers.set('X-GitHub-Delivery', 'abc-1');
    good.headers.set('X-Baton-Webhook', '{"forged":true}');
    expect((await front(good, env, to)).status).toBe(200);
    expect(seen.map((s) => JSON.parse(s!))).toEqual([{ event: 'issue_comment', id: 'abc-1', repository: 'immediately-run/sandbox' }]);
  });
});

describe('a delivery whose fields are not Latin-1 (round 3, 3-A-0)', () => {
  it('goes to the core with the same values', async () => {
    const seen: string[] = [];
    const to = async (r: Request) => (seen.push(r.headers.get('X-Baton-Webhook')!), new Response(null, { status: 204 }));
    const email = 'пётр@example.ru';
    const body = JSON.stringify({ repository: { full_name: 'immediately-run/sandbox' }, pusher: { name: 'pëtr' }, head_commit: { author: { email } } });
    const req = await delivery(body);
    req.headers.set('X-GitHub-Event', 'push');
    req.headers.set('X-GitHub-Delivery', 'u-1');
    expect((await front(req, env, to)).status).toBe(204);
    expect(seen[0]).toMatch(/^[\x20-\x7e]+$/);
    expect(JSON.parse(seen[0])).toEqual({ event: 'push', id: 'u-1', repository: 'immediately-run/sandbox', pusher: 'pëtr', author_email: email });
  });
});

describe('the one parser (R-BTN-73)', () => {
  // Each event's own paths (round 2, 2-A-0): a push's fields are never read from a review.
  const COMMON = ['repository', 'repository.full_name'];
  const ALLOWED: Record<string, Set<string>> = {
    pull_request: new Set([...COMMON, 'pull_request', 'pull_request.merged']),
    pull_request_review: new Set(COMMON),
    workflow_run: new Set([...COMMON, 'workflow_run', 'workflow_run.path']),
    push: new Set([...COMMON, 'pusher', 'pusher.name', 'head_commit', 'head_commit.author', 'head_commit.author.email',
      // B-126 (R-BTN-194): the push's recorded half.
      'sender', 'sender.id', 'sender.login', 'ref', 'before', 'after', 'commits', 'commits.length',
      'commits.0', 'commits.0.id', 'commits.0.added', 'commits.0.removed', 'commits.0.modified']),
  };

  it.each([
    ['pull_request', { repository: { full_name: 'o/r', owner: { login: 'o' } }, pull_request: { merged: true }, sender: { login: 's' }, review: { body: 'b' } }, { repository: 'o/r', merged: true }],
    ['pull_request_review', { repository: { full_name: 'o/r', owner: { login: 'o' } }, review: { body: 'b' }, sender: { login: 's' }, pusher: { name: 'p' }, workflow_run: { path: 'x' } }, { repository: 'o/r' }],
    ['workflow_run', { repository: { full_name: 'o/r' }, workflow_run: { path: '.github/workflows/ci.yml', head_sha: 'x', name: 'ci' } }, { repository: 'o/r', workflow_path: '.github/workflows/ci.yml' }],
    ['push', { repository: { full_name: 'o/r' }, pusher: { name: 'p', email: 'e' }, head_commit: { author: { email: 'a@x', name: 'n' }, message: 'm' }, commits: [{}] }, { repository: 'o/r', pusher: 'p', author_email: 'a@x' }],
    ['push', { repository: { full_name: 'o/r' }, pusher: { name: 'p' }, head_commit: null }, { repository: 'o/r', pusher: 'p', author_email: null }],
  ])('%s: returns its fields and reads nothing else', (event, payload, want) => {
    const reads = new Set<string>();
    expect(pickDelivery(event, 'id-1', recording(payload, reads))).toEqual({ event, id: 'id-1', ...want });
    expect([...reads].filter((r) => !ALLOWED[event].has(r))).toEqual([]);
  });

  it.each([
    ['an event outside the five', 'check_suite', { repository: { full_name: 'o/r' } }],
    ['ping', 'ping', { repository: { full_name: 'o/r' } }],
    ['no repository', 'pull_request', {}],
    ['a full_name that is no owner/name', 'pull_request', { repository: { full_name: 'x' } }],
    ['a workflow_run with no path', 'workflow_run', { repository: { full_name: 'o/r' }, workflow_run: {} }],
    ['a push with no pusher', 'push', { repository: { full_name: 'o/r' }, head_commit: null }],
    ['a payload that is an array', 'pull_request', [{ repository: { full_name: 'o/r' } }]],
  ])('drops %s', (_what, event, payload) => {
    expect(pickDelivery(event, 'id-1', payload)).toBeNull();
  });

  it('drops a delivery with no id or a malformed one', () => {
    expect(pickDelivery('pull_request', null, { repository: { full_name: 'o/r' } })).toBeNull();
    expect(pickDelivery('pull_request', 'a b', { repository: { full_name: 'o/r' } })).toBeNull();
  });

  // B-126 (R-BTN-194): a push's recorded half — the immutable pusher and the commits it brought.
  const B = '0'.repeat(39) + '1';
  const A = 'f'.repeat(40);
  const pushPayload = (over: Record<string, unknown> = {}) => ({
    ref: 'refs/heads/main', before: B, after: A,
    repository: { full_name: 'immediately-run/docs' }, pusher: { name: 'worker' },
    sender: { id: 424242, login: 'immediately-run-worker' },
    head_commit: { id: A, author: { email: 'w@x' } },
    commits: [{ id: A, message: 'm', author: { name: 'Anyone' }, added: ['.baton/baton.json'], removed: [], modified: ['docs/readme.md'] }],
    ...over,
  });

  it('records a push\u2019s pusher and its commits\u2019 paths; reads nothing else of them', () => {
    const reads = new Set<string>();
    expect(pickDelivery('push', 'p-1', recording(pushPayload(), reads))).toEqual({
      event: 'push', id: 'p-1', repository: 'immediately-run/docs', pusher: 'worker', author_email: 'w@x',
      push: { sender_id: 424242, sender_login: 'immediately-run-worker', ref: 'refs/heads/main', before: B, after: A,
        commits: [{ sha: A, paths: ['.baton/baton.json', 'docs/readme.md'] }] },
    });
    expect([...reads].filter((r) => !ALLOWED.push.has(r) && !/^commits(\.\d+)?(\.(id|added|removed|modified)(\.\d+|\.length|\.every)?)?$/.test(r))).toEqual([]);
  });

  it.each([
    ['a sender id that is not a positive integer', pushPayload({ sender: { id: '424242', login: 'x' } })],
    ['a sender id of zero', pushPayload({ sender: { id: 0, login: 'x' } })],
    ['a commit whose id is not a sha', pushPayload({ commits: [{ id: 'abc', added: [] }] })],
    ['a path list that is not strings', pushPayload({ commits: [{ id: A, added: [1] }] })],
    ['a commits list that is not an array', pushPayload({ commits: 'many' })],
  ])('a push whose recorded half does not parse (%s) triggers without a record', (_what, payload) => {
    const d = pickDelivery('push', 'p-2', payload)!;
    expect(d.pusher).toBe('worker');
    expect('push' in d).toBe(false);
  });

  it.each([
    ['no sender at all', pushPayload({ sender: undefined })],
    ['a sender login that is not a string (read as none)', pushPayload({ sender: { id: 1, login: 7 } })],
  ])('a push with no pusher to name (%s) is recorded without one — fail closed, its chain held', (_what, payload) => {
    const d = pickDelivery('push', 'p-2b', payload)!;
    expect(d.push).toMatchObject({ sender_id: payload.sender === undefined ? null : 1, ref: 'refs/heads/main', after: A, commits: [{ sha: A, paths: ['.baton/baton.json', 'docs/readme.md'] }] });
  });

  it.each([
    ['a branch deletion (after is the zero sha)', pushPayload({ after: '0'.repeat(40), head_commit: null }), null],
    ['a tag push', pushPayload({ ref: 'refs/tags/v1' }), null],
    ['a payload with none of the fields', pushPayload({ ref: undefined, before: undefined, after: undefined, sender: undefined, commits: undefined }), null],
  ])('a push Baton does not record (%s) triggers all the same', (_what, payload, _want) => {
    const d = pickDelivery('push', 'p-3', payload)!;
    expect(d.pusher).toBe('worker');
    expect('push' in d).toBe(false);
  });

  it('a push past the bounds is remembered truncated, its paths not recordable', () => {
    const many = Array.from({ length: 31 }, (_, i) => ({ id: `${i}`.padStart(40, '0').replace(/ /g, '0'), added: ['a'] }));
    const d = pickDelivery('push', 'p-4', pushPayload({ commits: many }))!;
    expect(d.push).toMatchObject({ sender_id: 424242, truncated: true, commits: [] });
    const paths = Array.from({ length: 601 }, (_, i) => [`p${i}`]);
    const wide = pickDelivery('push', 'p-5', pushPayload({ commits: [{ id: A, added: paths.flat() }] }))!;
    expect(wide.push).toMatchObject({ truncated: true, commits: [] });
  });

  it('reads a pull_request\u2019s merge, and drops one whose `merged` is neither a boolean nor null (B-89, round 4 nit 4)', () => {
    const payload = (merged: unknown) => ({ repository: { full_name: 'o/r' }, pull_request: merged === undefined ? { title: 't' } : { merged } });
    expect(pickDelivery('pull_request', 'id-1', payload(true))).toEqual({ event: 'pull_request', id: 'id-1', repository: 'o/r', merged: true });
    expect(pickDelivery('pull_request', 'id-1', payload(false))).toEqual({ event: 'pull_request', id: 'id-1', repository: 'o/r', merged: false });
    // GitHub documents `merged` as a boolean or null, and sends null for a pull request that is
    // not (or not yet) merged: a null is no merge, not a malformed delivery.
    expect(pickDelivery('pull_request', 'id-1', payload(null))).toEqual({ event: 'pull_request', id: 'id-1', repository: 'o/r', merged: false });
    // A payload without the field is not malformed either: a delivery the App sends of a shape
    // older than the field is a pull_request with no merge to act on.
    expect(pickDelivery('pull_request', 'id-1', payload(undefined))).toEqual({ event: 'pull_request', id: 'id-1', repository: 'o/r', merged: false });
    for (const bad of ['yes', 1, 0, {}, []]) expect(pickDelivery('pull_request', 'id-1', payload(bad))).toBeNull();
    expect(pickDelivery('pull_request', 'id-1', { repository: { full_name: 'o/r' }, pull_request: null })).toEqual({ event: 'pull_request', id: 'id-1', repository: 'o/r', merged: false });
  });

  it('B-92’s first real deliveries: the shapes GitHub sends reach the core as a merge or not', async () => {
    // The App's own payloads, cut to the fields R-BTN-73 lists, as `merge_commit_sha` and
    // `merged_at` accompany `merged` in the real delivery.
    const delivered = (pull_request: unknown) => ({ action: 'closed', number: 107, repository: { full_name: 'immediately-run/baton', id: 1 }, pull_request, sender: { login: 's' }, installation: { id: 2 } });
    const merged = delivered({ number: 107, merged: true, state: 'closed', merge_commit_sha: 'abc', merged_at: '2026-10-24T16:00:00Z', head: { sha: 'h' }, base: { ref: 'main' } });
    const closed = delivered({ number: 108, merged: false, state: 'closed', merge_commit_sha: null, merged_at: null, head: { sha: 'h' }, base: { ref: 'main' } });
    // An opened or synchronised pull_request: `merged` null, `merged_at` null.
    const opened = { ...delivered({ number: 109, merged: null, state: 'open', merge_commit_sha: null, merged_at: null }), action: 'opened' };
    expect(pickDelivery('pull_request', 'b-92-1', merged)).toEqual({ event: 'pull_request', id: 'b-92-1', repository: 'immediately-run/baton', merged: true });
    expect(pickDelivery('pull_request', 'b-92-2', closed)).toEqual({ event: 'pull_request', id: 'b-92-2', repository: 'immediately-run/baton', merged: false });
    expect(pickDelivery('pull_request', 'b-92-3', opened)).toEqual({ event: 'pull_request', id: 'b-92-3', repository: 'immediately-run/baton', merged: false });
    // The real push delivery B-92 smokes: no `merged` field at all, and a head commit.
    const push = { ref: 'refs/heads/probe', repository: { full_name: 'immediately-run/baton', id: 1 }, pusher: { name: 'dev' }, head_commit: { id: 'abc', author: { email: 'd@x', name: 'd' } } };
    expect(pickDelivery('push', 'b-92-4', push)).toEqual({ event: 'push', id: 'b-92-4', repository: 'immediately-run/baton', pusher: 'dev', author_email: 'd@x' });
  });
});

describe('the core: self-filter, repository map, window (R-BTN-73)', () => {
  const d = (over: Record<string, unknown>) => ({ event: 'pull_request', id: `d-${Math.random()}`, repository: 'immediately-run/docs', merged: true, ...over }) as never;

  it('Baton’s own work is dropped; anything else in a registered repository is a trigger', async () => {
    await withCore((c) => {
      const w = new Webhooks({ store: c.store, now: () => 1_000_000 });
      expect(w.receive(d({ event: 'workflow_run', workflow_path: '.github/workflows/baton-mirror.yml' }))).toEqual({ outcome: 'own-work' });
      expect(w.receive(d({ event: 'workflow_run', repository: 'Immediately-Run/Docs', workflow_path: '.github/workflows/baton-sync.yml' }))).toEqual({ outcome: 'own-work' });
      expect(w.receive(d({ event: 'push', pusher: 'github-actions[bot]', author_email: 'baton-mirror@immediately.run' }))).toEqual({ outcome: 'own-work' });
      // A push by the bot as anyone else, or by anyone as the mirror, is a trigger (2-A-0).
      expect(w.receive(d({ event: 'push', pusher: 'github-actions[bot]', author_email: 'x@y' }))).toMatchObject({ now: ['docs'] });
      const later = new Webhooks({ store: c.store, now: () => 2_000_000 });
      expect(later.receive(d({ event: 'push', pusher: 'alice', author_email: 'baton-mirror@immediately.run' }))).toMatchObject({ now: ['docs'] });
    });
  });

  it('maps a code repository to the repositories whose tickets list it, by owner/name or by short name', async () => {
    await withCore((c) => {
      c.store.exec(`INSERT INTO tickets (id, repository_id, local_id, path, title, status, node, queue, tags, requires_clause, depends_on, blocked_by, repos, snapshot_sha, row_hash)
                    SELECT 'docs:X-1', 'docs', 'X-1', 'p', 't', 'available', 'ready', 'ready-autonomous', '[]', 'listed', '[]', '[]', '["baton","immediately-run/sandbox"]', 'a', 'h'`);
      const w = new Webhooks({ store: c.store, now: () => 5_000_000 });
      // A delivery to this repository now dispatches its own sync too: baton is a registered
      // repository whose tickets name it (R3-1266), beside docs' — one entry, though the merge
      // (B-89) wants it as well as the merged ticket.
      expect(w.receive(d({ repository: 'immediately-run/baton' }))).toEqual({ outcome: 'dispatched', now: ['baton', 'docs'], trailing: [] });
      const later = new Webhooks({ store: c.store, now: () => 6_000_000 });
      expect(later.receive(d({ repository: 'IMMEDIATELY-RUN/Sandbox' }))).toEqual({ outcome: 'dispatched', now: ['docs'], trailing: [] });
      expect(later.receive(d({ repository: 'immediately-run/other' }))).toEqual({ outcome: 'dispatched', now: [], trailing: [] });
      // A short name is read under the home repository's owner: another owner's baton names nothing (1-B-1).
      expect(later.receive(d({ repository: 'someone-else/baton' }))).toEqual({ outcome: 'dispatched', now: [], trailing: [] });
    });
  });

  it('one dispatch per 30 seconds, then one trailing when the window that suppressed one closes', async () => {
    await withCore((c) => {
      const at = (now: number) => new Webhooks({ store: c.store, now: () => now });
      expect(at(0).receive(d({}))).toMatchObject({ now: ['docs'], trailing: [] });
      expect(at(0).nextTrailing()).toBeNull();
      expect(at(10_000).receive(d({}))).toMatchObject({ now: [], trailing: ['docs'] });
      expect(at(20_000).receive(d({}))).toMatchObject({ now: [], trailing: ['docs'] });
      expect(at(0).nextTrailing()).toBe(30_000);
      expect(at(29_999).dueTrailing()).toEqual([]);
      expect(at(30_000).dueTrailing()).toEqual(['docs']);
      expect(at(30_001).dueTrailing()).toEqual([]);
      // The trailing dispatch opened a window: a delivery inside it waits again.
      expect(at(45_000).receive(d({}))).toMatchObject({ now: [], trailing: ['docs'] });
      expect(at(0).nextTrailing()).toBe(60_000);
      expect(at(60_000).receive(d({}))).toMatchObject({ now: ['docs'], trailing: [] });
      expect(at(0).nextTrailing()).toBeNull();
    });
  });

  it('the alarm fires at the earliest trailing dispatch still owed, after a tick and after a restart (1-A-1, 1-A-4)', async () => {
    // Times ahead of the real clock: an alarm armed in the past fires (and clears) at once.
    const B = Math.ceil(Date.now() / 1000) * 1000 + 600_000;
    await withCore(async (c) => {
      c.registry.register({ id: 'ops', github: 'immediately-run/ops', default_branch: 'main', sync_workflow: '.github/workflows/sync.yml' });
      c.store.exec(`INSERT INTO webhook_dispatch (repository_id, last_dispatch_at, trailing_at) VALUES ('docs', ?, ?), ('ops', ?, ?)`, B - 30_000, B, B - 20_000, B + 10_000);
      c.dispatcher = async () => true;
      c.now = () => B;
      await c.alarm();
    });
    // docs' was sent; ops' is still owed, sooner than the next 60-second tick.
    expect(await armedAt()).toBe(B + 10_000);
    await withCore(async (c) => {
      c.store.exec(`UPDATE webhook_dispatch SET trailing_at = ? WHERE repository_id = 'ops'`, B + 15_000);
      await (c as unknown as { ports: { scheduler: { set(at: number): Promise<void> } } }).ports.scheduler.set(B + 60_000);
      await c.start();
    });
    expect(await armedAt()).toBe(B + 15_000);
  });

  it('a repository retired inside its window owes no trailing dispatch (1-B-5)', async () => {
    await withCore((c) => {
      c.registry.register({ id: 'ops', github: 'immediately-run/ops', default_branch: 'main', sync_workflow: '.github/workflows/sync.yml' });
      c.store.exec(`INSERT INTO webhook_dispatch (repository_id, last_dispatch_at, trailing_at) VALUES ('ops', 0, 30000)`);
      c.store.exec(`UPDATE repositories SET retired_at = 1 WHERE id = 'ops'`);
      const w = new Webhooks({ store: c.store, now: () => 30_000 });
      expect(w.dueTrailing()).toEqual([]);
      expect(w.nextTrailing()).toBeNull();
    });
  });

  it('a suppressed delivery writes its window’s trailing time once (1-A-3)', async () => {
    await withCore((c) => {
      const at = (now: number) => new Webhooks({ store: c.store, now: () => now });
      at(0).receive(d({}));
      at(5_000).receive(d({}));
      at(9_000).receive(d({}));
      // The trailing time is the first suppression's window close, unchanged by later ones.
      expect(c.store.exec(`SELECT trailing_at FROM webhook_dispatch WHERE repository_id = 'docs'`).one()).toEqual({ trailing_at: 30_000 });
    });
  });

  it('a delivery id is remembered for 24 hours', async () => {
    await withCore((c) => {
      const at = (now: number) => new Webhooks({ store: c.store, now: () => now });
      const one = d({ id: 'same' });
      expect(at(0).receive(one)).toMatchObject({ outcome: 'dispatched' });
      expect(at(24 * 3_600_000).receive(one)).toEqual({ outcome: 'duplicate' });
      expect(at(24 * 3_600_000 + 1).receive(one)).toMatchObject({ outcome: 'dispatched' });
    });
  });

  it('B-126: a push delivery\u2019s recorded half is stored once, pruned with the 24-hour ttl, and kept for Baton\u2019s own work', async () => {
    await withCore((c) => {
      const at = (now: number) => new Webhooks({ store: c.store, now: () => now });
      const push = (id: string, over: Record<string, unknown> = {}, pushOver: Record<string, unknown> = {}) => d({
        event: 'push', id, repository: 'immediately-run/docs',
        push: { sender_id: 424242, sender_login: 'immediately-run-worker', ref: 'refs/heads/main', before: '0'.repeat(39) + '1', after: 'f'.repeat(40),
          commits: [{ sha: 'f'.repeat(40), paths: ['.baton/baton.json'] }], ...pushOver },
        ...over,
      });
      expect(at(0).receive(push('push-a'))).toMatchObject({ outcome: 'dispatched' });
      // The mirror's own push (the Actions bot with the mirror's email) is dropped as a trigger
      // and its record stands: a mirror push moves the default branch too (R-BTN-194).
      expect(at(1_000).receive(push('push-b', { pusher: ACTIONS_BOT, author_email: MIRROR_EMAIL }, { sender_id: null, sender_login: null,
        before: 'f'.repeat(40), after: 'e'.repeat(40), commits: [], truncated: 1 })))
        .toMatchObject({ outcome: 'own-work' });
      expect(c.store.exec('SELECT delivery_id, repository, ref, before_sha, after_sha, sender_id, sender_login, commits_json, truncated FROM push_deliveries ORDER BY delivery_id').toArray())
        .toEqual([
          { delivery_id: 'push-a', repository: 'immediately-run/docs', ref: 'refs/heads/main', before_sha: '0'.repeat(39) + '1', after_sha: 'f'.repeat(40),
            sender_id: 424242, sender_login: 'immediately-run-worker', commits_json: JSON.stringify([{ sha: 'f'.repeat(40), paths: ['.baton/baton.json'] }]), truncated: 0 },
          { delivery_id: 'push-b', repository: 'immediately-run/docs', ref: 'refs/heads/main', before_sha: 'f'.repeat(40), after_sha: 'e'.repeat(40),
            sender_id: null, sender_login: null, commits_json: '[]', truncated: 1 },
        ]);
      // Pruned with the deliveries' own clock.
      at(24 * 3_600_000 + 2).receive(push('push-c', {}, { before: 'e'.repeat(40), after: 'd'.repeat(40) }));
      expect(c.store.exec('SELECT delivery_id FROM push_deliveries ORDER BY delivery_id').toArray())
        .toEqual([{ delivery_id: 'push-b' }, { delivery_id: 'push-c' }]);
    });
  });
});
