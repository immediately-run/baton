// validate.ts — every rule for untrusted runner and owner input (BATON_SPEC §10.4, §6.8, §6.9,
// §5). One module, called by every endpoint before any write (R3-1211); a value that fails is
// refused with `invalid-params` naming the field, never trimmed into shape.
import { BatonError, RECOMMENDED_CLIENT } from './http';
import { FREE_TEXT_MAX, isFreeText } from './text';
import { COURSE_ID } from './course';
import { CONDITION_TYPE, CONDITION_TYPE_MAX, RESTART_ID, SEVERITIES } from './conditionTypes';
import { parseSchemaId, VALUE_MAX_BYTES } from '../shared/schema.mjs';
import { CLIENT_VERSION_MAX, compareVersions, parseVersion } from '../shared/versions.mjs';

/** §5: the harness's own session id, the rule `claim.sh --session` already applies. */
export const SESSION_NAME = /^[A-Za-z0-9_.:-]{1,128}$/;
export const HOSTNAME = /^[A-Za-z0-9.-]{1,253}$/;
/** A forge host as B-182's `code_repos` names it: a lowercased DNS name with an optional port,
 *  validated as a `web_base`'s authority is (R-BTN-92) — no userinfo, no path, no dot-run. */
export const FORGE_HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:[1-9][0-9]{0,4})?$/;
/** An origin as the CLI's configuration names one (R-BTN-137, B-121): a Baton deployment's URL
 *  — scheme and authority, no path, query or fragment, no trailing slash. The OIDC `aud` is the
 *  origin verbatim (R-BTN-15), and `baton_url` (R-BTN-56) and homes.json's `origin` are one. */
export const ORIGIN = /^https?:\/\/[A-Za-z0-9.-]+(?::[1-9][0-9]{0,4})?$/;
/** R-BTN-138's id kind, as a `code_repos` entry stores it: a decimal string. */
export const FORGE_ID = /^[1-9][0-9]{0,19}$/;
export const SHA256_HEX = /^[0-9a-f]{64}$/;
// The id forms of R-BTN-47, each spelled once.
const REPOSITORY_SRC = '[a-z][a-z0-9-]{0,39}';
const LOCAL_SRC = '[A-Za-z0-9][A-Za-z0-9._-]{0,63}';
/** A registered repository's id: `docs`. No colon, so a qualified id splits at its first. */
export const REPOSITORY_ID = new RegExp(`^${REPOSITORY_SRC}$`);
/** A course id (R-BTN-48), the form course files give their stations and legs (R-BTN-69); a
 *  §6.9 step kind has the same form (R-BTN-50). Spelled once, in the pure course.ts. */
export { COURSE_ID };
/** A GitHub repository, `owner/name` (R-BTN-47), and a branch name as a push names it (§6.3). */
export const GIT_REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
/** What `git check-ref-format --branch` allows, in short: no control, space, `~ ^ : ? * [ \`,
 *  no `..` or `@{`, at most 255 characters. A legal branch the hook asks about is never refused. */
export const GIT_BRANCH = /^(?!.*\.\.)(?!.*@\{)(?![/.])(?!.*[/.]$)[^\u0000-\u0020\u007f~^:?*[\\]{1,255}$/;
/** Repositories one heartbeat may name a tier ceiling for (spec-silent, recorded on R3-1231). */
export const TIER_CEILINGS_MAX = 64;
/** A course's `version` and a runner's declared one: non-negative, at most this. */
export const COURSE_VERSION_MAX = 1_000_000_000;
/** Courses in one registry, and courses one heartbeat declares (spec-silent, recorded on R3-1231). */
export const COURSES_MAX = 64;
/** A ticket's id in its home repository, as git writes it: `R3-1205` (R-BTN-47). */
export const LOCAL_ID = new RegExp(`^${LOCAL_SRC}$`);
/** A ticket's qualified id, `<repository>:<local>`: what Baton's API, events and dashboard use. */
export const TICKET_ID = new RegExp(`^(${REPOSITORY_SRC}):(${LOCAL_SRC})$`);
/** B-113 (§4.4): what one `depends_on` entry may be — a local id of the posting repository, or
 *  a ticket of another registered repository named by its qualified id (`baton:B-111`). `parent`
 *  and `blocked_by` stay local (§3.1, R-BTN-47). */
export const DEPENDENCY_ID = new RegExp(`^(?:${REPOSITORY_SRC}:${LOCAL_SRC}|${LOCAL_SRC})$`);
/** A qualified ticket id and its two halves. Every caller holds an id `TICKET_ID` accepted. */
export const qualify = (repository: string, local: string) => `${repository}:${local}`;
export const repositoryOf = (ticketId: string) => ticketId.slice(0, ticketId.indexOf(':'));
export const localOf = (ticketId: string) => ticketId.slice(ticketId.indexOf(':') + 1);

/** A repository named by a runner or the owner (`?repository=`, a cutover, a held accept). */
export function checkRepositoryId(v: unknown, field = 'repository'): string {
  if (typeof v !== 'string' || !REPOSITORY_ID.test(v)) throw new BatonError('invalid-params', `${field}: must be a repository id`);
  return v;
}
const MODEL = /^[A-Za-z0-9._/:-]{1,200}$/;
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** A typed holding (R-BTN-174, B-104): `<type>:<value>` — the type a course type such as `key`,
 * the value a name's constant alphabet, the whole at most the constant's 128. The ONE home
 * of the pattern (round 1, B11): every reader of a holding's shape imports it, and the grant
 * site composes its `<type>:*` wildcard from the same pieces.
 */
export const HOLDING_TYPE = '[a-z][a-z0-9-]{0,31}';
export const HOLDING_VALUE = '[A-Za-z0-9:._/@-]{1,128}';
const HOLDING = new RegExp(`^${HOLDING_TYPE}:${HOLDING_VALUE}$`);
export { HOLDING };
const ACTIVITY_ID = /^[A-Za-z0-9._:-]{1,64}$/;
/** §6.8: a transcript path — no `..` segment is checked separately. */
const TRANSCRIPT_PATH = /^[A-Za-z0-9._/-]{1,256}$/;

/** R-BTN-60: a tag — a short course-defined string (`family:glm`, `model:opencode-go/qwen3.8-max`)
 *  core compares and never reads; the same form wherever one is posted, declared or barred. */
export const TAG = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$/;
/** Tags one heartbeat declares, or one advance bars (spec-silent, recorded on R3-1232). */
export const TAGS_MAX = 64;

export const ACTIVITY_KINDS = ['orient', 'implement', 'local-verify', 'open-pr', 'push', 'ci-wait', 'review-round', 'reviewer',
  'fix-findings', 'adjudicate', 'merge', 'reconcile', 'status-write', 'decision-packet', 'other'] as const;
export const OUTCOMES = ['succeeded', 'failed', 'cancelled', 'abandoned'] as const;
export const TIERS = ['routine', 'judgement', 'critical'] as const;

export const bad = (field: string, why: string): never => {
  throw new BatonError('invalid-params', `${field}: ${why}`);
};
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v: unknown) => Number.isInteger(v);
const isTime = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;

/** §10.4's free text: at most 500 characters, no control characters, none of `< > { }`. */
export function freeText(v: unknown, field: string, max = FREE_TEXT_MAX): string {
  if (!isFreeText(v, max)) {
    bad(field, `must be 1–${max} characters with no control characters and none of < > { }`);
  }
  return v as string;
}

const optional = <T>(v: unknown, check: (v: unknown) => T): T | undefined => (v === undefined || v === null ? undefined : check(v));
const matches = (re: RegExp, field: string) => (v: unknown) => (typeof v === 'string' && re.test(v) ? v : bad(field, `must match ${re}`));

/** §11.3 R-BTN-197 (B-254): `admin settings set --recommended-client` — null to clear back to
 *  the code's `RECOMMENDED_CLIENT`, else a semver at or above it, and short as a client's own
 *  statement is (§13.3 R-BTN-33: the header echoes it, so it is bounded like the client's). An
 *  administrator may raise the recommendation, never lower it below what the deployed code
 *  itself recommends. */
export function checkRecommendedClient(v: unknown): string | null {
  if (v === null) return null;
  if (typeof v !== 'string' || parseVersion(v) == null) bad('recommended_client', 'must be null or a semver, like 0.1.6');
  if ((v as string).length > CLIENT_VERSION_MAX) bad('recommended_client', `must be at most ${CLIENT_VERSION_MAX} characters`);
  if (compareVersions(v as string, RECOMMENDED_CLIENT) < 0) {
    bad('recommended_client', `must be at or above the code's recommended ${RECOMMENDED_CLIENT} — an administrator may raise the recommendation, never lower it`);
  }
  return v as string;
}

// ── the heartbeat (§11) ──────────────────────────────────────────────────────────────────

export interface Heartbeat {
  hostname: string;
  session_name: string;
  secret_hash?: string;
  rekey?: boolean;
  harness: 'opencode' | 'claude-code';
  kind: 'vm' | 'local' | 'cloud';
  model_id?: string;
  /** B-142: the model tables' fields are gone and read nowhere — a heartbeat still carrying
   *  `model_provider_id`, `billing`, `usage` or `rate_limits` is accepted with them ignored,
   *  until no registered runner posts them. */
  capabilities: string[];
  /** R-BTN-60: course-defined strings the tag gate matches. */
  tags: string[];
  tier_ceiling: (typeof TIERS)[number];
  /** R-BTN-107: how the runner isolates a leg — `process` (the default), `attached` or `session`. */
  isolation: 'attached' | 'process' | 'session';
  /** Per repository (R-BTN-66): `{repository: tier}`, checked against each ladder at the heartbeat. */
  tier_ceilings: Record<string, string>;
  lease_timeout_s: number;
  /** The courses the runner's checkouts run, at their versions (R-BTN-22, R-BTN-48): rule 9. */
  courses: { repository: string; course: string; version: number }[];
  last_activity_at?: number;
  test_harness: boolean;
  /** R-BTN-19 (B-188): the reaped claims the sidecar has fenced — one entry per claim. */
  fenced: { claim_id: number }[];
  /** R-BTN-4 (B-188): how many claims the runner can run at once, clamped to [1, 32]. */
  concurrency: number;
  transcripts: TranscriptReport[];
  transcript_refusals: { index: number; code: string; message: string }[];
  /** R-BTN-103: the repositories and `asks` this session delivers notices for, as a runner courier,
   *  and the entries refused as malformed. */
  couriers: { entries: { repository: string; asks: string[] }[]; refused: { repository: string; code: string }[] };
  /** §12.8 (B-145, R-BTN-180): the protection checker's reports, one per repository; the core
   *  checks the caller is each repository's checker and refuses the rest per entry. */
  protection: { repository: string; matched: boolean; reading_hash: string }[];
  /** §12.8 (B-145, R-BTN-189): the policy hash pins a trusted runner reports per repository. */
  policy_pins: { repository: string; hash: string }[];
  /** R-BTN-113 (B-234): the running leg's session link, as the runner holds it. Shape-checked
   *  here only as a bounded string; the heartbeat drops one that fails the link rule (https, no
   *  userinfo, an allowlisted host) and logs it, never refusing the beat. */
  session_url?: string;
  /** R-BTN-113 (B-188): each claim's running leg's session link, by claim — a runner holding
   *  several claims names which. Malformed entries are skipped, never a refused beat. */
  session_urls: { claim_id: number; url: string }[];
  /** §7.5 R-BTN-90: the `claim_legs.seq` of the run whose script just returned — the finishing
   *  half's word, sent out of cadence before validation, `close` or any wait. Shape-checked
   *  only as a positive integer; a heartbeat is never refused for it. */
  leg_finished?: number;
  /** R-BTN-90 (B-188): `leg_finished` by claim — a run's seq is numbered within its claim, so a
   *  runner holding several names which. Malformed entries are skipped, never a refused beat. */
  legs_finished: { claim_id: number; seq: number }[];
  /** B-253 (R-BTN-72): the runner's own statement about itself — its `cli` key names the CLI's
   *  pinning. Opaque to Baton beyond its size: shape-checked here, stored as received, and
   *  gated on by nothing. */
  profile?: Record<string, unknown>;
  reports: RunnerReport[];
}

export const REPORT_HORIZON_MS = 6 * 3_600_000;
export const REPORT_KEYS_MAX = 16;
export type RunnerReport = { key: string; payload: string } & ({ claim_id: number } | { repository: string });

function checkReports(raw: unknown): RunnerReport[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > REPORT_KEYS_MAX) bad('reports', `must be a list of at most ${REPORT_KEYS_MAX} reports`);
  return (raw as unknown[]).map((value, i) => {
    const at = `reports[${i}]`;
    if (!isObj(value)) bad(at, 'must be an object');
    const r = value as Record<string, unknown>;
    const key = r.key === undefined ? '' : matches(SESSION_NAME, `${at}.key`)(r.key);
    const payload = boundedJson(r.payload, `${at}.payload`);
    if (r.claim_id === undefined) return { key, payload, repository: checkRepositoryId(r.repository, `${at}.repository`) };
    if (!Number.isSafeInteger(r.claim_id) || Number(r.claim_id) < 1 || r.repository !== undefined) bad(at, 'must name a claim_id or repository, not both');
    return { key, payload, claim_id: Number(r.claim_id) };
  });
}

