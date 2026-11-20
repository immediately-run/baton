// types.ts — the shapes the Board, Tickets and ticket screens read (B-194's `repo.tickets`,
// B-218's `ticket.show`, and the reads the ticket's page gathers). Written loose on purpose:
// every field is a read's value and still untrusted — drawn through `Text`, never trusted for
// more than its type here.

export interface RunnerName {
  runner_id: number;
  hostname: string;
  session_name: string;
}

/** One ticket as `GET …/tickets` lists it. */
export interface TicketRow {
  ticket_id: string;
  title: string | null;
  course: string | null;
  tier: string | null;
  requires: string[];
  requires_unmet?: string[];
  tags?: string[];
  order?: string | null;
  parent?: string | null;
  expedite?: boolean;
  position: { station: string; path_len?: number; next_leg: string | null; next_source?: string | null } | null;
  state: string;
  reasons: string[];
  detail: Record<string, unknown>;
  eligible_runners?: RunnerName[];
  failed_rule?: string | null;
}

export interface TicketsAnswer {
  tickets: TicketRow[];
  next_cursor?: string;
  counts: Record<string, number>;
  matched?: number;
}

export interface Claim {
  claim_id: number;
  runner_id: number;
  hostname: string;
  session_name: string;
  leg: string | null;
  run_id: string | null;
  leg_started_at?: number | null;
  claimed_at: number;
  lease_ends_at: number | null;
  deadline_at: number | null;
  attempt: number;
  max_runs: number;
  next_backoff_until: number | null;
  session_url: string | null;
  log_dir: string | null;
  last_activity_at?: number | null;
  alive?: boolean;
  stalled?: boolean;
}

export interface Step {
  leg: string;
  reached: string;
}

/** `GET …/tickets/{ticket}`: B-126's fields and B-218's. */
export interface TicketShow extends TicketRow {
  repository: string;
  course_id?: string | null;
  path?: string | null;
  operator_only?: boolean;
  rank?: number | null;
  snapshot_sha?: string | null;
  children?: { ticket_id: string; station?: string | null; closed?: string }[];
  station?: { station: string; path: Step[]; next_leg: string | null; to_end?: number; handoff_url?: string } | null;
  last_written_by?: { pusher?: string; pusher_id?: unknown; commit?: string; at?: number; human?: boolean } | null;
  claim: Claim | null;
  attempts: { run: number; claim_id: number; runner_id: number; hostname: string; started_at: number; ended_at: number | null; end_reason: string | null; detail: string | null }[];
  overrides: { expedite: boolean; hold: { set_by: string | null; reason: string | null; since: number | null } | null };
  conditions: { condition_id: number; type: string; severity?: string; leg?: string; restarts?: string[] }[];
  scope: { id: number; kind: string; target: string; ref: string | null; at: number }[];
  fence: { claim_id: number; runner_id: number; hostname: string; since: number | null } | null;
  resume: { end_reason: string; ended_at: number; branches: string[]; prs: string[] } | null;
  web_url: string | null;
  allowed: string[];
}

export interface Block {
  kind: string;
  leg?: string;
  ref: string;
  since: number;
  until?: number;
}

export interface BlocksAnswer {
  blocked: boolean;
  since?: number;
  blocks: Block[];
  other: { kind: string; detail: unknown }[];
}

export interface HistoryRow {
  id: number;
  at: number;
  kind: string;
  claim_id?: number;
  runner_id?: number;
  leg?: string;
  reached?: string;
  next_leg?: string;
  run?: number;
  run_id?: string;
  snapshot_sha?: string;
  head_sha?: string;
  course_version?: number;
  leg_version?: number;
  detail?: unknown;
  inputs?: unknown;
}

export interface HistoryAnswer {
  rows: HistoryRow[];
  next_before?: number;
}

export interface ChildrenAnswer {
  children: { ticket_id: string; station: string | null; blocked: boolean; closed?: { as: string; closed_at: number } }[];
}

export interface LegRun {
  run: number;
  claim?: number;
  runner?: number;
  leg?: string;
  run_id?: string | null;
  from?: string;
  started_at?: number;
  ended_at?: number | null;
  end?: string | null;
  mode?: string;
  session_url?: string | null;
  log_dir?: string | null;
  transcripts?: { repo?: string; path?: string }[];
  inputs?: unknown[];
}

export interface RunsAnswer {
  runs: LegRun[];
}

export interface BoardAnswer {
  ready_by_tier?: Record<string, unknown[]>;
  granted_capabilities?: string[] | null;
}
