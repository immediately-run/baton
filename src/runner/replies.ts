// Validate successful runner replies before they can renew a lease or move a claim (S-BTN-26, S-BTN-41).
import type { AdvanceAnswer, BeatAnswer, ClaimAnswer } from '../shared/runner-wire';

type Check = (v: unknown) => boolean;
export const record = (v: unknown): v is Record<string, unknown> => v != null && typeof v === 'object' && !Array.isArray(v);
const text: Check = (v) => typeof v === 'string';
const nonempty: Check = (v) => typeof v === 'string' && v.length > 0;
const number: Check = (v) => typeof v === 'number' && Number.isFinite(v);
const positive: Check = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const id: Check = (v) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const bool: Check = (v) => typeof v === 'boolean';
const array = (item: Check): Check => (v) => Array.isArray(v) && v.every(item);
const optional = (check: Check): Check => (v) => v === undefined || check(v);
const nullable = (check: Check): Check => (v) => v === null || check(v);
const shape = (fields: Record<string, Check>): Check => (v) =>
  record(v) && Object.entries(fields).every(([field, check]) => check(v[field]));

const strings = array(text);
const next = array(shape({ leg: nonempty, state: nonempty, waiting_on: optional(text) }));
const claim = shape({
  claim_id: id, ticket_id: nonempty, nonce: nonempty, snapshot_sha: nonempty, station: nonempty,
  legs: array(nonempty), next: optional(next),
  course_id: optional(nullable(text)), course_version: optional(nullable(number)),
  path: optional(nullable(text)), version: optional(text), default_branch: optional(text), handoff_url: optional(text),
  leg_state: optional((v) => v === 'forge' || v === 'branch'), scope: optional(strings),
  ticket_source: optional(nullable(shape({ kind: text, versions: nullable(text) }))),
  brief: optional(shape({ signed: bool, signer: optional(text), commit: text })),
  displaced: optional(text), evidence: optional(array(shape({ ref: text, kind: text }))),
  last_written_by: optional(shape({ pusher: text, pusher_id: optional(number), commit: text, at: number })),
  control: optional(shape({ required: bool, keys: strings, register_moved: optional(bool) })),
  previous_attempts: optional(array(shape({
    claim_id: id, status: text, end_reason: nullable(text), detail: nullable(text), ended_at: nullable(number),
    legs: array(shape({ leg: nonempty, from: text, reached: nullable(text), outcome: text, run_id: optional(text) })),
  }))),
});

const beatClaim = shape({
  id, ticket_id: nonempty, nonce: nonempty, claimed_at: number, station: optional(text), leg: optional(text), deadline_at: optional(number),
  activity: optional(nullable(shape({ id: text, kind: text, label: nullable(text), started_at: number, claim_id: nullable(id) }))),
});
const message = shape({
  id, kind: nonempty, sent_at: number,
  payload: optional(nullable(shape({
    reason: optional(text), ticket_id: optional(text),
    tickets: optional(array(shape({ ticket_id: nonempty, cleared: array(shape({ kind: text, ref: text, leg: optional(text) })) }))),
  }))),
});
const refusal = shape({ repository: text, code: text });
const beat = shape({
  runner_id: id, worker_id: optional(id), incarnation: id, lease_timeout_s: optional(positive),
  claims: optional(array(beatClaim)), claim: optional(nullable(beatClaim)), messages: array(message),
  grant: optional(shape({ capabilities: strings })), bars: Array.isArray,
  stale_courses: array(shape({ repository: text, course: text, version: nullable(number), min_runner_version: nullable(number) })),
  mode: (v) => record(v) && Object.values(v).every((m) => m === 'shadow' || m === 'cut-over'), server_time: number,
  reports_refused: optional(array(number)), tier_ceilings_unregistered: optional(strings), courses_retired: optional(strings),
  protection_refused: optional(array(refusal)), refused_couriers: optional(array(refusal)), session_url_dropped: optional(text),
  transcripts_refused: optional(array(shape({ index: number, code: text, message: text }))),
  transcripts_unlinked: optional(array(number)),
});
const advance = shape({ ok: (v) => v === true, station: optional(nonempty), next: optional(next),
  run_id: optional(nonempty), seq: optional(id), session_url_dropped: optional(text) });

export const isClaimAnswer = (v: unknown): v is ClaimAnswer => claim(v);
export const isBeatAnswer = (v: unknown): v is BeatAnswer =>
  record(v) && (v.claims !== undefined || v.claim !== undefined) && beat(v);
export const isAdvanceAnswer = (v: unknown): v is AdvanceAnswer => advance(v);