export interface TranscriptReport { index?: number; repo: string; path: string; role: 'session' | 'subagent'; activity_id?: string; pushed_at?: number; claim_id?: number }

/** §6.6 R-BTN-9: the runner declares its lease timeout, clamped to [900, 86400] s, default 900. */
export const clampLease = (s: unknown) => (typeof s === 'number' && Number.isFinite(s) ? Math.min(86400, Math.max(900, Math.round(s))) : 900);

/** R-BTN-4 (B-188): the most claims a runner may declare it runs at once, and a grant allow. */
export const MAX_CLAIMS_CAP = 32;
/** R-BTN-4: the runner's declared `concurrency`, clamped to [1, 32], default 1 — clamped, never
 *  refused, since a refused heartbeat would stop `last_seen_at` and get a live runner reaped. */
export const clampConcurrency = (n: unknown) => (isInt(n) ? Math.min(MAX_CLAIMS_CAP, Math.max(1, n as number)) : 1);

/** R-BTN-107: the isolation modes a heartbeat may declare. */
export const ISOLATIONS: readonly Heartbeat['isolation'][] = ['attached', 'process', 'session'];

export function checkHeartbeat(body: unknown, transcriptRepos: string[]): Heartbeat {
  if (!isObj(body)) bad('body', 'must be a JSON object');
  const b = body as Record<string, unknown>;
  const hostname = matches(HOSTNAME, 'hostname')(b.hostname);
  const session_name = matches(SESSION_NAME, 'session_name')(b.session_name);
  const secret_hash = optional(b.secret_hash, matches(SHA256_HEX, 'secret_hash'));
  if (b.rekey !== undefined && typeof b.rekey !== 'boolean') bad('rekey', 'must be a boolean');
  if (b.harness !== 'opencode' && b.harness !== 'claude-code') bad('harness', "must be 'opencode' or 'claude-code'");
  if (b.kind !== 'vm' && b.kind !== 'local' && b.kind !== 'cloud') bad('kind', "must be 'vm', 'local' or 'cloud'");
  const model_id = optional(b.model_id, matches(MODEL, 'model_id'));
  // B-104 (R-BTN-174): a declaration may hold a typed holding — `<type>:<value>`, R-BTN-121's
  // labels — beside the legacy names. Shape only: a holding is the runner's own statement,
  // checked by nothing (§11.1's refusal deleted), bounded at matching by the grant.
  if (!Array.isArray(b.capabilities) || !b.capabilities.every((c) => typeof c === 'string' && (NAME.test(c) || HOLDING.test(c)))) bad('capabilities', 'must be a list of capability, role or holding names');
  const capabilities = [...new Set(b.capabilities as string[])];
  const rawTags = b.tags ?? [];
  if (!Array.isArray(rawTags) || rawTags.length > TAGS_MAX || !rawTags.every((t) => typeof t === 'string' && TAG.test(t))) bad('tags', `must be a list of at most ${TAGS_MAX} tags`);
  const tags = [...new Set(rawTags as string[])];
  const tier = b.tier_ceiling ?? 'critical'; // absent ⇒ every tier (§5)
  if (!TIERS.includes(tier as never)) bad('tier_ceiling', `must be one of ${TIERS.join(', ')}`);
  // R-BTN-22: the skills version is each course's version, declared per course; a sidecar that
  // still sends `skills_version` is not refused for it.
  const rawCourses = b.courses ?? [];
  if (!Array.isArray(rawCourses) || rawCourses.length > COURSES_MAX) bad('courses', `must be a list of at most ${COURSES_MAX}`);
  const declaredCourses = new Set<string>();
  const courses = (rawCourses as unknown[]).map((c, i) => {
    if (!isObj(c)) bad(`courses[${i}]`, 'must be an object');
    const x = c as Record<string, unknown>;
    const repository = checkRepositoryId(x.repository, `courses[${i}].repository`);
    const course = matches(COURSE_ID, `courses[${i}].course`)(x.course);
    if (!isInt(x.version) || (x.version as number) < 0 || (x.version as number) > COURSE_VERSION_MAX) bad(`courses[${i}].version`, 'must be a non-negative integer');
    if (declaredCourses.has(`${repository}:${course}`)) bad(`courses[${i}]`, `repeats ${repository}:${course}`);
    declaredCourses.add(`${repository}:${course}`);
    return { repository, course, version: x.version as number };
  });
  if (b.last_activity_at !== undefined && !isTime(b.last_activity_at)) bad('last_activity_at', 'must be epoch ms');
  if (b.test_harness !== undefined && typeof b.test_harness !== 'boolean') bad('test_harness', 'must be a boolean');
  if (b.isolation !== undefined && !ISOLATIONS.includes(b.isolation as Heartbeat['isolation'])) bad('isolation', `must be one of ${ISOLATIONS.join(', ')}`);
  const transcripts = (b.transcripts ?? []) as unknown[];
  if (!Array.isArray(transcripts) || transcripts.length > 50) bad('transcripts', 'must be a list of at most 50');
  // R-BTN-113: the link itself is judged at the heartbeat, which drops and logs one that fails
  // the rule (https, no userinfo, an allowlisted host) rather than refusing the beat — so this
  // only bounds the field's size, keeping a hostile megabyte out of the log that follows.
  const session_url = typeof b.session_url === 'string' && b.session_url.length <= 4096 ? b.session_url : undefined;
  // R-BTN-90: the finished run's seq — read as absent when it is not one (a heartbeat is never
  // refused for it, §6.8); the finishing half below judges it against the claim's running run.
  const leg_finished = isInt(b.leg_finished) && (b.leg_finished as number) > 0 ? b.leg_finished as number : undefined;
  // R-BTN-113 (B-188): one link per claim; the same bounds as `session_url`, a malformed entry skipped.
  const session_urls = (Array.isArray(b.session_urls) ? (b.session_urls as unknown[]).slice(0, MAX_CLAIMS_CAP) : [])
    .filter((e): e is { claim_id: number; url: string } => isObj(e) && isInt((e as Record<string, unknown>).claim_id)
      && typeof (e as Record<string, unknown>).url === 'string' && ((e as Record<string, unknown>).url as string).length <= 4096)
    .map((e) => ({ claim_id: e.claim_id, url: e.url }));
  // B-253 (R-BTN-72): the profile is the runner's own statement, opaque — bounded only, so a
  // hostile megabyte stays out of the row it is stored in. The pinning it reports is never a
  // refusal: an unpinned runner is warned about, not stopped.
  let profile: Record<string, unknown> | undefined;
  if (b.profile !== undefined) {
    if (!isObj(b.profile)) bad('profile', 'must be a JSON object');
    else if (JSON.stringify(b.profile).length > 4096) bad('profile', 'must serialize to at most 4096 characters');
    else profile = b.profile;
  }
  return {
    hostname,
    session_name,
    secret_hash,
    rekey: b.rekey === true,
    harness: b.harness as Heartbeat['harness'],
    kind: b.kind as Heartbeat['kind'],
    model_id,
    capabilities,
    tags,
    tier_ceiling: tier as Heartbeat['tier_ceiling'],
    isolation: (b.isolation ?? 'process') as Heartbeat['isolation'],
    tier_ceilings: checkTierCeilings(b.tier_ceilings),
    lease_timeout_s: clampLease(b.lease_timeout_s),
    courses,
    last_activity_at: b.last_activity_at as number | undefined,
    test_harness: b.test_harness === true,
    fenced: checkFenced(b.fenced),
    couriers: checkCouriers(b.couriers),
    protection: checkProtection(b.protection),
    policy_pins: checkPolicyPins(b.policy_pins),
    session_url,
    session_urls,
    concurrency: clampConcurrency(b.concurrency),
    leg_finished,
    legs_finished: (Array.isArray(b.legs_finished) ? (b.legs_finished as unknown[]).slice(0, MAX_CLAIMS_CAP) : [])
      .filter((e): e is { claim_id: number; seq: number } => isObj(e) && isInt((e as Record<string, unknown>).claim_id)
        && isInt((e as Record<string, unknown>).seq) && ((e as Record<string, unknown>).seq as number) > 0)
      .map((e) => ({ claim_id: e.claim_id, seq: e.seq })),
    profile,
    reports: checkReports(b.reports),
    // One bad pointer is refused on its own and reported, never the heartbeat (§6.8): a failed
    // heartbeat would stop last_seen_at and get a live runner reaped.
    ...splitTranscripts(transcripts, transcriptRepos),
  };
}

/** A tier name, as a repository's ladder spells it (R-BTN-66). */
export const TIER_NAME = /^[a-z][a-z0-9-]{0,39}$/;

function checkTierCeilings(v: unknown): Record<string, string> {
  if (v === undefined) return {};
  if (!isObj(v) || Object.keys(v).length > TIER_CEILINGS_MAX) bad('tier_ceilings', `must map at most ${TIER_CEILINGS_MAX} repositories to a tier`);
  const out: Record<string, string> = {};
  for (const [repo, tier] of Object.entries(v as object)) {
    out[checkRepositoryId(repo, `tier_ceilings key ${repo}`)] = matches(TIER_NAME, `tier_ceilings.${repo}`)(tier);
  }
  return out;
}

function splitTranscripts(list: unknown[], allowed: string[]) {
  const ok: TranscriptReport[] = [];
  const transcript_refusals: { index: number; code: string; message: string }[] = [];
  list.forEach((t, i) => {
    try {
      ok.push({ ...checkTranscript(t, `transcripts[${i}]`, allowed), index: i });
    } catch (e) {
      if (!(e instanceof BatonError)) throw e;
      transcript_refusals.push({ index: i, code: e.code, message: e.message });
    }
  });
  return { transcripts: ok, transcript_refusals };
}

/** §9: an acknowledgement's optional reply — `{text}`, free text (§10.4). */
export function checkAck(body: unknown): { text: string | null } | null {
  if (body === null || body === undefined) return null;
  if (!isObj(body)) bad('body', 'must be a JSON object');
  const reply = (body as Record<string, unknown>).reply;
  if (reply === undefined || reply === null) return null;
  if (!isObj(reply)) bad('reply', 'must be an object');
  const text = (reply as Record<string, unknown>).text;
  return { text: text === undefined || text === null ? null : freeText(text, 'reply.text') };
}

