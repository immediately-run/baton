// policy.ts — the repository policy (BATON_SPEC §12.8 R-BTN-188, R-BTN-189, B-145): the knobs,
// their schemas, the presets, the guarantees computed over a version, the approver lists, the
// floors, and the store side — the append-only `repository_policies` log, `policy_floors`, the
// protection reports that feed `no-runner-lands` (R-BTN-180) and the policy pins trusted
// runners report (R-BTN-182). Pure first: the knob table, `validatePolicyDocument`, `diff`,
// the presets and `guaranteesOf` hold no I/O, no clock and no store, so both hosts and the
// tests can check them alone; the `Policies` class beside them is the store's side, the way
// registry.ts splits its checks from its store. Nothing compares a preset name outside the
// change log's `preset` column, and no knob is ever read from git, a board post or a course
// file.
import { BatonError } from './http';
import { logEvent } from './db';
import { KEY_FINGERPRINT } from './auth';
import { REPOSITORY_ID } from './validate';
import type { Store } from './ports';
import type { Forge } from './links';

// ── canonical JSON and the hash over it (R-BTN-188) ─────────────────────────────────────

/** RFC 8785 canonical JSON over the values a policy holds: objects with keys sorted by UTF-16
 *  code units, arrays in order, no whitespace, strings as JSON writes them, integers only —
 *  the validator admits no other number, so `String` is a number's one serialisation. An
 *  absent value (a knob a document leaves out, `leg_state` alone) reads as null: absent and
 *  explicit null are one value to a diff. */
export function canonicalJson(v: unknown): string {
  if (v === undefined) return 'null';
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) throw new BatonError('internal', 'a policy document holds integers only');
    return String(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  throw new BatonError('internal', 'a value no policy holds');
}

/** SHA-256 as hex, synchronous — the policy's hashes are computed inside the transaction that
 *  writes them, on either host, with no await to hold open. Checked against WebCrypto's digest
 *  by the unit tests. */
