import type { BatonCore } from '../baton';
import { admitsSession, keyCaller, matchActions } from '../actions';
import { logEvent } from '../db';
import { BatonError, json, readJson } from '../http';
import { checkAccept, checkConfirm, checkResync } from '../validate';
import { liveRepoParam, pathSegment, qualifiedTicket, ticketOf } from './kit';

const RESYNC_WINDOW_MS = 30_000;

/** S-BTN-323: both surfaces use the same validators and write transactions. */
export async function operatorRoute(core: Pick<BatonCore, 'admin' | 'store' | 'runners' | 'claims' | 'cutover' | 'registry' | 'scope' | 'sql' | 'now' | 'queueSync'>, req: Request, url: URL, owner: string, role: 'administrator' | 'owner' | 'session'): Promise<Response | null> {
  if (req.method !== 'POST') return null;
  const hit = matchActions(req.method, url.pathname).find(({ action }) => action.ui?.route);
  if (!hit) return null;
  const { action, params } = hit;
  const scoped = params.repository !== undefined;
  if (role === 'session' ? !admitsSession(action, 'administrator') : !keyCaller(action, role) || scoped !== (role === 'owner')) {
    throw new BatonError('forbidden', 'this key cannot call this action on this route');
  }
  const tx = <T>(f: (repo?: string) => T): T => core.store.transaction(() => {
    if (!scoped) return f();
    const { id } = liveRepoParam(core.registry, pathSegment(params.repository));
    if (!core.admin.owns(owner, id)) throw new BatonError('forbidden', `this key does not own ${id}`);
    return f(id);
  });
  const number = (raw: string) => {
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new BatonError('not-found', 'no such id');
    return Number(raw);
  };
  // Messages and overrides share a path and their existing validators read the whole body.
  if (['leg.stop', 'runner.status-request', 'runner.wind-down'].includes(action.id)) {
    const body = await readJson(req);
    return json(tx((repo) => core.runners.sendMessage(owner, body, repo === undefined ? undefined : { repository: repo, owns: (id) => core.admin.owns(owner, id) })));
  }
  if (action.id === 'claim.force-reap') {
    const body = await readJson(req);
    return json(tx(() => core.claims.forceReap(owner, number(params.claim), body)));
  }
  // R-BTN-19: an administrator's fence clear, in one transaction with its seats' release
  // (R-BTN-178) and its event.
  if (action.id === 'claim.fence-clear') {
    const body = await readJson(req);
    return json(tx(() => core.claims.fenceClear(owner, number(params.claim), body)));
  }
  // B-222 (R-BTN-10, §9.6): the completion's confirm and its release, each a route of its
  // own over `claims.resolve`. V1's one route taking `{action}` is retired (B-203).
  if (action.id === 'claim.confirm' || action.id === 'claim.release') {
    const body = await readJson(req);
    // Do not synthesize the caller's confirmation (§12.2).
    checkConfirm(body);
    return json(tx(() => core.claims.resolve(owner, number(params.claim), { action: action.id === 'claim.confirm' ? 'confirm' : 'release', confirm: true })));
  }
  if (action.id === 'repo.cutover') {
    const body = await readJson(req);
    return json(tx(() => core.cutover.cutover(owner, body)));
  }
  if (action.id === 'adoption.confirm') {
    const { id: ticket, repository } = qualifiedTicket(params.ticket);
    const body = await readJson(req);
    return json(tx(() => {
      liveRepoParam(core.registry, repository);
      return core.cutover.confirmAdoption(owner, ticket, body);
    }));
  }
  if (['ticket.hold', 'ticket.unhold', 'ticket.expedite'].includes(action.id)) {
    const body = await readJson(req);
    return json(tx((repo) => {
      if (repo !== undefined) return core.claims.setOverride(owner, ticketOf(repo, params.ticket), body);
      const { id: ticket, repository } = qualifiedTicket(params.ticket);
      liveRepoParam(core.registry, repository);
      return core.claims.setOverride(owner, ticket, body);
    }));
  }
  // B-134: an owner resolves a scope finding — the acknowledgement that it was looked at.
  // In the transaction, like every neighbouring `/v1/ui` mutation, so the resolution and
  // its `scope-resolved` event land together.
  if (action.id === 'scope.resolve') {
    const id = number(params.finding);
    await readJson(req);
    return json(tx((repo) => {
      if (!core.scope.resolve(id, `owner:${owner}`, repo)) throw new BatonError('not-found', `no open scope finding ${id}`);
      return { ok: true };
    }));
  }
  if (action.id === 'repo.accept-post') {
    const input = checkAccept(await readJson(req));
    return json(tx(() => {
      liveRepoParam(core.registry, input.repository);
      return core.claims.acceptHeld(owner, input);
    }));
  }
  // B-201 (`repo.resync`; R-BTN-73): a session asks the repository's sync to run now — the
  // dispatch a webhook delivery sends, logged with who asked, at most one per repository per
  // dispatch window. Nothing of the board moves here: the sync posts, and R-BTN-11 judges
  // its post. A forced resync is not built and is refused by name (`checkResync`).
  if (action.id === 'repo.resync') {
    const { repository } = checkResync(await readJson(req));
    tx((repo) => {
      if (repo !== undefined && repo !== repository) throw new BatonError('forbidden', 'resync must target the repository in the route');
      const target = liveRepoParam(core.registry, repository, () => ['forbidden', 'this repository is not yours or does not exist']);
      if (!target.sync_workflow) throw new BatonError('conflict', `no sync workflow registered for ${repository}`);
      const now = core.now();
      // The request is an `admin` event (`act: resync`), as an administrator's other acts are:
      // the window reads the last one, so no new event kind and no table is needed.
      const last = core.sql<{ at: number }>(
        `SELECT at FROM events WHERE kind = 'admin' AND at > ? AND repository_id = ? AND json_extract(detail_json, '$.act') = 'resync' ORDER BY at DESC, seq DESC LIMIT 1`,
        now - RESYNC_WINDOW_MS, repository)[0];
      if (last) throw new BatonError('conflict', `a resync of ${repository} was asked for under ${RESYNC_WINDOW_MS / 1000} seconds ago`);
      core.queueSync({ repository, kind: 'sync', own: true });
      logEvent(core.store, now, 'admin', `owner:${owner}`, { act: 'resync' }, null, null, repository);
    });
    return json({ ok: true });
  }

  return null;
}