/** §6.8: a transcript pointer — an allow-listed repo and a safe path with no `..` segment. */
export function checkTranscript(t: unknown, field: string, allowed: string[]): TranscriptReport {
  if (!isObj(t)) bad(field, 'must be an object');
  const x = t as Record<string, unknown>;
  if (typeof x.repo !== 'string' || !allowed.includes(x.repo)) bad(`${field}.repo`, `must be one of ${allowed.join(', ')}`);
  if (typeof x.path !== 'string' || !TRANSCRIPT_PATH.test(x.path) || x.path.split('/').some((seg) => seg === '..' || seg === '')) {
    bad(`${field}.path`, 'must be a relative path of [A-Za-z0-9._/-] with no empty or .. segment');
  }
  const role = x.role ?? 'session';
  if (role !== 'session' && role !== 'subagent') bad(`${field}.role`, "must be 'session' or 'subagent'");
  if (x.pushed_at !== undefined && !isTime(x.pushed_at)) bad(`${field}.pushed_at`, 'must be epoch ms');
  if (x.claim_id !== undefined && !isInt(x.claim_id)) bad(`${field}.claim_id`, 'must be a claim id');
  return { repo: x.repo as string, path: x.path as string, role: role as TranscriptReport['role'], activity_id: optional(x.activity_id, matches(ACTIVITY_ID, `${field}.activity_id`)), pushed_at: x.pushed_at as number | undefined,
    ...(x.claim_id !== undefined ? { claim_id: x.claim_id as number } : {}) };
}

// ── activities (§6.9) ────────────────────────────────────────────────────────────────────

export interface ActivityReport {
  id: string;
  claim_id: number | null;
  parent_id?: string;
  call_id?: string;
  kind: (typeof ACTIVITY_KINDS)[number];
  seq?: number;
  label?: string;
  source: 'skill' | 'hook';
  started_at: number;
  ended_at?: number;
  outcome?: (typeof OUTCOMES)[number];
  detail?: Record<string, unknown>;
}

const NUM = 'number';
const BOOL = 'boolean';
const PR = 'pr';
const TEXT = 'text';
type FieldType = typeof NUM | typeof BOOL | typeof PR | typeof TEXT;
const COMMON: Record<string, FieldType> = { pr: PR, exit_code: NUM, note: TEXT };
/** §10.4: per kind, the detail keys allowed and their types; any other key is refused. */
export const DETAIL_SCHEMAS: Record<string, Record<string, FieldType>> = {
  orient: { ...COMMON },
  implement: { ...COMMON },
  'local-verify': { ...COMMON, passed: BOOL },
  'open-pr': { ...COMMON },
  push: { ...COMMON, branch: TEXT, sha: TEXT },
  'ci-wait': { ...COMMON, conclusion: TEXT },
  'review-round': { ...COMMON, findings: NUM, blocking: NUM, should_fix: NUM, nit: NUM },
  reviewer: { ...COMMON, agent: TEXT, model: TEXT, substituted_for: TEXT, findings: NUM, blocking: NUM },
  'fix-findings': { ...COMMON, fixed: NUM, argued: NUM },
  adjudicate: { ...COMMON, reproduced: BOOL },
  merge: { ...COMMON, sha: TEXT },
  reconcile: { ...COMMON, archived: NUM },
  'status-write': { ...COMMON, status: TEXT, item: TEXT },
  'decision-packet': { ...COMMON, item: TEXT },
  other: { ...COMMON },
};

export function checkDetail(kind: string, detail: unknown, field: string): Record<string, unknown> | undefined {
  if (detail === undefined || detail === null) return undefined;
  if (!isObj(detail)) bad(field, 'must be an object');
  if (JSON.stringify(detail).length > 2048) bad(field, 'is over 2 KB');
  const schema = DETAIL_SCHEMAS[kind];
  for (const [k, v] of Object.entries(detail as object)) {
    const type = schema[k];
    if (!type) bad(`${field}.${k}`, `is not a ${kind} detail key (${Object.keys(schema).join(', ')})`);
    if (type === NUM && (typeof v !== 'number' || !Number.isFinite(v))) bad(`${field}.${k}`, 'must be a number');
    if (type === BOOL && typeof v !== 'boolean') bad(`${field}.${k}`, 'must be a boolean');
    // The shape here; whose pull request it is — the claim's home repository or one of its
    // `repos:`, by R-BTN-92's link rule — is checked where the claim is known (RunnerApi).
    if (type === PR && (typeof v !== 'string' || v.length > 1000 || !v.startsWith('https://'))) bad(`${field}.${k}`, 'must be a pull request URL');
    if (type === TEXT) freeText(v, `${field}.${k}`, 200);
  }
  return detail as Record<string, unknown>;
}

export function checkActivity(a: unknown, field: string): ActivityReport {
  if (!isObj(a)) bad(field, 'must be an object');
  const x = a as Record<string, unknown>;
  const id = matches(ACTIVITY_ID, `${field}.id`)(x.id);
  if (!ACTIVITY_KINDS.includes(x.kind as never)) bad(`${field}.kind`, `must be one of ${ACTIVITY_KINDS.join(', ')}`);
  const kind = x.kind as ActivityReport['kind'];
  if (x.source !== 'skill' && x.source !== 'hook') bad(`${field}.source`, "must be 'skill' or 'hook'");
  const claim_id = x.claim_id ?? null;
  if (claim_id !== null && (!isInt(claim_id) || (claim_id as number) <= 0)) bad(`${field}.claim_id`, 'must be a claim id or null');
  if (claim_id === null && kind !== 'orient') bad(`${field}.claim_id`, "is required for every kind but 'orient'");
  if (!isTime(x.started_at)) bad(`${field}.started_at`, 'must be epoch ms');
  if ((x.ended_at === undefined) !== (x.outcome === undefined)) bad(`${field}`, 'ended_at and outcome come together');
  if (x.ended_at !== undefined && !isTime(x.ended_at)) bad(`${field}.ended_at`, 'must be epoch ms');
  if (x.outcome !== undefined && !OUTCOMES.includes(x.outcome as never)) bad(`${field}.outcome`, `must be one of ${OUTCOMES.join(', ')}`);
  if (x.seq !== undefined && (!isInt(x.seq) || (x.seq as number) < 1 || (x.seq as number) > 3)) bad(`${field}.seq`, 'must be 1–3');
  return {
    id,
    claim_id: claim_id as number | null,
    parent_id: optional(x.parent_id, matches(ACTIVITY_ID, `${field}.parent_id`)),
    call_id: optional(x.call_id, matches(/^[A-Za-z0-9._:-]{1,128}$/, `${field}.call_id`)),
    kind,
    seq: x.seq as number | undefined,
    label: optional(x.label, (v) => freeText(v, `${field}.label`)),
    source: x.source as ActivityReport['source'],
    started_at: x.started_at as number,
    ended_at: x.ended_at as number | undefined,
    outcome: x.outcome as ActivityReport['outcome'],
    detail: checkDetail(kind, x.detail, `${field}.detail`),
  };
}

// ── owner input (§9, §7.4) ───────────────────────────────────────────────────────────────

export const RELEASE_REASONS = ['requested', 'owner-cancel', 'provider-suspended'] as const;

export function checkMessage(body: unknown): { to_runner_id: number; kind: 'release' | 'status_request' | 'wind-down'; payload: Record<string, unknown> | null } {
  if (!isObj(body)) bad('body', 'must be a JSON object');
  const b = body as Record<string, unknown>;
  if (!isInt(b.to_runner_id) || (b.to_runner_id as number) <= 0) bad('to_runner_id', 'must be a runner id');
  if (b.kind === 'status_request') return { to_runner_id: b.to_runner_id as number, kind: 'status_request', payload: null };
  // B-109: an owner's wind-down — the graceful face of the reap, delivered by the heartbeat
  // and acknowledged like any message; the runner drains, completing its leg first.
  if (b.kind === 'wind-down') return { to_runner_id: b.to_runner_id as number, kind: 'wind-down', payload: null };
  if (b.kind !== 'release') bad('kind', "must be 'release', 'status_request' or 'wind-down'");
  const p = b.payload;
  if (!isObj(p)) bad('payload', 'a release names {ticket_id, reason}');
  const x = p as Record<string, unknown>;
  const ticket_id = matches(TICKET_ID, 'payload.ticket_id')(x.ticket_id);
  if (!RELEASE_REASONS.includes(x.reason as never)) bad('payload.reason', `must be one of ${RELEASE_REASONS.join(', ')}`);
  return { to_runner_id: b.to_runner_id as number, kind: 'release', payload: { ticket_id, reason: x.reason } };
}

export function checkShadowReport(body: unknown) {
  if (!isObj(body)) bad('body', 'must be a JSON object');
  const b = body as Record<string, unknown>;
  if (b.transition !== 'claim' && b.transition !== 'set') bad('transition', "must be 'claim' or 'set'");
  return {
    transition: b.transition as 'claim' | 'set',
    ticket_id: matches(TICKET_ID, 'ticket_id')(b.ticket_id),
    status: matches(NAME, 'status')(b.status),
    // `claim.sh claim` writes the nonce; a later `set` may not know it.
    nonce: b.transition === 'claim' ? matches(/^[0-9a-f]{6}$/, 'nonce')(b.nonce) : optional(b.nonce, matches(/^[0-9a-f]{6}$/, 'nonce')),
    at: isTime(b.at) ? (b.at as number) : bad('at', 'must be epoch ms'),
  };
}

// ── claims (§6.2, §6.5, §6.7; R3-1212) ───────────────────────────────────────────────────

const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;
export const GIT_SHA = /^[0-9a-f]{40}$/;
/** §6.5: the `released:` reasons, exactly. */
export const RELEASE_END_REASONS = ['blocked', 'stale-board', 'cannot-finish:transient', 'cannot-finish:capability', 'cannot-finish:spec', 'cannot-finish:contract-output', 'cannot-finish:contract-input',
  'lease-lost', 'requested', 'owner-cancel', 'provider-suspended', 'provider-exhausted', 'course-changed', 'leg-timeout'] as const;

/** A claim's request (§6.2). `bills` is retired (B-168: a `prefer` entry bills no account once
 *  route choices are gone, R-BTN-100): a request carrying one is read as if it did not, the
 *  caller logging `deprecated-field` while the history's Migrations entry lasts. */
export function boundedJson(value: unknown, field: string, limit = 4096): string {
  let json: string | undefined;
  try { json = JSON.stringify(value); } catch { /* not JSON */ }
  if (json === undefined || new TextEncoder().encode(json).length > limit) bad(field, `must be JSON of at most ${limit} bytes`);
  return json!;
}

export interface ClaimPreference { ticket_id: string; leg?: string }

export function checkClaim(body: unknown): { request_id: string; ticket_id: string | null; prefer: ClaimPreference[] | null; legs?: string[]; rationale: string | null; retired: string[] } {
  if (!isObj(body)) bad('body', 'must be a JSON object');
  const b = body as Record<string, unknown>;
  const retired = new Set<string>();
  if (b.bills !== undefined) retired.add('bills');
  let prefer: ClaimPreference[] | null = null;
  if (b.prefer !== undefined) {
    if (b.ticket_id != null) bad('prefer', 'cannot be combined with ticket_id');
    if (!Array.isArray(b.prefer) || b.prefer.length > 50) bad('prefer', 'must be a list of at most 50 entries');
    prefer = (b.prefer as unknown[]).map((entry, i) => {
      const at = `prefer[${i}]`;
      if (!isObj(entry)) bad(at, 'must be a JSON object');
      const e = entry as Record<string, unknown>;
      if (e.bills !== undefined) retired.add('prefer.bills');
      return { ticket_id: matches(TICKET_ID, `${at}.ticket_id`)(e.ticket_id), leg: optional(e.leg, matches(COURSE_ID, `${at}.leg`)) };
    });
  }
  let legs: string[] | undefined;
  if (b.legs !== undefined) {
    if (!Array.isArray(b.legs) || !b.legs.length || b.legs.length > 50 || b.ticket_id != null || prefer) {
      bad('legs', 'give 1 to 50 leg names on an unnamed claim');
    }
    legs = [...new Set((b.legs as unknown[]).map(matches(COURSE_ID, 'legs')))];
  }
  const rationale = b.rationale === undefined ? null : boundedJson(b.rationale, 'rationale');
  return {
    request_id: matches(REQUEST_ID, 'request_id')(b.request_id),
    ticket_id: optional(b.ticket_id, matches(TICKET_ID, 'ticket_id')) ?? null,
    prefer, ...(legs ? { legs } : {}), rationale, retired: [...retired],
  };
}