export function sha256HexSync(text: string): string {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const bytes = new TextEncoder().encode(text);
  const l = bytes.length;
  const padded = new Uint8Array(((l + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[l] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor(l / 0x20000000));
  dv.setUint32(padded.length - 4, (l << 3) >>> 0);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(block + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  return H.map((x) => x.toString(16).padStart(8, '0')).join('');
}

/** The policy document's hash: the SHA-256 over its canonical JSON (R-BTN-188). */
export const hashOfDocument = (policy: PolicyDocument): string => sha256HexSync(canonicalJson(policy));

// ── the knobs (R-BTN-188's table, as data) ──────────────────────────────────────────────

/** Who may update a ref class (R-BTN-180): the five writers a `refs.*` knob admits. */
export const REF_WRITERS = ['runner', 'trusted-runner', 'courier', 'mirror', 'human'] as const;
export type RefWriter = (typeof REF_WRITERS)[number];
/** Who may post the board (R-BTN-187): the three `inputs.board` admits. */
export const BOARD_INPUTS = ['sync-key', 'ci-identity', 'machine'] as const;
/** An approver-list entry (R-BTN-188): a class, or one named key. */
export type ApproverEntry = 'owner' | 'human' | `key:${string}`;
/** An attestation's or reading's writer class (R-BTN-181). */
export type WriterClass = 'human' | 'owner' | 'baton' | 'runner' | 'instrument' | 'admin' | `service:${string}`;

/** One outbox route's knob (R-BTN-171): who delivers, at what trust, and whether a release is
 *  minimally verified. `min_release` waits on B-64's deliverer; the knob carries it. */
export interface OutboxRoute {
  deliverers: ('courier' | 'trusted-runner')[];
  trust: 'any' | 'trusted';
  min_release?: 'any' | 'signed';
}

/** The policy document: every knob the spec's table names, `leg_state` alone optional (unset
 *  means `forge` on a repository with a forge and `branch` on one whose `forge` is `git`). */
export interface PolicyDocument {
  approvers: { members: ApproverEntry[]; trust: ApproverEntry[]; policy: ApproverEntry[] };
  human_key: 'any' | 'hardware';
  grants: { default_trust: 'trusted' | 'untrusted'; one_per_domain: boolean; trusted_domain: 'shared' | 'separate' };
  refs: Record<'default_branch' | 'tags' | 'other' | 'baton' | 'legs', RefWriter[]>;
  paths: { protected: string[]; control: 'any' | 'trusted-runner' | 'human'; tickets: 'any' | 'approval' };
  merge: { trusted: boolean; reviews: { count: number; distinct: ('trust_domain' | 'model_family')[] }; checks: 'optional' | 'required' };
  authorship: 'any' | 'signed';
  tickets: { created: 'filed' | 'proposed' };
  leg_state?: 'forge' | 'branch';
  outbox: { git: OutboxRoute; 'forge-check': OutboxRoute };
  inputs: { board: (typeof BOARD_INPUTS)[number][]; answers: 'git' | 'attestation' };
  attestations: Record<string, WriterClass[]>;
  readings: Record<string, { writers: WriterClass[]; signed: boolean }>;
}

/** Every knob's dotted name, in the table's order — `diff` reports these, the change log
 *  carries them, and nothing else is a knob. */
export const KNOBS = [
  'approvers.members', 'approvers.trust', 'approvers.policy', 'human_key',
  'grants.default_trust', 'grants.one_per_domain', 'grants.trusted_domain',
  'refs.default_branch', 'refs.tags', 'refs.other', 'refs.baton', 'refs.legs',
  'paths.protected', 'paths.control', 'paths.tickets',
  'merge.trusted', 'merge.reviews', 'merge.checks', 'authorship', 'tickets.created', 'leg_state',
  'outbox.git', 'outbox.forge-check', 'inputs.board', 'inputs.answers', 'attestations', 'readings',
] as const;
export type Knob = (typeof KNOBS)[number];

const bad = (field: string, why: string): never => {
  throw new BatonError('invalid-params', `${field}: ${why}`);
};
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const only = (b: Record<string, unknown>, keys: string[], at: string) => {
  for (const k of Object.keys(b)) if (!keys.includes(k)) bad(`${at}.${k}`, 'unknown field');
};

const APPROVERS_MAX = 8;
const PATHS_MAX = 64;
const ENTRIES_MAX = 32;
const ATTESTATION_TYPE = /^[a-z][a-z0-9-]{0,39}(:[a-z0-9][a-z0-9._-]{0,63})?@\d{1,4}$/;
const RESOURCE_NAME = /^[a-z][a-z0-9-]{0,39}$/;
const PATH_PATTERN = /^[!A-Za-z0-9_./*?[\]-]{1,200}$/;

/** An approver-list entry as the body carries it: `owner`, `human` or `key:<fingerprint>`. */
function checkEntry(v: unknown, at: string): ApproverEntry {
  if (v === 'owner' || v === 'human') return v;
  if (typeof v === 'string' && v.startsWith('key:')) {
    if (!KEY_FINGERPRINT.test(v.slice(4))) bad(at, 'names a key by its SHA256:… fingerprint');
    return v as ApproverEntry;
  }
  return bad(at, "must be 'owner', 'human' or 'key:<fingerprint>'");
}

/** A non-empty approver list (R-BTN-188: each `approvers.*` knob is one). */
function checkApproverList(v: unknown, at: string): ApproverEntry[] {
  if (!Array.isArray(v) || v.length < 1 || v.length > APPROVERS_MAX) bad(at, `must be a non-empty list of at most ${APPROVERS_MAX} entries`);
  const out = (v as unknown[]).map((e, i) => checkEntry(e, `${at}[${i}]`));
  if (new Set(out).size !== out.length) bad(at, 'names an entry twice');
  return out;
}

/** A writers list (R-BTN-181): the classes, and one key named `service:<fingerprint>`. */
function checkWriters(v: unknown, at: string): WriterClass[] {
  if (!Array.isArray(v) || v.length < 1 || v.length > ENTRIES_MAX) bad(at, `must be a non-empty list of at most ${ENTRIES_MAX} writers`);
  return (v as unknown[]).map((w, i) => {
    if (w === 'human' || w === 'owner' || w === 'baton' || w === 'runner' || w === 'instrument' || w === 'admin') return w;
    if (typeof w === 'string' && w.startsWith('service:')) {
      if (!KEY_FINGERPRINT.test(w.slice(8))) bad(`${at}[${i}]`, 'names a service key by its SHA256:… fingerprint');
      return w as WriterClass;
    }
    return bad(`${at}[${i}]`, "must be human, owner, baton, runner, instrument, admin or 'service:<fingerprint>'");
  });
}

function checkRefWriters(v: unknown, at: string): RefWriter[] {
  if (!Array.isArray(v) || v.length < 1 || v.length > REF_WRITERS.length) bad(at, `must be a non-empty list from ${REF_WRITERS.join(', ')}`);
  return (v as unknown[]).map((w, i) => (REF_WRITERS as readonly string[]).includes(w as string) ? w as RefWriter : bad(`${at}[${i}]`, `must be one of ${REF_WRITERS.join(', ')}`));
}

function checkOutboxRoute(v: unknown, at: string): OutboxRoute {
  const o: Record<string, unknown> = isObj(v) ? v : bad(at, 'must be {deliverers, trust, min_release?}');
  only(o, ['deliverers', 'trust', 'min_release'], at);
  const deliverers = Array.isArray(o.deliverers) && o.deliverers.length <= 2 && (o.deliverers as unknown[]).every((d) => d === 'courier' || d === 'trusted-runner')
    ? (o.deliverers as OutboxRoute['deliverers']) : bad(`${at}.deliverers`, "must be a list from 'courier', 'trusted-runner'");
  if (o.trust !== 'any' && o.trust !== 'trusted') bad(`${at}.trust`, "must be 'any' or 'trusted'");
  const min = o.min_release === undefined ? undefined : o.min_release === 'any' || o.min_release === 'signed' ? o.min_release : bad(`${at}.min_release`, "must be 'any' or 'signed'");
  return { deliverers, trust: o.trust as OutboxRoute['trust'], ...(min ? { min_release: min } : {}) };
}

/** A policy document as `PUT /v1/owner/{repository}/policy` carries it, or a preset expanded:
 *  every knob present, `leg_state` alone optional. Unknown knobs, values outside their schema,
 *  the writers a type `merge` or a trusted leg acts on may not take (R-BTN-181), and — on a
 *  `git` repository — the values a repository with no forge cannot use (R-BTN-188 `plain-git`)
 *  are refused here; the checks that need the store (a live credential behind a list, a
 *  `service:` key's roles) are the `Policies` class's. */
export function validatePolicyDocument(input: unknown, opts: { forge: Forge }): PolicyDocument {
  const v: Record<string, unknown> = isObj(input) ? input : bad('policy', 'must be a JSON object');
  only(v, ['approvers', 'human_key', 'grants', 'refs', 'paths', 'merge', 'authorship', 'tickets', 'leg_state', 'outbox', 'inputs', 'attestations', 'readings'], 'policy');
  const approvers = isObj(v.approvers) ? v.approvers : bad('policy.approvers', 'must be an object');
  only(approvers, ['members', 'trust', 'policy'], 'policy.approvers');
  const grants = isObj(v.grants) ? v.grants : bad('policy.grants', 'must be an object');
  only(grants, ['default_trust', 'one_per_domain', 'trusted_domain'], 'policy.grants');
  if (grants.default_trust !== 'trusted' && grants.default_trust !== 'untrusted') bad('policy.grants.default_trust', "must be 'trusted' or 'untrusted'");
  if (typeof grants.one_per_domain !== 'boolean') bad('policy.grants.one_per_domain', 'must be true or false');
  if (grants.trusted_domain !== 'shared' && grants.trusted_domain !== 'separate') bad('policy.grants.trusted_domain', "must be 'shared' or 'separate'");
  const refs = isObj(v.refs) ? v.refs : bad('policy.refs', 'must be an object');
  only(refs, ['default_branch', 'tags', 'other', 'baton', 'legs'], 'policy.refs');
  const paths = isObj(v.paths) ? v.paths : bad('policy.paths', 'must be an object');
  only(paths, ['protected', 'control', 'tickets'], 'policy.paths');
  const protectedPaths = Array.isArray(paths.protected) && paths.protected.length <= PATHS_MAX && (paths.protected as unknown[]).every((p) => typeof p === 'string' && PATH_PATTERN.test(p as string))
    ? (paths.protected as string[]) : bad('policy.paths.protected', `must be at most ${PATHS_MAX} path patterns`);
  if (new Set(protectedPaths).size !== protectedPaths.length) bad('policy.paths.protected', 'names a path twice');
  if (paths.control !== 'any' && paths.control !== 'trusted-runner' && paths.control !== 'human') bad('policy.paths.control', "must be 'any', 'trusted-runner' or 'human'");
  if (paths.tickets !== 'any' && paths.tickets !== 'approval') bad('policy.paths.tickets', "must be 'any' or 'approval'");
  const merge = isObj(v.merge) ? v.merge : bad('policy.merge', 'must be an object');
  only(merge, ['trusted', 'reviews', 'checks'], 'policy.merge');
  if (typeof merge.trusted !== 'boolean') bad('policy.merge.trusted', 'must be true or false');
  const reviews = isObj(merge.reviews) ? merge.reviews : bad('policy.merge.reviews', 'must be {count, distinct}');
  only(reviews, ['count', 'distinct'], 'policy.merge.reviews');
  if (!Number.isInteger(reviews.count) || (reviews.count as number) < 0 || (reviews.count as number) > 10) bad('policy.merge.reviews.count', 'must be an integer from 0 to 10');
  const distinct = Array.isArray(reviews.distinct) && (reviews.distinct as unknown[]).every((d) => d === 'trust_domain' || d === 'model_family')
    ? (reviews.distinct as ('trust_domain' | 'model_family')[]) : bad('policy.merge.reviews.distinct', "must name 'trust_domain', 'model_family' or neither");
  if (new Set(distinct).size !== distinct.length) bad('policy.merge.reviews.distinct', 'names a field twice');
  if (merge.checks !== 'optional' && merge.checks !== 'required') bad('policy.merge.checks', "must be 'optional' or 'required'");
  if (v.authorship !== 'any' && v.authorship !== 'signed') bad('policy.authorship', "must be 'any' or 'signed'");
  const tickets = isObj(v.tickets) ? v.tickets : bad('policy.tickets', 'must be an object');
  only(tickets, ['created'], 'policy.tickets');
  if (tickets.created !== 'filed' && tickets.created !== 'proposed') bad('policy.tickets.created', "must be 'filed' or 'proposed'");
  if (v.leg_state !== undefined && v.leg_state !== 'forge' && v.leg_state !== 'branch') bad('policy.leg_state', "must be 'forge' or 'branch'");
  const outbox = isObj(v.outbox) ? v.outbox : bad('policy.outbox', 'must be an object');
  only(outbox, ['git', 'forge-check'], 'policy.outbox');
  const outboxGit = checkOutboxRoute(outbox.git, 'policy.outbox.git');
  const outboxForgeCheck = checkOutboxRoute(outbox['forge-check'], 'policy.outbox.forge-check');
  const inputs = isObj(v.inputs) ? v.inputs : bad('policy.inputs', 'must be an object');
  only(inputs, ['board', 'answers'], 'policy.inputs');
  const board = Array.isArray(inputs.board) && inputs.board.length >= 1 && (inputs.board as unknown[]).every((b) => (BOARD_INPUTS as readonly string[]).includes(b as string))
    ? (inputs.board as PolicyDocument['inputs']['board']) : bad('policy.inputs.board', `must be a non-empty list from ${BOARD_INPUTS.join(', ')}`);
  if (new Set(board).size !== board.length) bad('policy.inputs.board', 'names an input twice');
  if (inputs.answers !== 'git' && inputs.answers !== 'attestation') bad('policy.inputs.answers', "must be 'git' or 'attestation'");
  if (v.human_key !== 'any' && v.human_key !== 'hardware') bad('policy.human_key', "must be 'any' or 'hardware'");
  const refsOf: PolicyDocument['refs'] = {
    default_branch: checkRefWriters(refs.default_branch, 'policy.refs.default_branch'),
    tags: checkRefWriters(refs.tags, 'policy.refs.tags'),
    other: checkRefWriters(refs.other, 'policy.refs.other'),
    baton: checkRefWriters(refs.baton, 'policy.refs.baton'),
    legs: checkRefWriters(refs.legs, 'policy.refs.legs'),
  };

  // R-BTN-188 (a repository with no forge cannot use them, R-BTN-92): `leg_state: forge`, a
  // `forge-check` deliverer (check runs are GitHub's, R-BTN-115) and `ci-identity` in
  // `inputs.board` (CI identity tokens are GitHub's and GitLab's, R-BTN-156).
  if (opts.forge === 'git') {
    if (v.leg_state === 'forge') bad('policy.leg_state', "a git repository has no forge conversation: 'branch' or unset");
    if (board.includes('ci-identity')) bad('policy.inputs.board', "a git repository has no CI identity: 'ci-identity' is a forge's");
    if (outboxForgeCheck.deliverers.length) bad('policy.outbox.forge-check.deliverers', 'a git repository has no check runs to check: no forge-check deliverer');
  }

  // R-BTN-180: Baton refuses a policy whose writes could never land — one whose `outbox.git`
  // admits a class (courier or trusted-runner) that `refs.default_branch` (under
  // `tickets.created: filed`) or `refs.other` (under `proposed`) excludes, and one whose
  // `refs.default_branch` excludes `runner` while `tickets.created` is `filed`, since a runner
  // then files tickets nowhere (R-BTN-161, R-BTN-165).
  const landingRef = tickets.created === 'filed' ? 'default_branch' : 'other';
  for (const d of outboxGit.deliverers) {
    if (!refsOf[landingRef].includes(d)) {
      bad('policy.outbox.git', `admits ${d}, which refs.${landingRef} excludes under tickets.created: ${tickets.created} — its writes could never land (R-BTN-180)`);
    }
  }
  if (tickets.created === 'filed' && !refsOf.default_branch.includes('runner')) {
    bad('policy.refs.default_branch', "excludes 'runner' while tickets.created is 'filed': a runner would file tickets nowhere (R-BTN-180)");
  }

  const attestations: Record<string, WriterClass[]> = {};
  const attObj: Record<string, unknown> = isObj(v.attestations) ? v.attestations : bad('policy.attestations', 'must be an object');
  for (const [type, writers] of Object.entries(attObj)) {
    if (!ATTESTATION_TYPE.test(type)) bad(`policy.attestations.${type}`, 'must be a schema id, <std:|course:>type@n');
    // R-BTN-181: for a type merge or a trusted leg acts on — the `std:` types — only `human`,
    // `baton` and `service:` keys are admitted (a `service:` key's roles are the store's check).
    const list = checkWriters(writers, `policy.attestations.${type}`);
    if (type.startsWith('std:')) {
      for (const w of list) {
        if (w !== 'human' && w !== 'baton' && !w.startsWith('service:')) {
          bad(`policy.attestations.${type}`, `admits ${w}: a std: type merge or a trusted leg acts on takes only human, baton and service: writers (R-BTN-181)`);
        }
      }
    }
    attestations[type] = list;
  }
  const readings: Record<string, { writers: WriterClass[]; signed: boolean }> = {};
  const readObj: Record<string, unknown> = isObj(v.readings) ? v.readings : bad('policy.readings', 'must be an object');
  for (const [resource, rawEntry] of Object.entries(readObj)) {
    if (resource !== '*' && !RESOURCE_NAME.test(resource)) bad(`policy.readings.${resource}`, "must be a resource name or '*'");
    const entry: Record<string, unknown> = isObj(rawEntry) ? rawEntry : bad(`policy.readings.${resource}`, 'must be {writers, signed}');
    only(entry, ['writers', 'signed'], `policy.readings.${resource}`);
    // R-BTN-181/R-BTN-76: a reading's writers are the classes that may report one —
    // administrators, instrument keys and runners, beside one named `service:` key. Which of
    // them count for a resource a trusted leg requires (instrument, admin and service: only,
    // signed) is judged where a requirement names the resource, once B-146 builds them.
    const list = checkWriters(entry.writers, `policy.readings.${resource}.writers`);
    for (const w of list) {
      if (w !== 'instrument' && w !== 'admin' && w !== 'runner' && !w.startsWith('service:')) {
        bad(`policy.readings.${resource}.writers`, `admits ${w}: a reading's writers are instrument, admin, runner and service: keys (R-BTN-76, R-BTN-181)`);
      }
    }
    if (typeof entry.signed !== 'boolean') bad(`policy.readings.${resource}.signed`, 'must be true or false');
    readings[resource] = { writers: list, signed: entry.signed as boolean };
  }
  return {
    approvers: {
      members: checkApproverList(approvers.members, 'policy.approvers.members'),
      trust: checkApproverList(approvers.trust, 'policy.approvers.trust'),
      policy: checkApproverList(approvers.policy, 'policy.approvers.policy'),
    },
    human_key: v.human_key as PolicyDocument['human_key'],
    grants: { default_trust: grants.default_trust as PolicyDocument['grants']['default_trust'], one_per_domain: grants.one_per_domain as boolean, trusted_domain: grants.trusted_domain as PolicyDocument['grants']['trusted_domain'] },
    refs: refsOf,
    paths: { protected: protectedPaths, control: paths.control as PolicyDocument['paths']['control'], tickets: paths.tickets as PolicyDocument['paths']['tickets'] },
    merge: { trusted: merge.trusted as boolean, reviews: { count: reviews.count as number, distinct }, checks: merge.checks as PolicyDocument['merge']['checks'] },
    authorship: v.authorship as PolicyDocument['authorship'],
    tickets: { created: tickets.created as PolicyDocument['tickets']['created'] },
    ...(v.leg_state !== undefined ? { leg_state: v.leg_state as 'forge' | 'branch' } : {}),
    outbox: { git: outboxGit, 'forge-check': outboxForgeCheck },
    inputs: { board, answers: inputs.answers as PolicyDocument['inputs']['answers'] },
    attestations,
    readings,
  };
}

/** One knob's value, read out of a document by its dotted path. */
function knobOf(doc: PolicyDocument, knob: Knob): unknown {
  return knob.split('.').reduce<unknown>((v, seg) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[seg] : undefined), doc);
}

/** The knobs a change from `old` to `new` touches, in `KNOBS`'s order: the change log's
 *  `changed` and the diff the CLI prints. Compared canonically — a document stored canonical
 *  and one the validator rebuilt differ in key order alone, which is no change. */
export function diffPolicies(oldPolicy: PolicyDocument, newPolicy: PolicyDocument): Knob[] {
  return KNOBS.filter((k) => canonicalJson(knobOf(oldPolicy, k)) !== canonicalJson(knobOf(newPolicy, k)));
}

// ── the presets (R-BTN-188's columns, as documents) ─────────────────────────────────────

/** The `cooperative` column: a new repository's policy on a forge. */
export const COOPERATIVE: PolicyDocument = {
  approvers: { members: ['owner'], trust: ['owner'], policy: ['owner'] },
  human_key: 'any',
  grants: { default_trust: 'trusted', one_per_domain: false, trusted_domain: 'shared' },
  refs: {
    default_branch: ['runner', 'trusted-runner', 'courier', 'mirror', 'human'],
    tags: ['runner', 'trusted-runner', 'courier', 'mirror', 'human'],
    other: ['runner', 'trusted-runner', 'courier', 'mirror', 'human'],
    baton: ['runner', 'trusted-runner', 'courier', 'mirror', 'human'],
    legs: ['runner', 'trusted-runner', 'human'],
  },
  paths: { protected: [], control: 'any', tickets: 'any' },
  merge: { trusted: false, reviews: { count: 0, distinct: [] }, checks: 'optional' },
  authorship: 'any',
  tickets: { created: 'filed' },
  outbox: {
    git: { deliverers: ['courier'], trust: 'any' },
    'forge-check': { deliverers: ['courier'], trust: 'any' },
  },
  inputs: { board: ['sync-key', 'ci-identity', 'machine'], answers: 'git' },
  // R-BTN-181's standard writers, `std:checks@1` alone absent until the owner names the trusted
  // executor's `service:` key.
  attestations: { 'std:wrote@1': ['baton'], 'std:ran@1': ['baton'], 'std:review@1': ['baton'], 'std:approval@1': ['human'], 'std:branch-deletion@1': ['baton'] },
  readings: { '*': { writers: ['admin', 'instrument', 'runner'], signed: false } },
};

/** The `protected` column. */
export const PROTECTED: PolicyDocument = {
  ...COOPERATIVE,
  approvers: { members: ['human'], trust: ['human'], policy: ['human'] },
  grants: { default_trust: 'untrusted', one_per_domain: true, trusted_domain: 'separate' },
  refs: {
    ...COOPERATIVE.refs,
    default_branch: ['trusted-runner', 'human'],
    tags: ['trusted-runner', 'human'],
    other: ['trusted-runner', 'human'],
  },
  paths: { protected: [], control: 'human', tickets: 'approval' },
  merge: { trusted: true, reviews: { count: 2, distinct: ['trust_domain', 'model_family'] }, checks: 'required' },
  tickets: { created: 'proposed' },
  outbox: {
    git: { deliverers: ['trusted-runner'], trust: 'trusted' },
    'forge-check': { deliverers: ['courier'], trust: 'trusted' },
  },
  inputs: { board: ['sync-key', 'ci-identity'], answers: 'attestation' },
};

/** The `protected-signed` column: `protected` except `human_key` and `authorship`. */
export const PROTECTED_SIGNED: PolicyDocument = { ...PROTECTED, human_key: 'hardware', authorship: 'signed' };

/** The `plain-git` preset: `cooperative` with what a repository with no forge cannot use taken
 *  out — `leg_state: branch` (R-BTN-190), `inputs.board` without `ci-identity`, and no
 *  `forge-check` deliverer. */
export const PLAIN_GIT: PolicyDocument = {
  ...COOPERATIVE,
  leg_state: 'branch',
  inputs: { board: ['sync-key', 'machine'], answers: 'git' },
  outbox: { ...COOPERATIVE.outbox, 'forge-check': { deliverers: [], trust: 'any' } },
};

export const PRESETS = { cooperative: COOPERATIVE, protected: PROTECTED, 'protected-signed': PROTECTED_SIGNED, 'plain-git': PLAIN_GIT } as const;
export type PresetName = keyof typeof PRESETS;

/** A preset applied to a repository on `forge` (R-BTN-188): it writes every knob it has a value
 *  for — and, where `forge` is `git`, the same three values `plain-git` carries, the preset's
 *  `inputs.board` keeping only what a git repository may take. */
export function policyForPreset(name: PresetName, forge: Forge): PolicyDocument {
  const doc = structuredClone(PRESETS[name]);
  if (forge !== 'git') return doc;
  const board = doc.inputs.board.filter((b) => b !== 'ci-identity');
  return { ...doc, leg_state: 'branch', inputs: { ...doc.inputs, board: board.length ? board : ['sync-key'] }, outbox: { ...doc.outbox, 'forge-check': { deliverers: [], trust: 'any' } } };
}

/** Where state one leg hands the next lives (R-BTN-188's `leg_state`): unset means `forge` on a
 *  repository with a forge and `branch` on one whose `forge` is `git`, where `forge` is refused. */
export function legStateOf(policy: PolicyDocument, forge: Forge): 'forge' | 'branch' {
  if (policy.leg_state !== undefined) return policy.leg_state;
  return forge === 'git' ? 'branch' : 'forge';
}

// ── the guarantees (R-BTN-189's table) ──────────────────────────────────────────────────

export const GUARANTEE_NAMES = [
  'no-runner-lands', 'control-paths-human', 'tickets-approved', 'independent-review', 'signed-authorship',
  'trusted-domain-separate', 'human-gates', 'human-gates-hardware', 'board-from-trusted',
] as const;
export type GuaranteeName = (typeof GUARANTEE_NAMES)[number];

/** A list admits only writers from `allowed`. */
const admitsOnly = (list: readonly string[], allowed: readonly string[]) => list.length > 0 && list.every((x) => allowed.includes(x));

/** Whether every entry of an approver list is `human` or names a key marked `human_only` —
 *  `humanKeys` holds every fingerprint a `human` entry counts (R-BTN-185's human-only lists). */
export function humanOnlyList(list: ApproverEntry[], humanKeys: ReadonlySet<string>): boolean {
  return list.every((e) => e === 'human' || (e.startsWith('key:') && humanKeys.has(e.slice(4))));
}

/** R-BTN-189's table over one version. The protection report is applied separately: with
 *  `protection` true, `no-runner-lands` needs the checker's latest report to have matched
 *  within 24 hours; with `protection` undefined the guarantee is judged on the policy alone —
 *  the mode a floor is judged in, the report never being a policy condition. */
export function guaranteesOf(policy: PolicyDocument, opts: { protection?: boolean; humanKeys?: ReadonlySet<string> } = {}): Record<GuaranteeName, boolean> {
  const refsLand = admitsOnly(policy.refs.default_branch, ['trusted-runner', 'human'])
    && admitsOnly(policy.refs.tags, ['trusted-runner', 'human'])
    && admitsOnly(policy.refs.other, ['trusted-runner', 'human']);
  const reported = opts.protection === undefined ? true : opts.protection;
  const noRunnerLands = refsLand && policy.paths.control !== 'any' && policy.merge.trusted
    && policy.tickets.created === 'proposed'
    && admitsOnly(policy.outbox.git.deliverers, ['trusted-runner']) && policy.outbox.git.trust === 'trusted'
    && reported;
  const att = (type: string): WriterClass[] | undefined => policy.attestations[type];
  const attOnly = (type: string, writer: WriterClass) => att(type) !== undefined && att(type)!.every((w) => w === writer);
  const humans = opts.humanKeys ?? new Set<string>();
  const gates = humanOnlyList(policy.approvers.members, humans) && humanOnlyList(policy.approvers.trust, humans) && humanOnlyList(policy.approvers.policy, humans);
  return {
    'no-runner-lands': noRunnerLands,
    'control-paths-human': noRunnerLands && policy.paths.control === 'human',
    'tickets-approved': noRunnerLands && policy.paths.tickets === 'approval' && policy.tickets.created === 'proposed' && attOnly('std:approval@1', 'human'),
    'independent-review': noRunnerLands && policy.merge.reviews.count >= 2
      && policy.merge.reviews.distinct.includes('trust_domain') && policy.merge.reviews.distinct.includes('model_family')
      && policy.grants.one_per_domain
      && ['std:review@1', 'std:wrote@1', 'std:ran@1'].every((t) => attOnly(t, 'baton')),
    'signed-authorship': noRunnerLands && policy.authorship === 'signed',
    'trusted-domain-separate': policy.grants.trusted_domain === 'separate' && policy.grants.default_trust === 'untrusted',
    'human-gates': gates,
    'human-gates-hardware': gates && policy.human_key === 'hardware',
    'board-from-trusted': noRunnerLands && !policy.inputs.board.includes('machine') && policy.inputs.answers === 'attestation',
  };
}

// ── the store's side ────────────────────────────────────────────────────────────────────

/** One version row of the append-only log. */
export interface PolicyVersionRow {
  repository_id: string;
  version: number;
  policy_json: string;
  hash: string;
  previous_hash: string | null;
  changed_by: string;
  approver: string | null;
  preset: string | null;
  at: number;
}

/** A floor a deployment registered (R-BTN-189). */
export interface FloorRow {
  repository_id: string;
  name: string;
  guarantees: string[];
  remove_by: 'human' | 'owner';
  added_by: string;
  added_at: number;
}

/** What a heartbeat's protection report says (R-BTN-180). */
export interface ProtectionReport { repository: string; matched: boolean; reading_hash: string; legs?: { count: number; tickets: number } }
/** What a heartbeat's policy pins say (R-BTN-189). */
export interface PolicyPin { repository: string; hash: string; floors_hash?: string }

/** A repository's live owners, and the human-only keys among them — everything the approver
 *  checks read. `humans` is every fingerprint a `human` entry counts when ACTING: the
 *  repository's `human_only` owners, the tenant's registered human keys, and the host's
 *  BATON_HUMAN_KEYS lines; `breakGlass` is those lines alone (R-BTN-185: the deployment's root
 *  of trust, which satisfies every `human` entry of every repository on the instance, whatever
 *  `human_key` asks, and is the only recovery from a lost key). `humanOwners` is the
 *  repository's owners alone that are human keys by their own mark or the tenant's register —
 *  break-glass excluded: R-BTN-188's no-gate rule needs "a `human_only` key meeting the
 *  resulting `human_key` among the repository's owners", so a list a break-glass key alone
 *  could satisfy is a gate with no key to open it. */
export interface ApproverFacts {
  owners: Map<string, { human_only: boolean; fido_attestation: string | null }>;
  humans: Set<string>;
  breakGlass: Set<string>;
  humanOwners: Set<string>;
}

const FLOOR_NAME = /^[a-z][a-z0-9-]{0,39}$/;
/** A protection report feeds `no-runner-lands` this long (R-BTN-180). */
export const PROTECTION_WINDOW_MS = 24 * 3_600_000;

export class Policies {
  /** Baton's own callback: a floored guarantee broke on `repository`, and every running claim
   *  on a ticket that reaches it is released `released:floor` (R-BTN-189) — the claims' half
   *  lives in claims.ts, wired by the core like every other cross-link. */
  releaseForFloor: ((repository: string) => void) | null = null;

  constructor(private readonly c: { store: Store; now: () => number }) {}

  private rows<T = Record<string, unknown>>(q: string, ...p: unknown[]): T[] {
    return this.c.store.exec<T>(q, ...p).toArray() as T[];
  }
  private exec(q: string, ...p: unknown[]) {
    return this.c.store.exec(q, ...p);
  }

  /** Every repository's version 1, at start: the `cooperative` preset on a forge, `plain-git`
   *  where `forge` is `git` (R-BTN-188). Idempotent, like `ensure`. */
  seedAll(): void {
    for (const r of this.rows<{ id: string; forge: Forge }>('SELECT id, forge FROM repositories')) this.ensure(r.id, r.forge);
  }

  /** The repository's first version, if it has none — written `server`, the preset named in the
   *  `preset` column alone (R-BTN-188: nowhere else is a preset name stored). */
  ensure(repository: string, forge: Forge): void {
    if (this.rows('SELECT 1 FROM repository_policies WHERE repository_id = ? AND version = 1', repository).length) return;
    const preset: PresetName = forge === 'git' ? 'plain-git' : 'cooperative';
    const doc = policyForPreset(preset, forge);
    this.exec('INSERT INTO repository_policies (repository_id, version, policy_json, hash, previous_hash, changed_by, approver, preset, at) VALUES (?, 1, ?, ?, NULL, ?, NULL, ?, ?)',
      repository, canonicalJson(doc), hashOfDocument(doc), 'server', preset, this.c.now());
  }

  /** The current version: its number, its hash and its document. */
  current(repository: string): { version: number; hash: string; policy: PolicyDocument; at: number } | null {
    const r = this.rows<PolicyVersionRow>('SELECT * FROM repository_policies WHERE repository_id = ? ORDER BY version DESC LIMIT 1', repository)[0];
    return r ? { version: r.version, hash: r.hash, policy: JSON.parse(r.policy_json) as PolicyDocument, at: r.at } : null;
  }

  /** The append-only log after `after` (R-BTN-188), each version with the knobs it changed. */
  log(repository: string, after: number): { version: number; hash: string; previous_hash: string | null; changed_by: string; approver: string | null; preset: string | null; at: number; changed: Knob[] }[] {
    const from = Number.isSafeInteger(after) ? after : 0;
    const docs = new Map<number, PolicyDocument>(this.rows<{ version: number; policy_json: string }>('SELECT version, policy_json FROM repository_policies WHERE repository_id = ? AND version >= ? ORDER BY version', repository, Math.max(1, from))
      .map((r) => [r.version, JSON.parse(r.policy_json) as PolicyDocument]));
    return this.rows<{ version: number; hash: string; previous_hash: string | null; changed_by: string; approver: string | null; preset: string | null; at: number }>(
      'SELECT version, hash, previous_hash, changed_by, approver, preset, at FROM repository_policies WHERE repository_id = ? AND version > ? ORDER BY version', repository, from)
      .map((r) => {
        // Version 1 is the seed: nothing came before it, so nothing changed (a git repository's
        // `plain-git` seed is not a change from `cooperative` — the baseline a diff needs does
        // not exist).
        const before = r.version === 1 ? null : docs.get(r.version - 1) ?? null;
        return { ...r, changed: before ? diffPolicies(before, docs.get(r.version) ?? before) : [] };
      });
  }

  /** The live floors (R-BTN-189). */
  floors(repository: string): FloorRow[] {
    return this.rows<{ repository_id: string; name: string; guarantees: string; remove_by: 'human' | 'owner'; added_by: string; added_at: number }>(
      'SELECT * FROM policy_floors WHERE repository_id = ? ORDER BY name', repository)
      .map((f) => ({ ...f, guarantees: JSON.parse(f.guarantees) as string[] }));
  }

  /** The SHA-256 over the canonical floors list — a claim response and a trusted runner's pin. */
  floorsHashOf(floors: FloorRow[]): string {
    return sha256HexSync(canonicalJson(floors.map(({ name, guarantees, remove_by }) => ({ guarantees: [...guarantees].sort(), name, remove_by })).sort((a, b) => (a.name < b.name ? -1 : 1))));
  }

  /** The SHA-256 over the canonical guarantees map. */
  guaranteesHashOf(guarantees: Record<GuaranteeName, boolean>): string {
    return sha256HexSync(canonicalJson(Object.fromEntries(GUARANTEE_NAMES.map((n) => [n, guarantees[n]]))));
  }

  /** Whether the protection checker's latest report feeds `no-runner-lands`: one within 24
   *  hours that matched, with no open `baton.unprotected` (a report that did not match or
   *  differed from the previous reading, R-BTN-180). */
  protectionOk(repository: string): boolean {
    const r = this.rows<{ matched: number; at: number }>('SELECT matched, at FROM protection_reports WHERE repository_id = ?', repository)[0];
    if (!r || !r.matched || this.c.now() - r.at >= PROTECTION_WINDOW_MS) return false;
    return !this.rows('SELECT 1 FROM policy_conditions WHERE repository_id = ? AND type = ? AND ref = ? AND closed_at IS NULL', repository, 'baton.unprotected', '').length;
  }

  /** The guarantees over the current version, the protection report applied. */
  guaranteesFor(repository: string): { guarantees: Record<GuaranteeName, boolean>; guarantees_hash: string } {
    const cur = this.current(repository);
    const guarantees = guaranteesOf(cur?.policy ?? COOPERATIVE, { protection: this.protectionOk(repository), humanKeys: this.facts(repository).humans });
    return { guarantees, guarantees_hash: this.guaranteesHashOf(guarantees) };
  }

  /** The policy facts a claim response and a heartbeat carry (R-BTN-189). */
  hashesFor(repository: string): { version: number; policy_hash: string; guarantees_hash: string; floors_hash: string } | null {
    const cur = this.current(repository);
    if (!cur) return null;
    return { version: cur.version, policy_hash: cur.hash, ...this.guaranteesFor(repository), floors_hash: this.floorsHashOf(this.floors(repository)) };
  }

  // ── approvers (R-BTN-188) ──────────────────────────────────────────────────────────────

  /** The facts every approver check reads: the repository's live owners (with their human-only
   *  marks) and every fingerprint a `human` entry counts. `breakGlass` — BATON_HUMAN_KEYS'
   *  fingerprints — is passed by the routes that judge an acting credential or a list's
   *  satisfiability (R-BTN-185); the guarantee computations read the owners' own marks. */
  facts(repository: string, breakGlass: ReadonlySet<string> = new Set()): ApproverFacts {
    const owners = new Map(this.rows<{ fingerprint: string; human_only: number; fido_attestation: string | null }>(
      'SELECT fingerprint, human_only, fido_attestation FROM repository_owners WHERE repository_id = ? AND removed_at IS NULL', repository)
      .map((o) => [o.fingerprint, { human_only: !!o.human_only, fido_attestation: o.fido_attestation }]));
    const registered = new Set(this.rows<{ fingerprint: string }>('SELECT fingerprint FROM human_keys WHERE revoked_at IS NULL').map((r) => r.fingerprint));
    const humans = new Set<string>(breakGlass);
    const humanOwners = new Set<string>();
    for (const [fp, o] of owners) {
      // A `human_only` mark, or the tenant's register, makes an owner a human key — even if its
      // row lost the mark.
      if (o.human_only || registered.has(fp)) {
        humans.add(fp);
        humanOwners.add(fp);
      }
    }
    return { owners, humans, breakGlass: new Set(breakGlass), humanOwners };
  }

  /** R-BTN-185: whether a human-only owner key meets `human_key` — `any` always; `hardware`
   *  only with a FIDO attestation (B-136 builds the attestation check; until it does, no key
   *  carries one, and only break-glass meets `hardware`). */
  private meetsHumanKey(owner: { human_only: boolean; fido_attestation: string | null }, humanKey: 'any' | 'hardware'): boolean {
    if (!owner.human_only) return false;
    return humanKey === 'any' || owner.fido_attestation != null;
  }

  /** Whether `credential` matches an approver entry of `list`, as it stands (R-BTN-188): an
   *  owner key matches `owner`; a `human` entry needs a `human_only` owner meeting `human_key`,
   *  or a break-glass key; a `key:` entry names one live owner key, meeting `human_key` when
   *  it is a `human_only` key. A delegated key (R-BTN-130) matches no entry — none is
   *  registered yet (B-124 builds them); when one is, its class answers before this runs. */
  entryMatches(list: ApproverEntry[], credential: string, facts: ApproverFacts, humanKey: 'any' | 'hardware'): boolean {
    for (const e of list) {
      if (e === 'owner') {
        if (facts.owners.has(credential)) return true;
      } else if (e === 'human') {
        if (this.humanEntryOk(credential, facts, humanKey)) return true;
      } else if (e === `key:${credential}`) {
        const o = facts.owners.get(credential);
        if (o && (!o.human_only || this.meetsHumanKey(o, humanKey))) return true;
      }
    }
    return false;
  }

  /** A `human` entry's key: break-glass always — R-BTN-185: the host's configuration satisfies
   *  every `human` entry of every repository, and no `human_key` rises above it; any other key
   *  needs a `human_only` owner's mark meeting the repository's `human_key`. */
  private humanEntryOk(credential: string, facts: ApproverFacts, humanKey: 'any' | 'hardware'): boolean {
    if (facts.breakGlass.has(credential)) return true;
    const o = facts.owners.get(credential);
    return o !== undefined && facts.humans.has(credential) && this.meetsHumanKey(o, humanKey);
  }

  /** R-BTN-188's no-gate-without-a-key: whether some live credential could satisfy `list` —
   *  `owner` needs a live owner, a `human` entry a human-only key among the repository's OWNERS
   *  meeting `human_key` (break-glass never opens a gate: it is the acting root of trust, not
   *  an owner; a repository whose human lists only break-glass could satisfy has no key to open
   *  them), a `key:` entry a live owner of its own. */
  listSatisfiable(list: ApproverEntry[], facts: ApproverFacts, humanKey: 'any' | 'hardware'): boolean {
    return list.some((e) => {
      if (e === 'owner') return facts.owners.size > 0;
      if (e === 'human') {
        return [...facts.humanOwners].some((fp) => this.meetsHumanKey({ human_only: true, fido_attestation: facts.owners.get(fp)?.fido_attestation ?? null }, humanKey));
      }
      const o = facts.owners.get(e.slice(4));
      return o !== undefined && (!o.human_only || this.meetsHumanKey(o, humanKey));
    });
  }

  // ── the change (R-BTN-188, R-BTN-189) ──────────────────────────────────────────────────

  /** `PUT /v1/owner/{repository}/policy {base_version, policy | preset}` — in the caller's one
   *  transaction: the compare-and-set on `base_version`, the approver check against the list in
   *  force, the satisfiable-list refusal, the floors re-checked against the new version, the
   *  trust clearing when `approvers.trust` becomes human-only, and the append-only insert with
   *  its `admin` event. `breakGlass` is BATON_HUMAN_KEYS' fingerprints (R-BTN-185). */
  put(repository: string, input: unknown, forge: Forge, actor: { credential: string; label: string }, breakGlass: ReadonlySet<string>): { version: number; hash: string; changed: Knob[]; guarantees: Record<GuaranteeName, boolean> } {
    const body: Record<string, unknown> = isObj(input) ? input : bad('body', 'must be a JSON object');
    only(body, ['base_version', 'policy', 'preset'], 'body');
    if (!Number.isSafeInteger(body.base_version) || (body.base_version as number) < 1) bad('base_version', 'must be the version the change builds on');
    if (body.policy !== undefined && body.preset !== undefined) bad('body', 'carries either a policy or a preset, not both');
    const cur = this.current(repository);
    if (!cur) throw new BatonError('not-found', `${repository} has no policy yet`);
    if (body.base_version !== cur.version) throw new BatonError('conflict', `base_version ${body.base_version} is stale: the policy is at version ${cur.version}`);

    let doc: PolicyDocument;
    let preset: string | null = null;
    if (body.preset !== undefined) {
      if (typeof body.preset !== 'string' || !(body.preset in PRESETS)) bad('preset', `must be one of ${Object.keys(PRESETS).join(', ')}`);
      preset = body.preset as string;
      doc = policyForPreset(body.preset as PresetName, forge);
    } else {
      doc = validatePolicyDocument(body.policy, { forge });
    }

    // The list in force decides (R-BTN-188): every change, in any direction, needs an approver
    // on `approvers.policy` as it stands before the change.
    const factsNow = this.facts(repository, breakGlass);
    if (!this.entryMatches(cur.policy.approvers.policy, actor.credential, factsNow, cur.policy.human_key)) {
      throw new BatonError('forbidden', 'this credential is not an approver on approvers.policy as it stands (R-BTN-188)');
    }
    const approver = cur.policy.approvers.policy.find((e) => this.entryMatches([e], actor.credential, factsNow, cur.policy.human_key)) ?? 'owner';

    // No gate without a key to open it (R-BTN-188, R-BTN-185): the new lists must be
    // satisfiable, under the new `human_key` for their `human` entries.
    for (const [name, list] of [['approvers.members', doc.approvers.members], ['approvers.trust', doc.approvers.trust], ['approvers.policy', doc.approvers.policy]] as const) {
      if (!this.listSatisfiable(list, factsNow, doc.human_key)) {
        throw new BatonError('unsatisfiable-approvers', `${name}: no live credential can satisfy it (R-BTN-188)`, { list: name });
      }
    }
    for (const v of this.serviceWriterViolations(doc)) bad('policy', v);

    // R-BTN-188: a policy that live grants already break is refused — `one_per_domain` and
    // `trusted_domain: separate`, naming them. `one_per_domain` counts GRANTS (at most one
    // active grant per trust domain, couriers are not grants); `separate` needs a trusted
    // entry's domain shared with no other grant or courier (an untrusted grant's domain it
    // leaves alone). A courier registers one row per ask, so its rows are one courier; only a
    // set trust domain collides — a grant with a null domain is not offered work instead
    // (B-147 reads it so).
    if (doc.grants.one_per_domain || doc.grants.trusted_domain === 'separate') {
      const grants = this.rows<{ credential_id: string; trust_level: string | null; trust_domain: string | null }>(
        'SELECT credential_id, trust_level, trust_domain FROM worker_grants WHERE repository_id = ? AND revoked_at IS NULL AND trust_domain IS NOT NULL', repository);
      const couriers = [...new Map(this.rows<{ credential_id: string; trust_level: string | null; trust_domain: string | null }>(
        'SELECT credential_id, trust_level, trust_domain FROM couriers WHERE repository_id = ? AND trust_domain IS NOT NULL', repository).map((c) => [c.credential_id, c])).values()];
      const byDomain = new Map<string, { who: string; grant: boolean; trusted: boolean }[]>();
      for (const x of [...grants.map((g) => ({ ...g, grant: true })), ...couriers.map((c) => ({ ...c, grant: false }))]) {
        byDomain.set(x.trust_domain!, [...(byDomain.get(x.trust_domain!) ?? []), { who: `${x.grant ? 'grant' : 'courier'}:${x.credential_id}`, grant: x.grant, trusted: x.trust_level === 'trusted' }]);
      }
      for (const [domain, es] of byDomain) {
        if (doc.grants.one_per_domain && es.filter((e) => e.grant).length > 1) {
          bad('policy.grants.one_per_domain', `trust domain ${domain} already holds the grants ${es.filter((e) => e.grant).map((e) => e.who).join(', ')} (R-BTN-188)`);
        }
        if (doc.grants.trusted_domain === 'separate' && es.length > 1 && es.some((e) => e.trusted)) {
          bad('policy.grants.trusted_domain', `trust domain ${domain} is already shared by ${es.map((e) => e.who).join(', ')} (R-BTN-188)`);
        }
      }
    }

    // The floors (R-BTN-189): judged on the policy alone — the protection report is not a
    // policy condition, so a lapsed or failed report never refuses a change.
    const nextGuarantees = guaranteesOf(doc, { humanKeys: factsNow.humans });
    for (const floor of this.floors(repository)) {
      for (const g of floor.guarantees) {
        if ((GUARANTEE_NAMES as readonly string[]).includes(g) && !nextGuarantees[g as GuaranteeName]) {
          throw new BatonError('floor-violated', `floor ${floor.name}: the change would break ${g} (R-BTN-189)`, { floor: floor.name, guarantee: g });
        }
      }
    }

    // R-BTN-188: on `approvers.trust` becoming human-only, every trust setting made by a
    // credential the new list does not admit is cleared — untrusted, roles dropped, domains and
    // families null.
    const wasHumanOnly = humanOnlyList(cur.policy.approvers.trust, factsNow.humans);
    const nowHumanOnly = humanOnlyList(doc.approvers.trust, factsNow.humans);
    if (!wasHumanOnly && nowHumanOnly) {
      const admits = (by: string) => this.entryMatches(doc.approvers.trust, by, factsNow, doc.human_key);
      const cleared: string[] = [];
      for (const t of this.rows<{ credential_id: string; trust_set_by: string | null }>(
        'SELECT credential_id, trust_set_by FROM worker_grants WHERE repository_id = ? AND revoked_at IS NULL AND trust_set_by IS NOT NULL', repository)) {
        if (!admits(ownerOfTrustSet(t.trust_set_by ?? ''))) {
          this.exec('UPDATE worker_grants SET trust_level = ?, trust_domain = NULL, model_family = NULL, role = NULL WHERE credential_id = ? AND repository_id = ?', 'untrusted', t.credential_id, repository);
          cleared.push(`grant:${t.credential_id}`);
        }
      }
      for (const t of this.rows<{ credential_id: string; trust_set_by: string | null }>(
        'SELECT credential_id, trust_set_by FROM couriers WHERE repository_id = ? AND trust_set_by IS NOT NULL', repository)) {
        if (!admits(ownerOfTrustSet(t.trust_set_by ?? ''))) {
          this.exec('UPDATE couriers SET trust_level = ?, trust_domain = NULL WHERE credential_id = ? AND repository_id = ?', 'untrusted', t.credential_id, repository);
          cleared.push(`courier:${t.credential_id}`);
        }
      }
      if (cleared.length) logEvent(this.c.store, this.c.now(), 'admin', actor.label, { act: 'policy-trust-cleared', repository, cleared }, null, null, repository);
    }

    const version = cur.version + 1;
    const hash = hashOfDocument(doc);
    const changed = diffPolicies(cur.policy, doc);
    this.exec('INSERT INTO repository_policies (repository_id, version, policy_json, hash, previous_hash, changed_by, approver, preset, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      repository, version, canonicalJson(doc), hash, cur.hash, actor.label, approver, preset, this.c.now());
    logEvent(this.c.store, this.c.now(), 'admin', actor.label, { act: 'policy-changed', repository, from: cur.version, to: version, changed }, null, null, repository);
    // The answer's guarantees are the enforced state of the new version — the protection report
    // counted, as the signed read counts it (the floors above stayed policy-only, R-BTN-189).
    return { version, hash, changed, guarantees: guaranteesOf(doc, { protection: this.protectionOk(repository), humanKeys: factsNow.humans }) };
  }

  /** R-BTN-181's store half: a `service:` writer the policy names must hold no owner, runner or
   *  courier role — a key that holds one is not a neutral third service. The violations a
   *  document's named service keys draw, as messages: the policy change refuses them, and the
   *  course snapshot re-checks the same thing against the roles as they stand NOW (a key that
   *  gained a role since the policy named it — R-BTN-188 item 2's "checked again at every
   *  course snapshot"). */
  serviceWriterViolations(doc: PolicyDocument): string[] {
    const named = new Set<string>();
    for (const writers of Object.values(doc.attestations)) {
      for (const w of writers) if (w.startsWith('service:')) named.add(w.slice(8));
    }
    for (const entry of Object.values(doc.readings)) {
      for (const w of entry.writers) if (w.startsWith('service:')) named.add(w.slice(8));
    }
    const out: string[] = [];
    for (const fp of named) {
      const role = this.rows('SELECT 1 FROM repository_owners WHERE fingerprint = ? AND removed_at IS NULL', fp).length ? 'an owner key'
        : this.rows('SELECT 1 FROM worker_grants WHERE credential_id = ? AND revoked_at IS NULL', fp).length ? 'a runner key'
          : this.rows('SELECT 1 FROM couriers WHERE credential_id = ?', fp).length ? 'a courier key' : null;
      if (role) out.push(`service:${fp.slice(0, 16)}… is ${role}, and a service: writer holds no owner, runner or courier role (R-BTN-181)`);
    }
    return out;
  }

  /** The service-writer drift of `repository`'s current policy — the same check a policy
   *  change runs, read against the roles as they stand now, for the course snapshot to refuse
   *  a post over (the previous course version stays in force). */
  serviceWriterDrift(repository: string): string[] {
    const cur = this.current(repository);
    return cur ? this.serviceWriterViolations(cur.policy) : [];
  }

  /** `POST /v1/owner/{repository}/policy/floors` (R-BTN-189): the `approvers.policy` approver
   *  registers a floor; a credential satisfying both its `remove_by` (read as a one-entry list)
   *  and `approvers.policy` removes one. */
  floorsRoute(repository: string, input: unknown, actor: { credential: string; label: string }, breakGlass: ReadonlySet<string>): { ok: true } {
    const body: Record<string, unknown> = isObj(input) ? input : bad('body', 'must be a JSON object');
    const facts = this.facts(repository, breakGlass);
    const cur = this.current(repository);
    if (!cur) throw new BatonError('not-found', `${repository} has no policy yet`);
    if (!this.entryMatches(cur.policy.approvers.policy, actor.credential, facts, cur.policy.human_key)) {
      throw new BatonError('forbidden', 'this credential is not an approver on approvers.policy (R-BTN-189)');
    }
    if (body.remove === true) {
      only(body, ['name', 'remove', 'confirm'], 'body');
      if (body.confirm !== true) throw new BatonError('confirm-required', 'removing a floor takes confirm: true');
      const name = typeof body.name === 'string' && FLOOR_NAME.test(body.name) ? body.name : bad('name', 'must be a floor name');
      const floor = this.floors(repository).find((f) => f.name === name);
      if (!floor) throw new BatonError('not-found', `${repository} has no floor ${name}`);
      if (!this.entryMatches([floor.remove_by], actor.credential, facts, cur.policy.human_key)) {
        throw new BatonError('forbidden', `removing floor ${name} needs a credential its remove_by (${floor.remove_by}) admits (R-BTN-189)`);
      }
      this.exec('DELETE FROM policy_floors WHERE repository_id = ? AND name = ?', repository, name);
      logEvent(this.c.store, this.c.now(), 'admin', actor.label, { act: 'floor-removed', repository, name }, null, null, repository);
      return { ok: true };
    }
    only(body, ['name', 'guarantees', 'remove_by'], 'body');
    const name = typeof body.name === 'string' && FLOOR_NAME.test(body.name) ? body.name : bad('name', 'must be a short floor name');
    const guarantees = Array.isArray(body.guarantees) && body.guarantees.length >= 1 && (body.guarantees as unknown[]).every((g) => (GUARANTEE_NAMES as readonly string[]).includes(g as string))
      ? [...new Set(body.guarantees as string[])] : bad('guarantees', `must name guarantees from ${GUARANTEE_NAMES.join(', ')}`);
    const remove_by = body.remove_by === undefined ? 'human' : body.remove_by === 'human' || body.remove_by === 'owner' ? body.remove_by : bad('remove_by', "must be 'human' or 'owner'");
    if (this.rows('SELECT 1 FROM policy_floors WHERE repository_id = ? AND name = ?', repository, name).length) {
      throw new BatonError('conflict', `${repository} already has a floor named ${name} (R-BTN-189)`);
    }
    // Refused when a named guarantee's policy conditions are not met now — judged on the policy
    // alone, the report never a policy condition.
    const now = guaranteesOf(cur.policy, { humanKeys: facts.humans });
    for (const g of guarantees) {
      if (!now[g as GuaranteeName]) throw new BatonError('floor-violated', `${g} does not hold now (R-BTN-189)`, { guarantee: g });
    }
    this.exec('INSERT INTO policy_floors (repository_id, name, guarantees, remove_by, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?)',
      repository, name, JSON.stringify(guarantees), remove_by, actor.label, this.c.now());
    logEvent(this.c.store, this.c.now(), 'admin', actor.label, { act: 'floor-added', repository, name, guarantees, remove_by }, null, null, repository);
    return { ok: true };
  }

  // ── floors against the live state (R-BTN-189) ─────────────────────────────────────────

  /** The guarantees broken under a repository's floors, the protection report counted — the
   *  state Baton itself enforces, never by asking a runner. */
  brokenUnderFloors(repository: string): { floor: string; guarantee: string }[] {
    const cur = this.current(repository);
    if (!cur) return [];
    const guarantees = guaranteesOf(cur.policy, { protection: this.protectionOk(repository), humanKeys: this.facts(repository).humans });
    const out: { floor: string; guarantee: string }[] = [];
    for (const floor of this.floors(repository)) {
      for (const g of floor.guarantees) {
        if ((GUARANTEE_NAMES as readonly string[]).includes(g) && !guarantees[g as GuaranteeName]) out.push({ floor: floor.name, guarantee: g });
      }
    }
    return out;
  }

  /** Every repository with floors: a broken one stops the repository — Baton offers and
   *  accepts no claim or advance on any ticket that reaches it, and releases the running claims
   *  `released:floor` (R-BTN-189). Called from the report and the alarm paths, so a floor that
   *  breaks by any way back is enforced — a report lapsing past its 24 hours included, which
   *  raises `baton.unprotected` first (R-BTN-189: a lapsed or failed report raises it all the
   *  same as a mismatched one). */
  enforceFloors(): void {
    this.raiseLapsedReports();
    for (const r of this.rows<{ id: string }>('SELECT DISTINCT repository_id AS id FROM policy_floors')) {
      if (this.brokenUnderFloors(r.id).length) this.releaseForFloor?.(r.id);
    }
  }

  /** R-BTN-189: a report lapsed past 24 hours raises `baton.unprotected` — the guarantee it
   *  fed is broken by the lapse, exactly as by a mismatch, wherever the policy's own conditions
   *  hold (a cooperative repository never expected a report; its `no-runner-lands` is broken by
   *  its knobs, not by the checker's silence). Idempotent: an open condition stays open, a
   *  matching report within the window closes it (recordProtection). */
  private raiseLapsedReports(): void {
    for (const r of this.rows<{ repository_id: string; at: number; by: string }>(
      'SELECT repository_id, at, by FROM protection_reports WHERE at < ?', this.c.now() - PROTECTION_WINDOW_MS)) {
      const cur = this.current(r.repository_id);
      if (!cur) continue;
      const g = guaranteesOf(cur.policy);
      if (!g['no-runner-lands']) continue; // the policy's own conditions already break it
      if (this.rows('SELECT 1 FROM policy_conditions WHERE repository_id = ? AND type = ? AND ref = ? AND closed_at IS NULL', r.repository_id, 'baton.unprotected', '').length) continue;
      this.openCondition(r.repository_id, 'baton.unprotected', '', { lapsed: true, last_at: r.at, by: r.by });
      logEvent(this.c.store, this.c.now(), 'discrepancy', 'server', { kind: 'condition', type: 'baton.unprotected', repository: r.repository_id, lapsed: true }, null, null, r.repository_id);
    }
  }

  // ── protection reports and pins (R-BTN-180, R-BTN-189) ────────────────────────────────

  /** The protection checker's report with its heartbeat: stored as the latest, `baton.unprotected`
   *  raised on a report that does not match or differs from the previous reading, closed by a
   *  matching report (R-BTN-180). The reading a report differs FROM is the last one that
   *  MATCHED — the stable baseline — so a report that restores the forge after a mismatch (its
   *  reading returns to the baseline) closes the condition at once, while a reading that
   *  changes while matching (the forge's protection settings moved) raises it, to be closed by
   *  the next report that repeats the new reading. Returns false when the caller is not the
   *  repository's protection checker (the grant's role names it, R-BTN-180). */
  recordProtection(repository: string, report: { matched: boolean; reading_hash: string; legs?: { count: number; tickets: number } }, credential: string): boolean {
    if (!this.rows('SELECT 1 FROM worker_grants WHERE credential_id = ? AND repository_id = ? AND revoked_at IS NULL AND role = ?', credential, repository, 'protection-checker').length) return false;
    const prev = this.rows<{ matched: number; reading_hash: string; matched_hash: string | null }>('SELECT matched, reading_hash, matched_hash FROM protection_reports WHERE repository_id = ?', repository)[0];
    this.exec('INSERT INTO protection_reports (repository_id, matched, reading_hash, matched_hash, by, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (repository_id) DO UPDATE SET matched = excluded.matched, reading_hash = excluded.reading_hash, matched_hash = excluded.matched_hash, by = excluded.by, at = excluded.at',
      repository, report.matched ? 1 : 0, report.reading_hash, report.matched ? report.reading_hash : prev?.matched_hash ?? null, credential, this.c.now());
    const baseline = prev?.matched_hash ?? null;
    const breaks = !report.matched || (baseline != null && baseline !== report.reading_hash);
    if (breaks) {
      this.openCondition(repository, 'baton.unprotected', '', { matched: report.matched, reading_hash: report.reading_hash, changed_reading: baseline != null && baseline !== report.reading_hash, ...(report.legs ? { legs: report.legs } : {}) });
      logEvent(this.c.store, this.c.now(), 'discrepancy', 'server', { kind: 'condition', type: 'baton.unprotected', repository, matched: report.matched }, null, null, repository);
      this.enforceFloors();
    } else {
      this.closeCondition(repository, 'baton.unprotected', '');
    }
    return true;
  }

  /** A trusted runner's policy pins, as its heartbeat reports them (R-BTN-189): stored, and a
   *  pin that differs from the current version — the policy document's hash, and the floors'
   *  when the runner pins it — holds `baton.policy-unpinned` open for that runner; one that
   *  matches closes it. R-BTN-189 names trusted runners: a pin from a grant not trusted on the
   *  repository is recorded nowhere and drives nothing (an untrusted runner shares its sandbox
   *  with the code it builds, so its pin proves nothing). Returns the repositories whose pin
   *  differed. */
  recordPins(workerId: number, credential: string, pins: PolicyPin[], granted: ReadonlySet<string>): string[] {
    const differed: string[] = [];
    for (const pin of pins) {
      if (!REPOSITORY_ID.test(pin.repository) || !granted.has(pin.repository)) continue;
      const cur = this.current(pin.repository);
      const trusted = this.rows<{ trust_level: string | null }>(
        'SELECT trust_level FROM worker_grants WHERE credential_id = ? AND repository_id = ? AND revoked_at IS NULL', credential, pin.repository)[0];
      const policy = cur?.policy;
      const isTrusted = trusted != null && (trusted.trust_level ?? policy?.grants.default_trust ?? 'untrusted') === 'trusted';
      if (!isTrusted) continue;
      this.exec('INSERT INTO policy_pins (worker_id, repository_id, hash, floors_hash, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (worker_id, repository_id) DO UPDATE SET hash = excluded.hash, floors_hash = excluded.floors_hash, at = excluded.at',
        workerId, pin.repository, pin.hash, pin.floors_hash ?? null, this.c.now());
      const floorsHash = cur ? this.floorsHashOf(this.floors(pin.repository)) : null;
      if (cur && (cur.hash !== pin.hash || (pin.floors_hash != null && pin.floors_hash !== floorsHash))) {
        differed.push(pin.repository);
        this.openCondition(pin.repository, 'baton.policy-unpinned', `worker:${workerId}`, { pinned: pin.hash, current: cur.hash, ...(pin.floors_hash != null && pin.floors_hash !== floorsHash ? { pinned_floors: pin.floors_hash, current_floors: floorsHash } : {}) });
      } else {
        this.closeCondition(pin.repository, 'baton.policy-unpinned', `worker:${workerId}`);
      }
    }
    return differed;
  }

  /** Whether the worker's pins on `repository` differ from the current version — while one
   *  does, the runner acts on nothing in the repository (R-BTN-189; a trusted runner's pins
   *  alone are stored, so only a trusted grant can differ). A pin left behind by a demoted
   *  grant drives nothing: the trust that made it matter is gone (round 2, finding N1). */
  pinDiffers(workerId: number, repository: string): boolean {
    const pin = this.rows<{ hash: string; floors_hash: string | null }>('SELECT hash, floors_hash FROM policy_pins WHERE worker_id = ? AND repository_id = ?', workerId, repository)[0];
    if (!pin) return false;
    const cur = this.current(repository);
    if (cur == null) return false;
    const trusted = this.rows<{ trust_level: string | null }>(
      'SELECT trust_level FROM worker_grants WHERE credential_id = (SELECT credential_id FROM workers WHERE id = ?) AND repository_id = ? AND revoked_at IS NULL', workerId, repository)[0];
    if (!(trusted != null && (trusted.trust_level ?? cur.policy?.grants.default_trust ?? 'untrusted') === 'trusted')) return false;
    return cur.hash !== pin.hash || (pin.floors_hash != null && pin.floors_hash !== this.floorsHashOf(this.floors(repository)));
  }

  /** Whether the worker's credential is the repository's protection checker — the one claimant
   *  exempt from a broken floor and a differing pin (R-BTN-180, R-BTN-189). */
  isProtectionChecker(credential: string, repository: string): boolean {
    return this.rows('SELECT 1 FROM worker_grants WHERE credential_id = ? AND repository_id = ? AND revoked_at IS NULL AND role = ?', credential, repository, 'protection-checker').length > 0;
  }

  private openCondition(repository: string, type: string, ref: string, detail: Record<string, unknown>): void {
    if (this.rows('SELECT 1 FROM policy_conditions WHERE repository_id = ? AND type = ? AND ref = ? AND closed_at IS NULL', repository, type, ref).length) {
      this.exec('UPDATE policy_conditions SET detail_json = ? WHERE repository_id = ? AND type = ? AND ref = ? AND closed_at IS NULL', JSON.stringify(detail), repository, type, ref);
      return;
    }
    // A condition re-raised in the same millisecond a closed one was (a test clock that does
    // not move between two raises): the row's key is (repository, type, ref, raised_at), so the
    // new raise is stamped one tick after anything the key already holds.
    const last = this.rows<{ raised_at: number }>('SELECT raised_at FROM policy_conditions WHERE repository_id = ? AND type = ? AND ref = ? ORDER BY raised_at DESC LIMIT 1', repository, type, ref)[0]?.raised_at;
    const at = Math.max(this.c.now(), (last ?? -1) + 1);
    this.exec('INSERT INTO policy_conditions (repository_id, type, ref, raised_at, detail_json) VALUES (?, ?, ?, ?, ?)', repository, type, ref, at, JSON.stringify(detail));
  }

  private closeCondition(repository: string, type: string, ref: string): void {
    const open = this.rows<{ raised_at: number }>('SELECT raised_at FROM policy_conditions WHERE repository_id = ? AND type = ? AND ref = ? AND closed_at IS NULL', repository, type, ref)[0];
    if (!open) return;
    this.exec('UPDATE policy_conditions SET closed_at = ?, outcome = ? WHERE repository_id = ? AND type = ? AND ref = ? AND raised_at = ?', this.c.now(), 'closed', repository, type, ref, open.raised_at);
  }
}

/** A trust setting's `trust_set_by` is an actor column; the credential it names is its value's
 *  `owner:<fp>` (another actor's shape names a credential no approver entry admits). */
function ownerOfTrustSet(trustSetBy: string): string {
  return trustSetBy.startsWith('owner:') ? trustSetBy.slice(6) : `no-credential:${trustSetBy}`;
}
