// types.ts — the runner reads' answers as the runner screens read them (B-196's shapes, as
// src/core/reads/runners.ts serves them; restated here so the bundle's types reach no core
// module that a host owns). Every field is still untrusted data.

/** How a claim ended, in the timeline's six words. */
export type ClaimEnd = 'running' | 'released' | 'silent' | 'reaped' | 'done' | 'suspended';

export interface RunnerClaim {
  claim_id: number;
  ticket_id: string;
  station: string;
  leg: string | null;
  run_id: string | null;
  claimed_at: number;
  lease_ends_at: number | null;
  deadline_at: number | null;
  attempt: number | null;
  max_runs: number | null;
  next_backoff_until: number | null;
  session_url: string | null;
  log_dir: string | null;
  activity: { kind: string; label: string | null; started_at: number } | null;
}

export interface RunnerRow {
  runner_id: number;
  hostname: string;
  session_name: string;
  alive: boolean;
  last_seen_at: number;
  last_activity_at: number | null;
  reaped_at: number | null;
  harness: string;
  kind: string;
  isolation: string;
  capabilities: { capability: string; declared: string }[];
  granted: string[] | null;
  tags: string[];
  courses: { course: string; version: number; min_runner_version: number | null }[];
  lease_timeout_s: number;
  credential: { kind: string; granted: boolean; role: string | null; domain: string | null };
  last_report: { payload: unknown; sent_at: number } | null;
  transcript_url: string | null;
  claim: RunnerClaim | null;
  claims: RunnerClaim[];
  busy_elsewhere: boolean;
  reaped_claim: { claim_id: number; ticket_id: string; ended_at: number | null; end_reason: string | null } | null;
}

export interface RunnersAnswer {
  runners: RunnerRow[];
  not_built?: Record<string, string>;
  server_time: number;
}

export interface WindowActivity {
  id: string;
  parent_id: string | null;
  kind: string;
  label: string | null;
  source: string;
  started_at: number;
  ended_at: number | null;
  outcome: string | null;
  detail: unknown;
}

export interface WindowRun {
  leg: string;
  run_id: string | null;
  started_at: number;
  ended_at: number | null;
  reached: string | null;
  session_url: string | null;
  log_dir: string | null;
}

export interface WindowClaim {
  claim_id: number;
  ticket_id: string;
  leg: string | null;
  started_at: number;
  ended_at: number | null;
  end: ClaimEnd | string;
  end_reason: string | null;
  detail: string | null;
  session_url: string | null;
  log_dir: string | null;
  runs: WindowRun[];
  activities: WindowActivity[];
}

export interface Attempt {
  run: number;
  claim_id: number;
  runner_id: number;
  run_id: string | null;
  started_at: number;
  ended_at: number | null;
  end: string | null;
  detail: string | null;
}

export interface RunnerAnswer {
  runner: RunnerRow & { profile: unknown };
  attempts: Attempt[];
  window: { since: number; until: number; claims: WindowClaim[] };
  not_built?: Record<string, string>;
  server_time: number;
}

/** A qualified ticket id's local part — what the ticket screen's URL takes. */
export const localOf = (ticketId: string): string => {
  const at = ticketId.indexOf(':');
  return at < 0 ? ticketId : ticketId.slice(at + 1);
};

/** `?since=` as the screens' URLs and the reads take it: a span such as `24h` or `7d`. */
export const SPAN = /^[1-9][0-9]{0,3}[hd]$/;
export const SPANS = ['24h', '3d', '7d'] as const;

/** The span the page's query names, or null: the read's default (24 hours). */
export function sinceOf(search: string): string | null {
  const raw = new URLSearchParams(search).get('since');
  return raw !== null && SPAN.test(raw) ? raw : null;
}

/** A window's length in words: hours up to two days, days beyond. */
export function windowWords(ms: number): string {
  const hours = Math.round(ms / 3_600_000);
  return hours <= 48 ? `${hours} h` : `${Math.round(hours / 24)} d`;
}