/** A URL a runner or sync points at (a hand-off comment, a review): https, at most 1000
 *  characters, no whitespace or control character. Shown as text and linked only through
 *  `httpsLink` (§10.4). */
export const isHttpsPointer = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= 1000 && v.startsWith('https://') && !/[\s\u0000-\u001f\u007f]/.test(v);
/** An evidence pointer (R-BTN-8): a commit sha, or the URL of the comment or review that ended
 *  the leg. */
const isPointer = (v: unknown) => typeof v === 'string' && (GIT_SHA.test(v) || isHttpsPointer(v));

/** R-BTN-108's envelope: one leg output, by pointer or inline, naming its schema. */
export interface Output {
  name: string;
  schema: string;
  uri?: string;
  digest?: string;
  value?: unknown;
}

/** R-BTN-82: outputs per leg run. */
export const OUTPUTS_MAX = 16;
const OUTPUT_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const OUTPUT_DIGEST = /^sha256:[0-9a-f]{64}$/;
/** R-BTN-82's pointers: `git:<owner>/<name>@<commit>:<path>` or `#blob=<sha>` (content-addressed),
 *  an `https://` URL, or `s3://<bucket>/<key>?versionId=…`; at most 1 KB. */
const GIT_POINTER = /^git:[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+(@[0-9a-f]{40}([0-9a-f]{24})?:[^\s]+|#blob=[0-9a-f]{40}([0-9a-f]{24})?)$/;
const S3_POINTER = /^s3:\/\/[a-z0-9.-]{3,63}\/[^\s?]+\?versionId=[^\s&]+$/;

/** `outputs` on an advance or an end (R-BTN-108, R-BTN-82): at most 16 envelopes, distinct
 *  names, each `{name, schema, uri, digest?}` or `{name, schema, value}` — never both. A value is
 *  at most 4 KB serialized; its content is validated against its schema by the caller, which
 *  holds the repository's schemas. */
export function checkOutputs(v: unknown): Output[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > OUTPUTS_MAX) bad('outputs', `must be a list of at most ${OUTPUTS_MAX} outputs`);
  const names = new Set<string>();
  return (v as unknown[]).map((raw, i) => {
    const at = `outputs[${i}]`;
    if (!isObj(raw)) bad(at, 'must be {name, schema, uri, digest?} or {name, schema, value}');
    const o = raw as Record<string, unknown>;
    for (const k of Object.keys(o)) if (!['name', 'schema', 'uri', 'digest', 'value'].includes(k)) bad(`${at}.${k}`, 'is not an output field');
    const name = matches(OUTPUT_NAME, `${at}.name`)(o.name);
    if (names.has(name)) bad(`${at}.name`, `repeats ${name}`);
    names.add(name);
    if (!parseSchemaId(o.schema)) bad(`${at}.schema`, 'must name a schema as <id>@<version>');
    const hasValue = Object.prototype.hasOwnProperty.call(o, 'value');
    if (hasValue === (o.uri !== undefined)) bad(at, 'gives exactly one of uri and value');
    if (hasValue) {
      if (o.digest !== undefined) bad(`${at}.digest`, 'an inline value carries no digest');
      let n = Infinity;
      try { n = new TextEncoder().encode(JSON.stringify(o.value)).length; } catch { /* not JSON */ }
      if (n > VALUE_MAX_BYTES) bad(`${at}.value`, `must be at most ${VALUE_MAX_BYTES} bytes serialized; give a larger output by pointer`);
      return { name, schema: o.schema as string, value: o.value };
    }
    const uri = o.uri;
    if (typeof uri !== 'string' || uri.length > 1000 || !(GIT_POINTER.test(uri) || S3_POINTER.test(uri) || isHttpsPointer(uri))) {
      bad(`${at}.uri`, 'must be a git:, https:// or s3:// pointer of at most 1000 characters');
    }
    const digest = optional(o.digest, matches(OUTPUT_DIGEST, `${at}.digest`));
    // Anything not content-addressed carries its digest (R-BTN-82).
    if (!(uri as string).startsWith('git:') && !digest) bad(`${at}.digest`, 'an https:// or s3:// output carries its sha256:<hex> digest');
    return { name, schema: o.schema as string, uri: uri as string, ...(digest ? { digest } : {}) };
  });
}

export interface End {
  end_reason: string;
  status: 'completed' | 'released';
  /** `suspended:<station>`'s station. */
  suspended_at: string | null;
  reached: string | null;
  next: string | null;
  detail: string | null;
  ended_at_sha: string | null;
  /** `released:<reason>` naming no §6.5 reason: an owner bar's (R-BTN-67), checked by the claims. */
  owner_bar: boolean;
  /** R-BTN-126 (B-104's branch): a `released:blocked` end's failed prerequisite — `capability`,
   *  a holding the runner declares and says it lost. */
  prerequisite: { kind: 'capability'; ref: string } | null;
  /** R-BTN-108: what the finished leg produced. */
  outputs: Output[];
  /** B-134: the leg-end scope audit — actions the runner's own evidence (the refs the leg's
   *  window moved, named as pushes by their reflog) shows outside the claim's ticket scope,
   *  judged against that scope by the core, never trusted as the verdict. Entries dropped for
   *  their shape, and actions beyond the report's sixteen, are counted in `dropped`, so a
   *  report is never silently shortened. */
  scope_exceeded: ScopeReport;
  /** R-BTN-153 (B-175): the check command's exit status, when the end is its verdict. */
  exit_status: number | null;
  /** B-248 (R-BTN-202): the local order the finished leg was worked under while Baton was
   *  unreachable — who gave it and when the leg ran, recorded, never trusted for a decision. */
  local_order: LocalOrder | null;
  /** R-BTN-113 (B-4): the session link of the leg this end finishes, as an advance carries one. */
  session_url: string | null;
  /** R-BTN-86 (§4.6, R3-1258): the local ids of the child tickets the ending leg filed in git,
   *  reported with a `suspended:<station>` or a `released:` end alone — `done` with it is
   *  `invalid-params`, here before any write. Each id by the ticket-id rule (§12.3); at most
   *  50; never the parent's own (the claims check that, which knows the ticket). */
  spawned: string[] | null;
}

/** One action of a leg-end scope report (B-134): the kind of evidence and what it touched — a
 *  forge path (a repository's whole spelling, `owner/name` or a subgroup's `group/sub/repo`)
 *  for a push or a PR, a host for an egress reach. Shape-checked only; whether the action is
 *  inside the claim's ticket scope is the core's to judge. */
export interface ScopeAction {
  kind: 'push' | 'pr' | 'egress';
  target: string;
  /** The ref a push moved, when the evidence names one. */
  ref?: string;
}

/** A leg-end scope report as the wire carries it and the store keeps it: the actions that
 *  passed their shape check and how many were dropped for it or beyond its sixteen. Null is
 *  no report at all. */
export type ScopeReport = { actions: ScopeAction[]; dropped: number } | null;

/**
 * §5.9's restructure (B-167) took `taken` out of the wire, with `BATON_TAKEN` and the route
 * choices it reported on: an advance or an end that still carries it is taken with the field
 * ignored, its value unread (the history's Migrations entry "part 4's retired fields").
 */
const retiredFields = (b: Record<string, unknown>) => {
  if (b.taken !== undefined) delete b.taken;
};

/** B-134: a forge path as a scope report names its target — two to four segments of a
 *  repository's spelling (a GitLab subgroup's `group/sub/repo` names its repository by all
 *  three), the last the repository, none longer than a segment's own bound. This is
 *  `isForgePath`'s shape without the forge to ask for; the scope a target is judged against
 *  keeps the same spelling. */
const FORGE_PATH = /^[A-Za-z0-9-]{1,39}(?:\/[A-Za-z0-9-]{1,39}){0,2}\/[A-Za-z0-9._-]{1,100}$/;

/** B-134: a leg-end scope report, `{actions, dropped}` — at most 16 actions, each a push, a
 *  PR or an egress reach naming the repository (a forge path) or the host it touched, and the
 *  count of actions beyond them: what the runner truncated from its report and what this check
 *  drops for a shape failure, logged `scope-invalid` by the claims. A malformed ENTRY is
 *  dropped and counted, never refused: the report rides the advance or end that finishes the
 *  leg and must not fail it. */
export function checkScopeReport(v: unknown): ScopeReport {
  if (v === undefined || v === null) return null;
  if (!isObj(v) || !Array.isArray(v.actions)) return null;
  // 8 KB admits every honest report the entry caps spell (16 × (≤219-char target + ≤200-char
  // ref + overhead) ≈ 7.3 KB) — a bound that dropped the whole report at a maximal honest one
  // would hide exactly the findings it exists to carry.
  if (JSON.stringify(v).length > 8192) return null;
  const actions: ScopeAction[] = [];
  let dropped = Number.isInteger(v.dropped) && (v.dropped as number) >= 0 && (v.dropped as number) <= 1_000_000 ? v.dropped as number : 0;
  for (const e of (v.actions as unknown[]).slice(0, 16)) {
    if (!isObj(e) || (e.kind !== 'push' && e.kind !== 'pr' && e.kind !== 'egress')) {
      dropped++;
      continue;
    }
    const ref = e.ref;
    if (ref !== undefined && (typeof ref !== 'string' || ref.length > 200 || !/^[A-Za-z0-9._\/-]+$/.test(ref))) {
      dropped++;
      continue;
    }
    // A push or a PR names the repository it touched (a forge path); an egress reach names the
    // host. Anything else is dropped and counted, never refused — the report rides the advance
    // or end that finishes the leg.
    const shape = e.kind === 'egress' ? HOSTNAME : FORGE_PATH;
    if (typeof e.target !== 'string' || !shape.test(e.target)) {
      dropped++;
      continue;
    }
    actions.push({ kind: e.kind, target: e.target, ...(ref != null ? { ref: ref as string } : {}) });
  }
  dropped += Math.max(0, (v.actions as unknown[]).length - 16);
  return { actions, dropped };
}

/** R-BTN-153 (B-175): the check command's exit status, as the executor's `exec` read it — an
 *  integer 0 to 255. A timeout or an `exec` error has none (the executor's `status` is null), so
 *  an arrival carrying no `exit_status` is nobody's green verdict; the claims judge what station
 *  each may reach. */
const exitStatus = (v: unknown): number => {
  if (!isInt(v) || (v as number) < 0 || (v as number) > 255) bad('exit_status', 'must be an integer from 0 to 255, the check command’s exit status (R-BTN-153)');
  return v as number;
};

/** §6.5's ends: `done`, `suspended:<station>` and `released:<reason>`, each with an optional
 *  course-defined `detail` (§10.4 free text core stores and shows but never reads); `reached`, the
 *  station the claim rests at (R-BTN-71); `next`, the queued leg (R-BTN-83); and an optional
 *  pointer to the evidence, pushed first (R-BTN-8). */
/** R-BTN-86 (§4.6, R3-1258): the `spawned` report's bound — at most 50 children an end may name. */
export const SPAWNED_MAX = 50;
/** A capability or holding name as a declaration carries it (R-BTN-121; R-BTN-174's branch:
 * a lost holding may be any typed label, `model:glm-5.3` included). */
export const CAPABILITY_NAME = new RegExp(`^(?:${NAME.source}|${HOLDING.source.slice(1, -1)})$`);
export function checkEnd(body: unknown): End {
  if (!isObj(body)) bad('body', 'must be a JSON object');
  const b = body as Record<string, unknown>;
  const r = b.end_reason;
  if (typeof r !== 'string') bad('end_reason', 'must be a string');
  const reason = r as string;
  let status: 'completed' | 'released';
  let suspended_at: string | null = null;
  let ownerBar = false;
  if (reason === 'done') {
    status = 'completed';
  } else if (reason.startsWith('suspended:') && COURSE_ID.test(reason.slice(10))) {
    status = 'completed';
    suspended_at = reason.slice(10);
  } else if (reason.startsWith('released:') && RELEASE_END_REASONS.includes(reason.slice(9) as never)) {
    status = 'released';
  } else if (reason.startsWith('released:') && COURSE_ID.test(reason.slice(9)) && !reason.slice(9).startsWith('cannot-finish')) {
    status = 'released';
    ownerBar = true;
  } else {
    bad('end_reason', 'must be done, suspended:<station> or released:<a §6.5 reason>');
  }
  const reached = optional(b.reached, matches(COURSE_ID, 'reached')) ?? null;
  if (suspended_at && reached && reached !== suspended_at) bad('reached', `a suspended:${suspended_at} end rests at ${suspended_at}`);
  const next = optional(b.next, matches(COURSE_ID, 'next')) ?? null;
  const detail = b.detail === undefined || b.detail === null ? null : isFreeText(b.detail, 200) ? (b.detail as string) : bad('detail', 'must be §10.4 free text of at most 200 characters');
  const ptr = b.ended_at_sha;
  if (ptr !== undefined && ptr !== null && !isPointer(ptr)) bad('ended_at_sha', 'must be a commit sha or an https URL of at most 1000 characters');
  const sha = (ptr as string | undefined | null) ?? null;
  if (status! === 'released' && sha) bad('ended_at_sha', 'only a completed end points at its evidence');
  // R-BTN-126 (B-104's branch): a blocked end names the prerequisite that failed — `capability`
  // with a holding the runner declares and says it lost. The other kinds are the blocked-end
  // work's; a blocked end without one is malformed.
  let prerequisite: { kind: 'capability'; ref: string } | null = null;
  if (reason === 'released:blocked') {
    const p = b.prerequisite;
    if (!isObj(p) || p.kind !== 'capability' || typeof p.ref !== 'string' || !CAPABILITY_NAME.test(p.ref)) {
      bad('prerequisite', "a released:blocked end carries {kind: 'capability', ref: <the holding the runner lost>} (R-BTN-126)");
    }
    prerequisite = { kind: 'capability', ref: (p as { ref: string }).ref };
  }
  retiredFields(b);
  // R-BTN-86 (§4.6, R3-1258): the `spawned` report — local ids of the children the ending leg
  // filed in git, validated before any write. `done` takes none (the ticket closes; its children
  // are superseded by the close, R-BTN-168), and a `released:` owner-bar end is a release like
  // any other: both shapes carry it. At most 50, each by the ticket-id rule, each once; whether
  // one names the ending ticket itself the claims judge, which know the ticket.
  let spawned: string[] | null = null;
  if (b.spawned !== undefined && b.spawned !== null) {
    if (!Array.isArray(b.spawned) || b.spawned.length > SPAWNED_MAX) bad('spawned', `must be a list of at most ${SPAWNED_MAX} local ticket ids (R-BTN-86)`);
    const seen = new Set<string>();
    for (const [i, id] of (b.spawned as unknown[]).entries()) {
      if (typeof id !== 'string' || !LOCAL_ID.test(id)) bad(`spawned[${i}]`, `must be a local ticket id (R-BTN-86)`);
      if (seen.has(id as string)) bad(`spawned[${i}]`, `${id} appears twice`);
      seen.add(id as string);
    }
    spawned = b.spawned as string[];
    if (reason === 'done') bad('spawned', 'a done end spawns nothing — its open children are superseded by the close (R-BTN-86, R-BTN-168)');
  }
  return { end_reason: reason, status: status!, suspended_at, reached: reached ?? suspended_at, next, detail, ended_at_sha: sha, owner_bar: ownerBar, prerequisite, outputs: checkOutputs(b.outputs), scope_exceeded: checkScopeReport(b.scope_exceeded), exit_status: optional(b.exit_status, exitStatus) ?? null, session_url: carriedSessionUrl(b.session_url), spawned, local_order: checkLocalOrder(b.local_order) };
}

/** B-248 (R-BTN-202): a local order's provenance, as the advance or end that reports the leg
 *  carries it — the order's giver (`user@host`, as the runner's host names its OS user) and the
 *  instant the leg ran. Filter fields only (R-BTN-33): a name and an instant, never the order's
 *  text. */
export interface LocalOrder {
  by: string;
  ran_at: string;
}

const LOCAL_ORDER_BY = /^[A-Za-z0-9_][A-Za-z0-9._@+-]{0,127}$/;
const LOCAL_ORDER_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function checkLocalOrder(v: unknown): LocalOrder | null {
  if (v === undefined || v === null) return null;
  if (!isObj(v)) bad('local_order', 'must be {by, ran_at} (R-BTN-202)');
  const o = v as Record<string, unknown>;
  if (typeof o.by !== 'string' || !LOCAL_ORDER_BY.test(o.by)) bad('local_order.by', 'must be the order\'s giver as user@host, at most 128 characters (R-BTN-202)');
  if (typeof o.ran_at !== 'string' || !LOCAL_ORDER_AT.test(o.ran_at) || Number.isNaN(Date.parse(o.ran_at))) bad('local_order.ran_at', 'must be an ISO 8601 UTC instant (R-BTN-202)');
  return { by: o.by as string, ran_at: o.ran_at as string };
}

export interface Advance {
  course: string | null;
  leg: string;
  reached: string | null;
  evidence: string | null;
  bars: string[];
  /** R-BTN-108: what the finished leg produced, checked against `reached`'s entry (R-BTN-109). */
  outputs: Output[];
  /** B-134: the finished leg's scope audit, reported on the advance or end that finishes it. */
  scope_exceeded: ScopeReport;
  /** R-BTN-153 (B-175): the check command's exit status, when the arrival is its verdict. */
  exit_status: number | null;
  /** B-190 (§13.5 `claim_legs.head_sha`): the branch head the holder's checkout stands at when
   *  the run starts — where replay checks the ticket's code out. Null when unreported. */
  head_sha: string | null;
  /** B-190 (R-BTN-82, R-BTN-84): the run's own record, reported at its start — each resolved
   *  input as a pointer, and the ticket's version with the digest of what its source's `read`
   *  returned for the run. Stored in `leg_run_inputs` for replay. */
  run_inputs: RunInputs;
  /** B-248 (R-BTN-202): the local order the finished leg was worked under, as an end's. */
  local_order: LocalOrder | null;
  /** R-BTN-113 (B-4): the session link of the leg this advance finishes, shape-checked as the
   *  heartbeat's is; one that fails the link rule is dropped and logged, never a refused
   *  advance. Null when the advance carries none. */
  session_url: string | null;
}

/** B-190 (§5.5 R-BTN-82, §13.5): one resolved input of a run, as the envelope carries a pointer
 *  or a bounded inline value — never content. */
export interface RunInput {
  name: string;
  from_leg: string | null;
  from_run: number | null;
  uri: string;
  digest: string | null;
  value: unknown;
  hasValue: boolean;
  leg_version: number | null;
}

/** B-190: the run's ticket row — the source's posted `version` (B-183) and the digest of what
 *  its `read` returned for the run, the two replay compares. */
export interface RunTicket {
  version: string;
  read_digest: string;
}

export interface RunInputs {
  ticket: RunTicket | null;
  inputs: RunInput[];
}

/** B-190: an input name — the same grammar an output's is; the empty name is the run's ticket
 *  row's, reserved. */
const INPUT_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
/** B-183 (§4.2): a ticket version, 1–128 characters of the source's own opaque string. */
export const TICKET_VERSION = /^[A-Za-z0-9._:+/=-]{1,128}$/;
/** B-176 (§4.3 R-BTN-199): a sequence kind — opaque to core (value 3); the CLI names kinds
 *  (`ticket-b`, `rule`, `scenario`, `gate`, `migration`). */
export const SEQUENCE_KIND = /^[a-z][a-z0-9-]{0,31}$/;

/** B-176 (§4.3 R-BTN-199): what `POST …/sequences/{kind}/next` carries — a `floor`, the highest
 *  number the caller sees in git, and `for`, a ticket the number is for. `for` is recorded,
 *  never trusted: it names a ticket for the event, and decides nothing. */
export interface SequenceTake {
  floor: number | null;
  forTicket: string | null;
}
/** The `next` request's body, validated before any SQL (§12.3): `floor` a non-negative integer,
 *  `for` a local ticket id; unknown fields refused. */
export function checkSequenceTake(v: unknown): SequenceTake {
  if (v === undefined || v === null) return { floor: null, forTicket: null };
  if (!isObj(v)) bad('body', 'must be {floor?, for?}');
  const r = v as Record<string, unknown>;
  for (const k of Object.keys(r)) if (!['floor', 'for'].includes(k)) bad(k, 'is not a sequence field');
  let floor: number | null = null;
  if (r.floor !== undefined && r.floor !== null) {
    if (!Number.isSafeInteger(r.floor) || (r.floor as number) < 0) bad('floor', 'must be a non-negative integer');
    floor = r.floor as number;
  }
  const forTicket = optional(r.for, matches(LOCAL_ID, 'for')) ?? null;
  return { floor, forTicket };
}

/** B-113 (§4.3): what the sync's dependencies read (`POST /v1/sync/dependencies`) carries —
 *  `{ids: [<qualified id>…]}`, the `depends_on` entries of other repositories the posting
 *  repository's tickets name. The ids themselves are judged where they are resolved
 *  (dependencies.ts); this holds the body's shape alone. */
export function checkDependenciesRead(v: unknown): string[] {
  if (!isObj(v)) bad('body', 'must be {ids: [<repository>:<local>…]}');
  const r = v as Record<string, unknown>;
  for (const k of Object.keys(r)) if (k !== 'ids') bad(k, 'is not a dependencies-read field');
  if (!Array.isArray(r.ids) || r.ids.length > 500 || !r.ids.every((x) => typeof x === 'string')) bad('ids', 'must be a list of at most 500 qualified ids');
  return r.ids as string[];
}

/** B-190: `run_inputs` as the advance carries it (§13.5 `leg_run_inputs`): pointers and digests
 *  only, validated before SQL (R-BTN-33). */
export function checkRunInputs(v: unknown): RunInputs {
  if (v === undefined || v === null) return { ticket: null, inputs: [] };
  if (!isObj(v)) bad('run_inputs', 'must be {ticket?, inputs: […]}');
  const r = v as Record<string, unknown>;
  for (const k of Object.keys(r)) if (!['ticket', 'inputs'].includes(k)) bad(`run_inputs.${k}`, 'is not a run_inputs field');
  let ticket: RunTicket | null = null;
  if (r.ticket !== undefined && r.ticket !== null) {
    if (!isObj(r.ticket)) bad('run_inputs.ticket', 'must be {version, read_digest}');
    const t = r.ticket as Record<string, unknown>;
    ticket = { version: matches(TICKET_VERSION, 'run_inputs.ticket.version')(t.version), read_digest: matches(OUTPUT_DIGEST, 'run_inputs.ticket.read_digest')(t.read_digest) };
  }
  const raw = r.inputs ?? [];
  if (!Array.isArray(raw) || raw.length > OUTPUTS_MAX) bad('run_inputs.inputs', `must be a list of at most ${OUTPUTS_MAX} inputs`);
  const names = new Set<string>();
  const inputs = (raw as unknown[]).map((e, i) => {
    const at = `run_inputs.inputs[${i}]`;
    if (!isObj(e)) bad(at, 'must be {name, uri, digest?} or {name, value}');
    const o = e as Record<string, unknown>;
    for (const k of Object.keys(o)) if (!['name', 'from_leg', 'from_run', 'uri', 'digest', 'value', 'leg_version'].includes(k)) bad(`${at}.${k}`, 'is not an input field');
    const name = matches(INPUT_NAME, `${at}.name`)(o.name);
    if (names.has(name)) bad(`${at}.name`, `repeats ${name}`);
    names.add(name);
    const from_leg = optional(o.from_leg, matches(COURSE_ID, `${at}.from_leg`)) ?? null;
    // `optional`'s inference cannot carry a predicate, so the two bounded integers read directly.
    const optionalInt = (v: unknown, field: string): number | null => {
      if (v === undefined || v === null) return null;
      if (!Number.isInteger(v) || (v as number) < 1) bad(field, 'must be an integer of at least 1');
      return v as number;
    };
    const from_run = optionalInt(o.from_run, `${at}.from_run`);
    const leg_version = optionalInt(o.leg_version, `${at}.leg_version`);
    const hasValue = Object.prototype.hasOwnProperty.call(o, 'value');
    if (hasValue === (o.uri !== undefined)) bad(at, 'gives exactly one of uri and value');
    if (hasValue) {
      if (o.digest !== undefined) bad(`${at}.digest`, 'an inline value carries no digest');
      let n = Infinity;
      try { n = new TextEncoder().encode(JSON.stringify(o.value)).length; } catch { /* not JSON */ }
      if (n > VALUE_MAX_BYTES) bad(`${at}.value`, `must be at most ${VALUE_MAX_BYTES} bytes serialized`);
      return { name, from_leg, from_run, uri: '', digest: null, value: o.value, hasValue: true, leg_version };
    }
    const uri = o.uri;
    if (typeof uri !== 'string' || uri.length > 1000 || !(GIT_POINTER.test(uri) || S3_POINTER.test(uri) || isHttpsPointer(uri))) {
      bad(`${at}.uri`, 'must be a git:, https:// or s3:// pointer of at most 1000 characters');
    }
    const digest = optional(o.digest, matches(OUTPUT_DIGEST, `${at}.digest`));
    // Anything not content-addressed carries its digest (R-BTN-82) — a git pointer may name its
    // bytes itself (a blob id), and replay checks the digest when one is recorded.
    if (!(uri as string).startsWith('git:') && !digest) bad(`${at}.digest`, 'an https:// or s3:// input carries its sha256:<hex> digest');
    return { name, from_leg, from_run, uri: uri as string, digest: digest ?? null, value: null, hasValue: false, leg_version };
  });
  return { ticket, inputs };
}

/** A `session_url` as the heartbeat, an advance or an end carries it (R-BTN-113, B-4): a bounded
 *  string, or null when the call carries none — the link rule (https, no userinfo, an allowlisted
 *  host) drops one that fails and logs it, never refusing the call. A non-string or an
 *  over-4096-character value is taken as none, as the heartbeat's shape check reads it. */
const carriedSessionUrl = (v: unknown): string | null =>
  typeof v === 'string' && v.length <= 4096 ? v : null;

/** `POST /v1/runner/claims/{id}/advance` (R-BTN-63, §11): the leg to start; `reached`, the
 *  outcome the running leg reached; a pointer to its evidence; the tags the holder bars from the
 *  new leg. `course` is opaque fleet data (R-BTN-99). */
export function checkAdvance(body: unknown): Advance {
  if (!isObj(body)) bad('body', 'must be a JSON object');
  const b = body as Record<string, unknown>;
  // R-BTN-86 (§4.6): `spawned` rides an END alone — an advance starts a leg, it files nothing.
  if (b.spawned !== undefined) bad('spawned', 'rides an end with suspended:<station> or released:, never an advance (R-BTN-86)');
  const leg = matches(COURSE_ID, 'leg')(b.leg);
  const reached = optional(b.reached, matches(COURSE_ID, 'reached')) ?? null;
  const evidence = b.evidence === undefined || b.evidence === null ? null : isPointer(b.evidence) ? (b.evidence as string) : bad('evidence', 'must be a commit sha or an https URL of at most 1000 characters');
  const raw = b.bars ?? [];
  if (!Array.isArray(raw) || raw.length > TAGS_MAX || !raw.every((t) => typeof t === 'string' && TAG.test(t))) bad('bars', `must be a list of at most ${TAGS_MAX} tags`);
  const head_sha = optional(b.head_sha, matches(GIT_SHA, 'head_sha')) ?? null;
  const course = b.course === undefined ? null : boundedJson(b.course, 'course');
  retiredFields(b);
  return { leg, reached, evidence, course, bars: [...new Set(raw as string[])], outputs: checkOutputs(b.outputs), scope_exceeded: checkScopeReport(b.scope_exceeded), head_sha, run_inputs: checkRunInputs(b.run_inputs), session_url: carriedSessionUrl(b.session_url), exit_status: optional(b.exit_status, exitStatus) ?? null, local_order: checkLocalOrder(b.local_order) };
}

/** §6.7: the sync's confirmations, `[{claim_id, sha}]`. */
/** `POST /v1/runner/claims/{id}/conditions` (R-BTN-160, R-BTN-195; B-234): the report a runner
 * sends for each raise its channel check passed. Filter fields only (R-BTN-33): the subject and
 * body stay with the runner, and `url` is the runner's own word — kept for none but an unbound
 * `suspend`, and ignored for an `interact`, whose url Baton sets from the session link it holds.
 * `handler` is accepted and unread: no handler ticket is filed (R-BTN-161 unbuilt), and a
 * binding of `interact` is ignored anyway (R-BTN-195). */
export interface ConditionReport {
  type: string;
  disposition: 'interrupt' | 'suspend' | 'notify' | null;
  severity: 'critical' | 'high' | 'normal';
  restarts: Record<string, string> | null;
  default: string | null;
  url: string | null;
}

export function checkConditionReport(body: unknown): ConditionReport {
  if (!isObj(body)) bad('body', 'must be a JSON object');
  const b = body as Record<string, unknown>;
  const type = matches(CONDITION_TYPE, 'type')(b.type);
  if ((type as string).length > CONDITION_TYPE_MAX) bad('type', `must be at most ${CONDITION_TYPE_MAX} characters`);
  // The report may carry the disposition the runner's file reads; Baton's own word decides
  // (R-BTN-50), so it is only shape-checked, never trusted.
  if (b.disposition !== undefined && b.disposition !== null && !['interrupt', 'suspend', 'notify'].includes(b.disposition as string)) {
    bad('disposition', 'must be interrupt, suspend or notify');
  }
  const severity = b.severity === undefined || b.severity === null ? 'normal' : SEVERITIES.includes(b.severity as never) ? (b.severity as ConditionReport['severity']) : bad('severity', `must be one of ${SEVERITIES.join(', ')}`);
  let restarts: Record<string, string> | null = null;
  if (b.restarts !== undefined && b.restarts !== null) {
    if (!isObj(b.restarts) || Object.keys(b.restarts).length === 0 || Object.keys(b.restarts).length > 8) bad('restarts', 'must be 1–8 ids with one-line descriptions');
    for (const [id, text] of Object.entries(b.restarts as Record<string, unknown>)) {
      if (!RESTART_ID.test(id)) bad(`restarts.${id}`, 'a restart id matches ^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$ (§12.3)');
      if (!isFreeText(text)) bad(`restarts.${id}`, 'must be §10.4 free text');
    }
    restarts = b.restarts as Record<string, string>;
  }
  const def = optional(b.default, matches(RESTART_ID, 'default')) ?? null;
  if (def != null && (restarts == null || !Object.prototype.hasOwnProperty.call(restarts, def))) bad('default', 'names one of the raise\'s restarts');
  const url = b.url === undefined || b.url === null ? null : isHttpsPointer(b.url) ? (b.url as string) : bad('url', 'must be an https URL of at most 1000 characters');
  if (b.handler !== undefined && b.handler !== null && typeof b.handler !== 'string') bad('handler', 'must be a course id');
  retiredFields(b);
  return { type: type as string, disposition: (b.disposition as ConditionReport['disposition']) ?? null, severity, restarts, default: def, url };
}

export function checkConfirmations(v: unknown): { claim_id: number; sha: string }[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 500) bad('confirmations', 'must be a list of at most 500');
  return (v as unknown[]).map((c, i) => {
    if (!isObj(c) || !isInt(c.claim_id)) bad(`confirmations[${i}]`, 'must be {claim_id, sha}');
    return { claim_id: (c as Record<string, unknown>).claim_id as number, sha: matches(GIT_SHA, `confirmations[${i}].sha`)((c as Record<string, unknown>).sha) };
  });
}

