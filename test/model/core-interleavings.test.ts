// B-345 / S-BTN-327 (R-BTN-31): the real local core, without Quint or a second state machine.
// Soak with BATON_PROPERTY_RUNS; reproduce a failure with BATON_PROPERTY_SEED and
// BATON_PROPERTY_PATH (the seed and shrink path printed by fast-check).
import { expect, it } from 'vitest';
import fc from 'fast-check';
import { reset } from '#host';
import { makeKey, type TestKey } from '../lib/sshKeys';
import {
  adminSession, advance, beat, course, cutover, Git, grantRunnerConcurrency, observe, placed,
  register, rows, runnerCall, sessionCall, setAdminKeys, setClock, sha256, syncCall, tick, withCore,
} from '../helpers';
import { projectState } from '../integration/trace';
import { checkSafety, type Transition } from './interleaving-safety';

const T0 = Date.parse('2026-11-26T12:00:00Z');
const MINUTE = 60_000;
const creds = ['vm-a', 'vm-b', 'mac'] as const;
const limits = [2, 1, 1];
const ids = ['T-1', 'T-2', 'T-3', 'T-4', 'T-5'];
const graph = course().course;
type Leg = keyof typeof graph.legs;
const legs = Object.keys(graph.legs) as Leg[];
const key = (id: string) => `docs:${id}`;
const snapshot = () => withCore((c) => projectState(c.store, c.now()));

const kinds = ['claim', 'claim', 'claim', 'heartbeat', 'advance', 'advance', 'suspended', 'done', 'released',
  'failed', 'blocked', 'observe', 'post', 'post', 'git', 'withdraw', 'tick', 'alarm', 'reap', 'fenced',
  'hold', 'lift', 'confirm', 'release'] as const;
type Action = { kind: typeof kinds[number]; ticket: number; runner: number; choice: number };
const actions = fc.array(fc.record({ kind: fc.constantFrom(...kinds), ticket: fc.nat(ids.length - 1),
  runner: fc.nat(creds.length - 1), choice: fc.nat(5) }), { maxLength: 60, size: 'large' });

