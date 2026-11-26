import type { BatonCore } from '../baton';
import { BatonError, json, readJson } from '../http';
import { parseSshKey, type SyncCredential } from '../auth';
import { head, ticketVersions } from '../sync';
import { checkPayload, retiredBoardFields, type BoardPayload } from '../board';
import { checkDependenciesRead } from '../validate';
import { resolveDependencies } from '../dependencies';
import { codeReposOf, pushersOf } from '../codeRepos';
import type { Delivery } from '../webhook';
import type { Repository } from '../registry';
import { verifySigned } from './principal';
import { liveRepoParam } from './kit';

type SyncCore = Parameters<typeof verifySigned>[0] & Pick<BatonCore, 'registry' | 'adminKeys' | 'store' | 'webhooks' | 'syncNow' | 'armBy' | 'observations' | 'claims' | 'admin' | 'sql' | 'deprecated' | 'board' | 'mirror' | 'policies' | 'syncWants' | 'requestSync'>;

export function syncPrincipal(core: SyncCore, req: Request) {
  return (role?: 'sync' | 'mirror') => verifySync(core, req, role);
}

export async function syncRoute(core: SyncCore, req: Request, url: URL, principal: ReturnType<typeof syncPrincipal>): Promise<Response | null> {
  if (url.pathname.startsWith('/v1/sync/')) {
    // R-BTN-15: the board's routes take only the repository's sync workflow, the feed's only
    // its mirror workflow; each touches that repository alone.
    if (req.method === 'GET' && url.pathname === '/v1/sync/wanted') {
      const { repo, role } = await principal();
      return json(core.syncWants.wanted(repo.id, role));
    }
    if (req.method === 'POST' && url.pathname === '/v1/sync/want') {
      const { repo } = await principal('sync');
      core.requestSync(repo.id);
      return json({ ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/v1/sync/head') return json(head(core, (await principal('sync')).repo.id));
    // R-BTN-62: the next number of the repository's counter, before the sync reads anything.
    if (req.method === 'POST' && url.pathname === '/v1/sync/observation') {
      const { repo: { id: repo }, req: signed, issuer } = await principal('sync');
      // R-BTN-62 (Release): a run that will not post gives its number back; only the
      // outstanding number is voided, so a stale release voids nothing.
      const release = ((await readJson(signed).catch(() => null)) as { release?: unknown } | null)?.release;
      if (release !== undefined) {
        if (!Number.isSafeInteger(release)) throw new BatonError('invalid-params', 'release must be the number this credential was handed (R-BTN-62)');
        core.observations.release(repo, release as number, issuer);
        return json({ released: release });
      }
      // R-BTN-67: with the owner bars in force or scheduled for the repository, each with its course.
      // B-110: and Baton's own record a station function judges git against — the owner's
      // answers to the sync's decisions, and the legs claims finished with an evidence
      // pointer (the claim's nonce beside it) — so a marker in git counts only as the
      // evidence Baton recorded, and an answer only as the owner gave it here.
      // B-127: the repository's owner signing keys — the public keys of its human-only
      // owners (B-136's register as far as it is built; an API key cannot sign) — beside
      // Baton's own record, so the sync that just took this number reads what counts from
      // Baton, never from the repository it is judging.
      // B-183 (§4.3): and each live ticket's last accepted `version`, handed back so the
      // source's own code — never Baton — judges whether its store read is older than what
      // the board holds, and refuses to post a ticket it judges behind (R-BTN-150).
      // B-182 (R-BTN-140): and the effective `code_repos`, each entry with its forge, host,
      // ids and web_base, and the owners' `pushers` host-qualified — what the fact adapter
      // reads each repository by, and whose words count there.
      return json({ ...core.observations.observe(repo, issuer), bars: core.admin.bars([repo], core.now(), true).map(({ repository_id: _r, ...b }) => b), code_repos: codeReposOf(core.store, repo), pushers: pushersOf(core.store, repo), ...core.claims.syncRecord(repo), versions: ticketVersions(core, repo), signing_keys: await core.admin.signingKeys(repo), require_signed_control: !!core.sql<{ flag: number }>('SELECT require_signed_control AS flag FROM repositories WHERE id = ?', repo)[0]?.flag });
    }
    if (req.method === 'POST' && url.pathname === '/v1/sync/board') {
      const { repo, req: signed, issuer } = await principal('sync');
      const release = (body: unknown) => {
        const n = (body as { observation?: unknown } | null)?.observation;
        if (Number.isSafeInteger(n)) core.observations.release(repo.id, n as number, issuer);
      };
      try {
        core.observations.charge(issuer, 'board');
      } catch (e) {
        // R-BTN-62: even a rate-limited post uses the number it carries. Don't parse a
        // throttled request that cannot have a reservation to return.
        if (e instanceof BatonError && e.code === 'rate-limited' && core.observations.heldBy(repo.id, issuer)) {
          release(await readJson(signed).catch(() => null));
        }
        throw e;
      }
      const body = await readJson(signed);
      // B-168: the part-4 retired fields the post carries, read before `checkPayload` drops
      // them from the body.
      const retired = retiredBoardFields(body);
      let p: BoardPayload;
      try {
        // The posting repository's id reads a self-qualified `depends_on` entry as the local
        // id alone in the one-board cycle graph (§3.1, B-113 round 1).
        p = checkPayload(body, repo.id);
      } catch (e) {
        // A refused post uses its number too (R-BTN-62), malformed or not, so the sync's
        // next run is not held off as busy for ten minutes.
        release(body);
        throw e;
      }
      // …read as absent, and logged once per repository's sync credential, field and day
      // (the history's Migrations entry).
      if (retired.length) core.store.transaction(() => { for (const f of retired) core.deprecated.note(core.now(), `sync:${repo.id}`, f, 'board', repo.id); });
      return json(await core.board(repo, p, issuer));
    }
    // B-113 (§4.3): the sync's dependencies read — each qualified `depends_on` entry of
    // another repository the posting repository's tickets name, resolved against its
    // target's board (done, closed, its station, its link from the registration). The same
    // refusals the post would make come here first, so a sync that could not post fails
    // before it reads the forge; read after the number, as everything this run posts is.
    if (req.method === 'POST' && url.pathname === '/v1/sync/dependencies') {
      const { repo, req: signed } = await principal('sync');
      const ids = checkDependenciesRead(await readJson(signed));
      const sql = <T>(q: string, ...a: unknown[]): T[] => core.sql<T>(q, ...a);
      return json({ dependencies: resolveDependencies(sql, repo.id, ids) });
    }
    if (req.method === 'GET' && url.pathname === '/v1/sync/events') {
      const { repo } = await principal('mirror');
      const after = Number(url.searchParams.get('after') ?? 0);
      const limit = Number(url.searchParams.get('limit') ?? 200);
      if (!Number.isInteger(after) || after < 0 || !Number.isInteger(limit)) throw new BatonError('invalid-params', 'after and limit must be integers');
      // B-238: the read acknowledges the cursor it starts from (§12), for R-BTN-149's prune.
      core.store.transaction(() => core.mirror.acknowledge(repo.id, after));
      return json(core.mirror.events(repo.id, after, limit));
    }
    if (req.method === 'POST' && url.pathname === '/v1/sync/foreign-claim') {
      const { repo, req: signed } = await principal('mirror');
      const body = await readJson(signed);
      return json(core.store.transaction(() => core.mirror.foreignClaim(repo.id, body)));
    }
  }
  if (req.method === 'POST' && url.pathname === '/v1/github/webhook') {
    // §11: 204, and nothing of Baton's in the App's delivery log (round 1, 1-A-0).
    await delivery(core, req);
    return new Response(null, { status: 204 });
  }
  return null;
}

/** R-BTN-93's one verifier: the repository a sync credential acts for in `role` — a sync key
 *  (signed; its signature, clock and nonce checked here, as every key's are), or a CI identity
 *  token the front verified (GitHub Actions OIDC, GitLab CI `id_tokens`). Anything else is
 *  refused. Returns the request with a signed body put back. */
async function verifySync(core: SyncCore, req: Request, role?: 'sync' | 'mirror'): Promise<{ repo: Repository; req: Request; role: 'sync' | 'mirror'; issuer: string }> {
  if (req.headers.has('X-Baton-Signed')) {
    // Every key Baton knows verifies here, so a key in another role is told `forbidden`, not
    // `unauthenticated` — an administrator's included (round 1, 1-A-9).
    const admins = new Map<string, string>();
    for (const line of core.adminKeys()) {
      try {
        admins.set((await parseSshKey(line)).fingerprint, line);
      } catch {
        // an unreadable line is no key
      }
    }
    const { req: signed, cred } = await verifySigned(core, req, (fp) => core.registry.syncKey(fp)?.public_key ?? core.runners.publicKey(fp) ?? admins.get(fp) ?? null);
    // An administrator key is never a sync's, even one added to BATON_ADMIN_KEYS after it was
    // registered as a sync key (round 3, 3-A-2).
    if (admins.has(cred)) throw new BatonError('forbidden', 'an administrator key holds no other role (R-BTN-57)');
    const key = core.registry.syncKey(cred);
    // A runner, probe, courier or administrator key is never a sync's (R-BTN-57, R-BTN-93).
    if (!key) throw new BatonError('forbidden', 'only a sync key may act as a sync');
    if (role && key.role !== role) throw new BatonError('forbidden', `this sync key serves its repository's ${key.role}, not its ${role}`);
    const repo = liveRepoParam(core.registry, key.repository);
    if (key.role === 'sync') requireBoardInput(core, repo.id, 'sync-key');
    return { repo, req: signed, role: key.role, issuer: cred };
  }
  const raw = req.headers.get('X-Baton-Sync');
  if (!raw) throw new BatonError('unauthenticated', 'no sync principal');
  const claims = JSON.parse(raw) as SyncCredential;
  let bound: { repo: Repository; role: 'sync' | 'mirror' };
  if (claims.kind === 'gitlab') {
    const selected = role ?? claims.role;
    bound = { repo: core.registry.forGitlab(claims, selected), role: selected };
  } else if (role) bound = { repo: core.registry.forSync(claims, role), role };
  else bound = core.registry.bindGithubSync(claims);
  if (bound.role === 'sync') requireBoardInput(core, bound.repo.id, 'ci-identity');
  return { ...bound, req, issuer: `ci:${bound.repo.id}` };
}

function requireBoardInput(core: SyncCore, repo: string, input: 'sync-key' | 'ci-identity') {
  if (core.policies.current(repo)?.policy.inputs.board.includes(input) === false) {
    throw new BatonError('forbidden', `${repo}'s policy excludes ${input} from inputs.board (R-BTN-187)`);
  }
}

/** R-BTN-73: a verified delivery's fields, from the front. Its syncs go after the response;
 *  a suppressed one waits for its window's trailing dispatch, which the alarm sends, armed
 *  early for it. */
export async function delivery(core: Pick<BatonCore, 'store' | 'webhooks' | 'syncNow' | 'armBy'>, req: Request) {
  const raw = req.headers.get('X-Baton-Webhook');
  if (!raw) throw new BatonError('unauthenticated', 'no webhook principal');
  const out = core.store.transaction(() => core.webhooks.receive(JSON.parse(raw) as Delivery));
  if (out.outcome === 'dispatched') {
    // B-92's live run: the delivery's row is what proves it arrived, on either side of the
    // cutover. The dispatch itself goes to every repository the path named, whatever its mode
    // (R-BTN-73: the sync posts the board snapshot before the cutover too, and a snapshot
    // under 15 minutes old is what cutover.ts needs when its day comes — the round-1 filter
    // held shadow repositories back while the alarm's own backstop sent them 30 seconds
    // later, so the code, the spec and the runbook disagreed until it went).
    core.syncNow(out.now);
    if (out.trailing.length) await core.armBy(core.webhooks.nextTrailing());
    // B-89: the stamp this delivery wrote arms the alarm for the backstop's instant.
    await core.armBy(core.webhooks.nextDue());
  }
  return out;
}