/** R-BTN-19: the heartbeat's report that the sidecar has fenced reaped claims — a list, one
 *  entry per claim (B-188); a single object, as runners before B-188 send it, is one entry. */
export function checkFenced(v: unknown): { claim_id: number }[] {
  if (v === undefined || v === null) return [];
  const list = Array.isArray(v) ? v : [v];
  if (list.length > MAX_CLAIMS_CAP) bad('fenced', `must list at most ${MAX_CLAIMS_CAP} claims`);
  return list.map((x, i) => {
    if (!isObj(x) || !isInt(x.claim_id) || x.terminated !== true) bad(Array.isArray(v) ? `fenced[${i}]` : 'fenced', 'must be {claim_id, terminated: true}');
    return { claim_id: (x as Record<string, unknown>).claim_id as number };
  });
}

/** An owner action that names its own confirmation (§14: force-reap). */
export function checkConfirm(body: unknown): void {
  if (!isObj(body) || body.confirm !== true) bad('confirm', 'must be true');
}

export function checkAccept(body: unknown): { repository: string; sha: string } {
  if (!isObj(body)) bad('body', 'must be a JSON object');
  const b = body as Record<string, unknown>;
  return { repository: checkRepositoryId(b.repository), sha: matches(GIT_SHA, 'sha')(b.sha) };
}