async function play(list: Action[], admin: TestKey) {
  await reset({ trace: false });
  let now = T0;
  await setClock(now);
  await setAdminKeys(admin);
  const session = await adminSession(admin);
  const ui = async (route: string, body: object) => {
    const res = await sessionCall(session, `/v1/ui/${route}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  };
  await rows(`UPDATE repositories SET required_bars = ? WHERE id = 'docs'`,
    JSON.stringify([{ course: 'roadmap-pr', leg: '*', except: ['implement', 'review', 'adjudicate'], tag_prefix: 'family:' }]));
  await rows(`INSERT INTO capability_capacity VALUES ('llm-call', 1, 'test', ?)`, now);
  await rows(`UPDATE repositories SET retry = ? WHERE id = 'docs'`, JSON.stringify({ backoff_ms: [0], max_failed: 2 }));
  const git = new Git();
  const paths = ids.map((): Leg[] => []);
  const station = (path: Leg[]) => path.length ? graph.legs[path.at(-1)!].to : graph.start;
  const capped = (i: number) => i >= 3;
  for (const [i, id] of ids.entries()) git.add(id, { rank: i, requires: capped(i) ? ['llm-call'] : [] });
  expect(await git.post()).toMatchObject({ status: 200 });
  await cutover();
  const grants = [2, 2, 1];
  const declarations = creds.map((_, i) => ({ concurrency: i === 1 ? 1 : 3, tags: [i === 1 ? 'family:b' : 'family:a'],
    capabilities: i === 2 ? ['agent-venue'] : ['agent-venue', 'llm-call'] }));
  const runners = [];
  for (const [i, cred] of creds.entries()) {
    const w = await register(cred, declarations[i]);
    if (grants[i] > 1) await grantRunnerConcurrency(w.id, grants[i]);
    runners.push(w);
  }
  const readings: { number: number; body: unknown }[] = [];
  const exercised = new Set<string>();
  let before = await snapshot();
  for (const [step, a] of list.entries()) {
    const id = ids[a.ticket];
    const ticket = key(id);
    const claims = Object.entries(before.claims).filter(([, c]) => c.ticket === ticket);
    const active = claims.find(([, c]) => c.status === 'active');
    const fence = claims.find(([, c]) => c.fencePending);
    const unconfirmed = claims.find(([, c]) => c.status === 'completed' && !c.confirmed);
    const holder = active ? runners.findIndex((r) => r.id === active[1].runner) : a.runner;
    const w = runners[holder];
    const place = before.tickets[ticket];
    const request = (suffix: string, body: object) => runnerCall(`/v1/runner/claims/${active?.[0] ?? 0}/${suffix}`,
      { cred: creds[holder], secret: w.secret, body });
    const move: Transition = {};
    let status: number | undefined;
    let reply: unknown;
    try {
      switch (a.kind) {
        case 'claim': {
          const res = await runnerCall('/v1/runner/claim', { cred: creds[a.runner], secret: runners[a.runner].secret,
            body: { request_id: `property-${step}`, ticket_id: ticket } });
          status = res.status;
          const json = await res.json() as { claim_id?: number; rule?: string };
          reply = json;
          if (res.ok) move.claim = { id: String(json.claim_id), ticket, runner: runners[a.runner].id, cap: capped(a.ticket) };
          if (json.rule) exercised.add(`refused:${json.rule}`);
          break;
        }
        case 'heartbeat': {
          const r = runners[a.runner];
          let answer = await beat(creds[a.runner], r.secret, declarations[a.runner]);
          if (answer.json.code === 'runner-reaped') {
            r.secret = `property-rekey-${a.runner}-${step}`;
            answer = await beat(creds[a.runner], r.secret, { ...declarations[a.runner], rekey: true, secret_hash: await sha256(r.secret) });
          }
          ({ status, json: reply } = answer);
          if (status === 200) expect(answer.json.claims.map((c: { id: number }) => c.id)).toEqual(
            Object.entries(before.claims).filter(([, c]) => c.runner === r.id && c.status === 'active').map(([cid]) => Number(cid)));
          break;
        }
        case 'advance': {
          if (!active) break;
          const [cid, c] = active;
          const reached = c.leg ? graph.legs[c.leg as Leg].to : c.station;
          const choices = legs.filter((l) => graph.legs[l].from.includes(reached));
          const leg = (a.choice === 5 ? legs[a.ticket] : choices[Math.floor(a.choice / 3) % choices.length]) ?? 'implement';
          const bars = a.choice % 3 === 0 ? [holder === 1 ? 'family:a' : 'family:b'] : a.choice % 3 === 1 ? [] : declarations[holder].tags;
          const answer = await advance(creds[holder], w.secret, Number(cid), { leg, ...(c.leg ? { reached } : {}), bars });
          ({ status, json: reply } = answer);
          if (status === 200) move.advance = { id: cid, leg, reached, bars };
          break;
        }
        case 'suspended': case 'done': case 'released': case 'failed': case 'blocked': {
          if (!active) break;
          const c = active[1];
          const reached = c.leg && a.choice > 0 ? graph.legs[c.leg as Leg].to : c.station;
          const next = legs.find((l) => graph.legs[l].from.includes(reached));
          const end_reason = { suspended: `suspended:${reached}`, done: 'done', released: 'released:requested',
            failed: 'released:cannot-finish:transient', blocked: 'released:blocked' }[a.kind];
          const res = await request('end', { end_reason, reached, ...(next ? { next } : {}),
            ...(a.kind === 'blocked' ? { prerequisite: { kind: 'capability', ref: 'llm-call' } } : {}),
            ...(a.kind === 'suspended' && a.choice === 5 ? { ended_at_sha: 'a'.repeat(40) } : {}) });
          status = res.status;
          reply = await res.json();
          break;
        }
        case 'observe': {
          const o = await observe();
          ({ status, json: reply } = o);
          if (status !== 200) {
            expect(o.json.code).toBe('sync-busy');
            break;
          }
          const number = o.json.observation;
          readings.push({ number, body: structuredClone(git.body((step + 2).toString(16).padStart(40, '0'), o.json.sha, { observation: number })) });
          move.observe = number;
          break;
        }
        case 'post': {
          if (!readings.length) break;
          const reading = a.choice < 4 ? readings.at(-1)! : readings[0];
          const res = await syncCall('/v1/sync/board', reading.body);
          status = res.status;
          reply = await res.json();
          if (!res.ok) {
            expect(reply).toMatchObject({ code: 'stale-observation' });
            exercised.add('stale-observation');
          }
          move.post = { number: reading.number, accepted: res.ok };
          break;
        }
        case 'git': {
          if (!git.tickets.has(id)) break;
          const path = paths[a.ticket];
          if (a.choice === 5) path.pop();
          else {
            const options = nextLegs(path);
            if (options.length) path.push(options[a.choice % options.length]);
          }
          git.place(id, placed(station(path), path.map((l) => [l, graph.legs[l].to]), nextLegs(path).map((l) => [l, 'ready']),
            { bars: a.choice % 2 === 0 ? { merge: ['family:b'], fix: ['family:b'] } : {} }));
          break;
        }
        case 'withdraw': if (a.choice === 0 && git.tickets.has(id)) git.close(id, 'withdrawn'); break;
        case 'hold': case 'lift': ({ status, json: reply } = await ui(`overrides/${encodeURIComponent(ticket)}`, { hold: a.kind === 'hold' })); break;
        case 'confirm': case 'release':
          if (unconfirmed) ({ status, json: reply } = await ui(`claims/${unconfirmed[0]}/${a.kind}`, { confirm: true }));
          break;
        case 'reap':
          if (active) ({ status, json: reply } = await ui(`claims/${active[0]}/reap`, { confirm: true }));
          break;
        case 'fenced':
          if (fence) {
            const i = runners.findIndex((r) => r.id === fence[1].runner);
            ({ status, json: reply } = await beat(creds[i], runners[i].secret, { ...declarations[i], fenced: [{ claim_id: Number(fence[0]), terminated: true }] }));
          }
          break;
        case 'tick': await setClock(now += (a.choice === 0 ? 1 : a.choice <= 3 ? 8 : 16) * MINUTE); break;
        case 'alarm': await tick(); break;
      }
      if (status !== undefined) {
        // Expected domain refusals are part of a trace; malformed test requests and host errors are not.
        expect([200, 403, 404, 409], JSON.stringify(reply)).toContain(status);
        if (status === 200) exercised.add(a.kind);
      }
      const after = await snapshot();
      await checkSafety(before, after, move, runners.map((r, i) => ({ id: r.id, limit: limits[i] })), now, step, exercised);
      before = after;
    } catch (cause) {
      throw new Error(`step ${step}: ${JSON.stringify(a)} -> ${status ?? 'no HTTP'} ${JSON.stringify(reply) ?? ''}`, { cause });
    }
  }
  return exercised;
}

function nextLegs(path: Leg[]) {
  const last = path.length ? graph.legs[path.at(-1)!].to : graph.start;
  return legs.filter((l) => graph.legs[l].from.includes(last) && path.filter((p) => p === l).length < maxRuns(l));
}

function maxRuns(leg: Leg) {
  const def = graph.legs[leg];
  return 'max_runs' in def ? def.max_runs : Infinity;
}

it('S-BTN-327: the local core preserves safety through random interleavings', async () => {
  const admin = await makeKey('ssh-ed25519', 'property-admin');
  await fc.assert(fc.asyncProperty(actions, async (list) => { await play(list, admin); }), {
    numRuns: Number(process.env.BATON_PROPERTY_RUNS ?? 32),
    seed: Number(process.env.BATON_PROPERTY_SEED ?? 327), path: process.env.BATON_PROPERTY_PATH,
  });
}, process.env.BATON_PROPERTY_RUNS ? 0 : 60_000);

it('S-BTN-327: exercises the rare branches and both claim ceilings', async () => {
  const admin = await makeKey('ssh-ed25519', 'property-admin');
  const a = (kind: Action['kind'], ticket = 0, runner = 0, choice = 0): Action => ({ kind, ticket, runner, choice });
  const sync = [a('observe'), a('post')];
  const covered = await play([
    a('claim'), a('claim', 1), a('claim', 2), a('claim', 2, 1), a('claim', 3, 1),
    a('reap', 1), a('claim', 1, 2), a('fenced', 1),
    a('reap', 2), a('tick', 0, 0, 1), a('alarm'), a('tick', 0, 0, 1), a('alarm'), a('heartbeat'), a('heartbeat', 0, 1),
    ...sync, a('claim', 3), a('claim', 4, 1), a('released', 3),
    a('claim', 1), a('advance', 1), a('observe'), a('suspended', 1), a('post'), ...sync,
    a('claim', 1), a('suspended', 1, 0, 5), ...sync, a('confirm', 1),
    a('claim', 1), a('suspended', 1, 0, 5), ...sync, a('release', 1),
    a('hold', 1), a('claim', 1), a('lift', 1), a('claim', 1),
    a('advance', 1), a('advance', 1), a('advance', 1), a('advance', 1), a('advance', 1, 0, 3), a('advance', 1),
    a('done', 1, 0, 1), a('git', 1), a('git', 1), a('git', 1, 0, 2), ...sync,
    a('post'), a('claim', 2), a('withdraw', 2), ...sync,
    a('git', 3), ...sync, a('claim', 3), a('git', 3, 0, 5), ...sync,
  ], admin);
  expect([...covered]).toEqual(expect.arrayContaining([
    'several-claims', 'refused:max-claims', 'reap', 'fenced', 'fence-timeout', 'silence-reap',
    'released', 'sync-confirmed', 'owner-confirmed', 'release', 'hold', 'lift', 'started:fix', 'started:merge',
    'done-confirmed', 'stale', 'regressed', 'stale-observation',
  ]));
});

it('S-BTN-327: the same seed reproduces the shrunk action list', () => {
  // Deliberately fail the same arbitrary without depending on a defect in the core.
  const property = fc.property(actions, (list) => !list.some((a) => a.kind === 'claim' && a.ticket === 4));
  const first = fc.check(property, { seed: 327, numRuns: 32 });
  expect(first.failed).toBe(true);
  expect(first.numShrinks).toBeGreaterThan(0);
  const replay = fc.check(property, { seed: first.seed, path: first.counterexamplePath!, numRuns: 32 });
  expect(replay.counterexample).toEqual(first.counterexample);
});