/** `POST /v1/ui/resync` (B-201): the repository whose sync is asked to run, and nothing else.
 *  `force` and `sha` name a forced resync onto a rewritten head, which is not built (R-BTN-11):
 *  they are refused by name, never ignored. */
export function checkResync(body: unknown): { repository: string } {
  if (!isObj(body)) bad('body', 'must be a JSON object');
  const b = body as Record<string, unknown>;
  if (b.force !== undefined || b.sha !== undefined) bad('force', 'a forced resync is not built (R-BTN-11): a rewritten history is held, and accepted with POST /v1/ui/board/accept');
  for (const k of Object.keys(b)) if (k !== 'repository') bad(`body.${k}`, 'unknown field');
  return { repository: checkRepositoryId(b.repository) };
}

/** §6.7: the owner's resolution of an unconfirmed completion. */
export function checkResolve(body: unknown): { action: 'confirm' | 'release' } {
  if (!isObj(body) || (body.action !== 'confirm' && body.action !== 'release') || body.confirm !== true) {
    bad('body', "must be {action: 'confirm' | 'release', confirm: true}");
  }
  return { action: (body as Record<string, unknown>).action as 'confirm' | 'release' };
}

/** `POST /v1/owner/{repository}/tickets/{ticket}/resolve` (R-BTN-78, §11): `{decision, answer}`.
 *  `baton:contract` is raised from B-39 on, and the `route` answer arrives with the owner's
 *  re-route (B-38); until then each is refused by name rather than accepted and ignored. Any
 *  other decision id is one a sync posted on the ticket (B-110): its answer is one of the
 *  options the decision carries, checked against the stored decision by the route. */
export function checkDecisionAnswer(body: unknown):
  | { decision: 'baton:retries' | 'baton:stalled'; answer: 'retry' | 'park' }
  | { decision: string; answer: string; posted: true } {
  if (!isObj(body)) bad('body', 'must be a JSON object');
  const b = body as Record<string, unknown>;
  for (const k of Object.keys(b)) if (!['decision', 'answer', 'leg'].includes(k)) bad(`body.${k}`, 'unknown field');
  if (b.decision === 'baton:contract') bad('decision', 'baton:contract is raised with leg contracts (B-39), not yet');
  if (typeof b.decision === 'string' && !b.decision.startsWith('baton:') && DECISION_ID.test(b.decision)) {
    // B-110: a decision the ticket's sync posted — the owner's answer to the course's own
    // question (create-pr's third failed review round), one of the decision's options.
    if (typeof b.answer !== 'string' || !DECISION_OPTION.test(b.answer)) bad('answer', `must be one of the decision's options (${DECISION_OPTION})`);
    if (b.leg !== undefined) bad('leg', 'only with the route answer');
    return { decision: b.decision, answer: b.answer as string, posted: true };
  }
  if (b.decision !== 'baton:retries' && b.decision !== 'baton:stalled') bad('decision', "must be 'baton:retries', 'baton:stalled' or a decision the ticket's sync posted");
  if (b.answer === 'route') bad('answer', "route needs the owner's re-route (B-38), not yet: answer retry or park");
  if (b.answer !== 'retry' && b.answer !== 'park') bad('answer', "must be 'retry' or 'park'");
  if (b.leg !== undefined) bad('leg', 'only with the route answer');
  return { decision: b.decision as 'baton:retries' | 'baton:stalled', answer: b.answer as 'retry' | 'park' };
}

/** §8, §11: `{expedite?, hold?}` — booleans, at least one. */
export function checkOverride(body: unknown): { expedite?: boolean; hold?: boolean } {
  if (!isObj(body)) bad('body', 'must be a JSON object');
  const b = body as Record<string, unknown>;
  for (const k of ['expedite', 'hold']) if (b[k] !== undefined && typeof b[k] !== 'boolean') bad(k, 'must be a boolean');
  if (b.expedite === undefined && b.hold === undefined) bad('body', 'names expedite or hold');
  return { expedite: b.expedite as boolean | undefined, hold: b.hold as boolean | undefined };
}

/** What `POST /v1/repositories/{repository}/attestations` reads of R-BTN-181's envelope (§14):
 *  `{type, subject: {ticket}, value}`. B-7's slice takes `std:decision@1` alone — a person leg's
 *  answer (R-BTN-116), the type `baton decision answer` writes (R-BTN-127); the attestation store
 *  itself arrives with B-146, which widens this. */
export interface AnswerAttestation {
  type: string;
  /** A qualified ticket id, or a local one of `repository`. */
  ticket: string;
  value: { id?: string; leg?: string; option: string; reached?: string; ref?: string; answered_by?: string; commit?: string };
}

export function checkAttestation(body: unknown, repository: string): AnswerAttestation {
  if (!isObj(body)) bad('body', 'must be a JSON object');
  const b = body as Record<string, unknown>;
  for (const k of Object.keys(b)) if (!['type', 'subject', 'value'].includes(k)) bad(`body.${k}`, 'unknown field');
  if (b.type !== DECISION_TYPE_NAME) bad('type', `must be ${DECISION_TYPE_NAME} — the one attestation Baton reads here (R-BTN-116); the rest arrive with B-146`);
  if (!isObj(b.subject)) bad('subject', 'must be {ticket}');
  else for (const k of Object.keys(b.subject)) if (k !== 'ticket') bad(`subject.${k}`, 'unknown field');
  const raw = (b.subject as Record<string, unknown>).ticket;
  if (typeof raw !== 'string' || !raw.length) bad('subject.ticket', 'must name the ticket');
  const ticket = (raw as string).includes(':') ? raw as string : `${repository}:${raw as string}`;
  if (!TICKET_ID.test(ticket) || repositoryOf(ticket) !== repository) bad('subject.ticket', `must be a ticket of ${repository}`);
  if (!isObj(b.value)) bad('value', `must be a ${DECISION_TYPE_NAME} value`);
  const v = b.value as Record<string, unknown>;
  for (const k of Object.keys(v)) if (!['id', 'leg', 'option', 'reached', 'ref', 'answered_by', 'commit'].includes(k)) bad(`value.${k}`, 'unknown field');
  if (typeof v.option !== 'string' || !v.option.length) bad('value.option', 'must name the option the person chose');
  const str = (k: string) => {
    if (v[k] !== undefined && (typeof v[k] !== 'string' || !(v[k] as string).length)) bad(`value.${k}`, 'must be a non-empty string');
  };
  str('id'); str('leg'); str('reached'); str('ref'); str('answered_by'); str('commit');
  return { type: b.type as string, ticket, value: v as AnswerAttestation['value'] };
}

/** The one attestation type either side of the API reads (R-BTN-116; R-BTN-191's list arrives
 *  with B-146): a person's answer to a person leg, `{id, leg, option, reached, ref?, …}`. */
export const DECISION_TYPE_NAME = 'std:decision@1';

// ── blocks, external resources and readings (§2g R-BTN-75–78, §2l R-BTN-101; R3-1251) ─────

/** R-BTN-76: an external resource's name — opaque to core (`llm:<model>`, `github-api`). */
export const RESOURCE_NAME = /^[a-z][a-z0-9:._/-]{0,79}$/;
/** An instance's name (`opencode-go:go_plus`, a `service` resource's own): the resource rule with
 *  `_` (spec-silent, recorded on R3-1251 — the scenarios' own instances carry it). */
export const INSTANCE_NAME = /^[a-z][a-z0-9_:./-]{0,79}$/;
/** R-BTN-78: a decision's id and its `asks` label. */
export const DECISION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
export const ASKS = /^[a-z][a-z0-9-]{0,31}$/;
/** R-BTN-76 (§6.3): a resource's two scopes. A `service` resource is its own one instance; an
 *  `account` one has a registered instance per account. What a runner uses is the repository's:
 *  the `service` instance and the account instances that list it. */
export const RESOURCE_SCOPES = ['account', 'service'] as const;
/** Readings one post carries, resources one leg needs, decisions one ticket posts (spec-silent,
 *  recorded on R3-1251). */
export const READINGS_MAX = 50;
export const NEEDS_MAX = 32;
export const DECISIONS_MAX = 32;
/** B-110: a posted decision's option id — what the owner answers (`merge`, `round`, …). */
export const DECISION_OPTION = /^[a-z][a-z0-9-]{0,31}$/;
/** B-110: a posted decision's options, at most this many, each granting at most this many runs. */
export const DECISION_OPTIONS_MAX = 8;
export const DECISION_GRANT_MAX = 10;
/** B-110: a posted decision's question — one line of display text, rendered as text (§10.4). */
export const DECISION_QUESTION = /^[^\u0000-\u001f\u007f]{1,200}$/;
/** R-BTN-76, R-BTN-101: how long a reading may stay in force, in seconds, by who posts it. An
 *  administrator's reading is one more instrument's, held to the same limits (R-BTN-181). */
export const VALID_FOR = { default_s: 3600, state_s: 24 * 3600, measure_s: 31 * 24 * 3600 } as const;

/** R-BTN-58: a key an owner or administrator registered works only where it is granted; any other
 *  (a bearer token, a BATON_KEYS seed key) keeps its interim reach on every repository. The one
 *  test of `credentials.created_by`, in TypeScript and as SQL over a column. */
export const isGrantedKey = (createdBy: string | null | undefined): boolean => !!createdBy && /^(owner|admin):/.test(createdBy);
export const grantedKeySql = (column: string) => `(${column} LIKE 'owner:%' OR ${column} LIKE 'admin:%')`;

export const isInstanceName = (v: unknown): v is string => typeof v === 'string' && INSTANCE_NAME.test(v);

/** A reading's `nonce` and `signature` (B-145) are its retired signature — R-BTN-181: a reading
 *  is authenticated by the request that posts it and carries no signature of its own. They are
 *  read and ignored while the history's Migrations entry "part 4's retired fields" lasts; the
 *  caller logs each `deprecated-field` and drops it. */
const RETIRED_READING = ['nonce', 'signature'] as const;

/** One reading's envelope (R-BTN-76, R-BTN-101), checked before any write; `detail` against its
 *  resources' schema is the caller's, which knows them. `valid_for` is seconds. `retired` names
 *  the fields the post carried that the window still reads (never a refusal of the reading). */
export interface Reading {
  instance: string;
  kind: 'state' | 'measure';
  available: boolean | null;
  until: number | null;
  valid_for_s: number;
  detail: unknown;
  retired: string[];
}
export function checkReading(v: unknown, field: string, maxStateS: number): Reading {
  if (!isObj(v)) bad(field, 'must be an object');
  const r = v as Record<string, unknown>;
  for (const k of Object.keys(r)) if (!['instance', 'kind', 'available', 'until', 'valid_for', 'detail', ...RETIRED_READING].includes(k)) bad(`${field}.${k}`, 'is not a reading field');
  if (!isInstanceName(r.instance)) bad(`${field}.instance`, 'must be an instance name');
  const retired = RETIRED_READING.filter((k) => r[k] !== undefined);
  const raw = r.kind ?? 'state';
  if (raw !== 'state' && raw !== 'measure') bad(`${field}.kind`, "must be 'state' or 'measure'");
  const kind = raw as Reading['kind'];
  const max = kind === 'measure' ? VALID_FOR.measure_s : maxStateS;
  const valid = r.valid_for ?? VALID_FOR.default_s;
  if (!Number.isSafeInteger(valid) || (valid as number) < 1 || (valid as number) > max) bad(`${field}.valid_for`, `must be 1 to ${max} seconds`);
  if (kind === 'measure') {
    if (r.available !== undefined || r.until !== undefined) bad(field, 'a measure carries only detail and valid_for');
    if (r.detail === undefined) bad(`${field}.detail`, 'a measure carries a detail');
    return { instance: r.instance as string, kind, available: null, until: null, valid_for_s: valid as number, detail: r.detail, retired };
  }
  if (typeof r.available !== 'boolean') bad(`${field}.available`, 'must be a boolean');
  if (r.until !== undefined && (r.available || !isTime(r.until))) bad(`${field}.until`, 'is epoch ms, for an unavailable instance only');
  return { instance: r.instance as string, kind, available: r.available as boolean, until: (r.until as number | undefined) ?? null, valid_for_s: valid as number, detail: r.detail, retired };
}

/** A readings post: `{readings: [...]}`, each checked. */
export function checkReadings(body: unknown, maxStateS: number = VALID_FOR.state_s): Reading[] {
  if (!isObj(body) || !Array.isArray(body.readings) || body.readings.length < 1 || body.readings.length > READINGS_MAX) bad('readings', `must be a list of 1 to ${READINGS_MAX}`);
  return ((body as { readings: unknown[] }).readings).map((r, i) => checkReading(r, `readings[${i}]`, maxStateS));
}

/** `POST /v1/admin/resources` (R-BTN-76): the schema itself is detailSchema.ts's to judge. */
export function checkResource(body: unknown): { name: string; scope: (typeof RESOURCE_SCOPES)[number]; detail_schema: unknown } {
  if (!isObj(body)) bad('body', 'must be a JSON object');
  const b = body as Record<string, unknown>;
  for (const k of Object.keys(b)) if (!['name', 'scope', 'detail_schema'].includes(k)) bad(`body.${k}`, 'is not a field of a resource');
  if (typeof b.name !== 'string' || !RESOURCE_NAME.test(b.name)) bad('name', `must match ${RESOURCE_NAME}`);
  if (!RESOURCE_SCOPES.includes(b.scope as never)) bad('scope', `must be one of ${RESOURCE_SCOPES.join(', ')} (R-BTN-76)`);
  if (b.detail_schema === undefined) bad('detail_schema', 'is required');
  return { name: b.name as string, scope: b.scope as (typeof RESOURCE_SCOPES)[number], detail_schema: b.detail_schema };
}

/** `POST /v1/admin/instances` (R-BTN-76): an account instance, what it serves and who may use it. */
export function checkInstance(body: unknown): { name: string; serves: string[]; repositories: string[] } {
  if (!isObj(body)) bad('body', 'must be a JSON object');
  const b = body as Record<string, unknown>;
  for (const k of Object.keys(b)) if (!['name', 'serves', 'repositories'].includes(k)) bad(`body.${k}`, 'is not a field of an instance');
  if (typeof b.name !== 'string' || !INSTANCE_NAME.test(b.name)) bad('name', 'must be an instance name');
  if (!Array.isArray(b.serves) || b.serves.length < 1 || b.serves.length > 64 || !b.serves.every((s) => typeof s === 'string' && RESOURCE_NAME.test(s))) bad('serves', 'must be 1 to 64 resource names');
  if (!Array.isArray(b.repositories) || b.repositories.length > 64) bad('repositories', 'must be a list of at most 64 repository ids');
  const repositories = (b.repositories as unknown[]).map((r, i) => checkRepositoryId(r, `repositories[${i}]`));
  return { name: b.name as string, serves: [...new Set(b.serves as string[])].sort(), repositories: [...new Set(repositories)].sort() };
}

/** `PUT /v1/admin/capacities` (R-BTN-178, §6.11): `{capability, capacity}` — the capability one
 *  expanded `<type>:<value>`, never a role (a role has no colon), a `credential:` or `runner:`
 *  capability, `<type>:*` or the bare `human-operator`; the capacity an integer 1–64, or null to
 *  clear. A capability with no capacity has unlimited seats. */
export function checkCapacity(body: unknown): { capability: string; capacity: number | null } {
  if (!isObj(body)) bad('body', 'must be a JSON object');
  const b = body as Record<string, unknown>;
  for (const k of Object.keys(b)) if (!['capability', 'capacity'].includes(k)) bad(`body.${k}`, 'is not a field of a capacity');
  const CAPABILITY_TYPE = /^[a-z][a-z0-9-]{0,31}$/;
  if (typeof b.capability !== 'string' || !b.capability.includes(':')) {
    bad('capability', 'must be one expanded <type>:<value> capability — a role or the bare human-operator names no thing to share (R-BTN-121, R-BTN-178)');
  }
  const colon = (b.capability as string).indexOf(':');
  const type = (b.capability as string).slice(0, colon);
  const value = (b.capability as string).slice(colon + 1);
  if (!CAPABILITY_TYPE.test(type)) bad('capability', `the type ${JSON.stringify(type)} must match ${CAPABILITY_TYPE}`);
  if (type === 'credential') bad('capability', 'a credential:<NAME> names a secret this runner alone receives, never a shared thing (R-BTN-144)');
  if (type === 'runner') bad('capability', 'a runner:<name> is per runner identity, never a shared thing (R-BTN-133)');
  if (!/^[^\s:*]{1,128}$/.test(value)) bad('capability', 'the value must be 1 to 128 characters, none of them whitespace, "*" or ":"');
  if (b.capacity === null) return { capability: b.capability as string, capacity: null };
  if (typeof b.capacity !== 'number' || !Number.isInteger(b.capacity) || b.capacity < 1 || b.capacity > 64) bad('capacity', 'must be an integer 1 to 64, or null to clear');
  return { capability: b.capability as string, capacity: b.capacity as number };
}

/** A blocks query's `on` (R-BTN-75): `<kind>:<ref>`, the ref an id, a name or `*`. */
export function checkBlockedOn(v: string): { kind: 'ticket' | 'capability' | 'resource' | 'decision'; ref: string } {
  const i = v.indexOf(':');
  const kind = i < 0 ? '' : v.slice(0, i);
  const ref = i < 0 ? '' : v.slice(i + 1);
  if (!['ticket', 'capability', 'resource', 'decision'].includes(kind)) bad('on', 'must be ticket:, resource:, capability: or decision: and a name');
  if (!(ref === '*' || /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,99}$/.test(ref))) bad('on', 'names a malformed ref');
  return { kind: kind as 'ticket', ref };
}

/** R-BTN-80, R-BTN-103: what one heartbeat's `couriers` or one courier registration may name
 *  (spec-silent, recorded on R3-1256); a claim takes at most 50 notices. */
export const COURIERS_MAX = 16;
export const ASKS_MAX = 8;
export const CLAIM_MAX = 50;
/** A courier's label for how it delivered (§10.4: text, short). */
const CHANNEL = /^[A-Za-z0-9][A-Za-z0-9 ._:@/-]{0,63}$/;

/** A heartbeat's `couriers` (R-BTN-103): `[{repository, asks: [<label>]}]`, absent for none. As
 *  with `transcripts`, a list that is not one, or is over its bound, refuses the heartbeat; an entry that
 *  fails its own check — a repository id, a label, a repeat — is returned refused and reported,
 *  never refusing the heartbeat, which would stop `last_seen_at` and get a live runner reaped. */
export function checkCouriers(v: unknown): { entries: { repository: string; asks: string[] }[]; refused: { repository: string; code: string }[] } {
  if (v === undefined) return { entries: [], refused: [] };
  if (!Array.isArray(v) || v.length > COURIERS_MAX) bad('couriers', `must be a list of at most ${COURIERS_MAX}`);
  const seen = new Set<string>();
  const entries: { repository: string; asks: string[] }[] = [];
  const refused: { repository: string; code: string }[] = [];
  for (const x of v as unknown[]) {
    const named = isObj(x) && typeof x.repository === 'string' ? x.repository.slice(0, 100) : '';
    try {
      if (!isObj(x)) bad('couriers[]', 'must be an object');
      const e = x as Record<string, unknown>;
      for (const k of Object.keys(e)) if (k !== 'repository' && k !== 'asks') bad(`couriers[].${k}`, 'unknown field');
      const repository = checkRepositoryId(e.repository, 'couriers[].repository');
      if (seen.has(repository)) bad('couriers[]', `repeats ${repository}`);
      entries.push({ repository, asks: checkAsks(e.asks, 'couriers[].asks') });
      seen.add(repository);
    } catch (err) {
      // Only a field check's refusal is an entry's; anything else is a bug and goes up.
      if (!(err instanceof BatonError) || err.code !== 'invalid-params') throw err;
      refused.push({ repository: named, code: 'invalid-params' });
    }
  }
  return { entries, refused };
}

/** §12.8 (B-145, R-BTN-180): the heartbeat's protection reports — `{repository, matched,
 *  reading_hash}` — malformed entries refused whole (a report a checker did not make is worth
 *  refusing, not parsing around). */
export function checkProtection(v: unknown): { repository: string; matched: boolean; reading_hash: string; legs?: { count: number; tickets: number } }[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 16) bad('protection', 'must be a list of at most 16 reports');
  return (v as unknown[]).map((x, i) => {
    if (!isObj(x)) bad(`protection[${i}]`, 'must be an object');
    const e = x as Record<string, unknown>;
    for (const k of Object.keys(e)) if (k !== 'repository' && k !== 'matched' && k !== 'reading_hash' && k !== 'legs') bad(`protection[${i}].${k}`, 'unknown field');
    if (typeof e.matched !== 'boolean') bad(`protection[${i}].matched`, 'must be true or false');
    if (typeof e.reading_hash !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(e.reading_hash)) bad(`protection[${i}].reading_hash`, 'must be a short reading hash');
    // §14 (R-BTN-190): the heartbeat protection entry's `legs` — what the checker's reading
    // covered, B-140's client sends it.
    let legs: { count: number; tickets: number } | undefined;
    if (e.legs !== undefined) {
      const l = isObj(e.legs) ? e.legs : bad(`protection[${i}].legs`, 'must be {count, tickets}');
      if (!Number.isSafeInteger(l.count) || (l.count as number) < 0 || !Number.isSafeInteger(l.tickets) || (l.tickets as number) < 0) {
        bad(`protection[${i}].legs`, 'count and tickets are non-negative integers');
      }
      for (const k of Object.keys(l)) if (k !== 'count' && k !== 'tickets') bad(`protection[${i}].legs.${k}`, 'unknown field');
      legs = { count: l.count as number, tickets: l.tickets as number };
    }
    return { repository: checkRepositoryId(e.repository, `protection[${i}].repository`), matched: e.matched as boolean, reading_hash: e.reading_hash as string, ...(legs ? { legs } : {}) };
  });
}

/** §12.8 (B-145, R-BTN-189): the heartbeat's policy pins — `{repository, hash, floors_hash?}`:
 * the whole policy document's hash, and the floors' when the runner pins it (R-BTN-189 says a
 * trusted runner pins both). */
export function checkPolicyPins(v: unknown): { repository: string; hash: string; floors_hash?: string }[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 64) bad('policy_pins', 'must be a list of at most 64 pins');
  return (v as unknown[]).map((x, i) => {
    if (!isObj(x)) bad(`policy_pins[${i}]`, 'must be an object');
    const e = x as Record<string, unknown>;
    for (const k of Object.keys(e)) if (k !== 'repository' && k !== 'hash' && k !== 'floors_hash') bad(`policy_pins[${i}].${k}`, 'unknown field');
    if (typeof e.hash !== 'string' || !/^[0-9a-f]{16,128}$/.test(e.hash)) bad(`policy_pins[${i}].hash`, 'must be the policy document’s SHA-256');
    if (e.floors_hash !== undefined && (typeof e.floors_hash !== 'string' || !/^[0-9a-f]{64}$/.test(e.floors_hash))) bad(`policy_pins[${i}].floors_hash`, 'must be the floors’ SHA-256');
    return { repository: checkRepositoryId(e.repository, `policy_pins[${i}].repository`), hash: e.hash as string, ...(e.floors_hash !== undefined ? { floors_hash: e.floors_hash as string } : {}) };
  });
}

/** A courier's `asks` (R-BTN-80): 1 to 8 labels, each `ASKS`. */
export function checkAsks(v: unknown, field = 'asks'): string[] {
  if (!Array.isArray(v) || !v.length || v.length > ASKS_MAX || !v.every((a) => typeof a === 'string' && ASKS.test(a))) {
    bad(field, `must be 1 to ${ASKS_MAX} labels, each matching ${ASKS}`);
  }
  return [...new Set(v as string[])].sort();
}

/** A mark's body (R-BTN-80): `{state: 'sent'|'failed', channel?}`. */
export function checkMark(v: unknown): { state: 'sent' | 'failed'; channel: string | null } {
  if (!isObj(v)) bad('body', 'must be a JSON object');
  const b = v as Record<string, unknown>;
  for (const k of Object.keys(b)) if (k !== 'state' && k !== 'channel') bad(`body.${k}`, 'unknown field');
  if (b.state !== 'sent' && b.state !== 'failed') bad('state', "must be 'sent' or 'failed'");
  if (b.channel !== undefined && !(typeof b.channel === 'string' && CHANNEL.test(b.channel))) bad('channel', 'must be a short label');
  return { state: b.state as 'sent' | 'failed', channel: (b.channel as string | undefined) ?? null };
}

/** A claim's body (R-BTN-80): `{limit?}`, at most 50; absent or empty takes 50. */
export function checkNoticeClaim(v: unknown): number {
  if (v == null) return CLAIM_MAX;
  if (!isObj(v)) bad('body', 'must be a JSON object');
  const b = v as Record<string, unknown>;
  for (const k of Object.keys(b)) if (k !== 'limit') bad(`body.${k}`, 'unknown field');
  if (b.limit === undefined) return CLAIM_MAX;
  if (!Number.isInteger(b.limit) || (b.limit as number) < 1 || (b.limit as number) > CLAIM_MAX) bad('limit', `must be an integer from 1 to ${CLAIM_MAX}`);
  return b.limit as number;
}
