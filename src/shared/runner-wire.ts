// Successful replies on the runner wire (§11). Opaque or extensible data still needs
// validation where it is consumed; these types do not validate JSON.
import type { LastWrittenBy } from '../core/provenance';

import type { ResolvedInput } from '../core/contracts';
import type { PointerReach } from '../core/contractPointers';

export type NextLegs = { leg: string; state: string; waiting_on?: string }[];

export interface ClaimAnswer {
  claim_id: number;
  ticket_id: string;
  course_id?: string | null;
  course_version?: number | null;
  station: string;
  legs: string[];
  next?: NextLegs;
  path?: string | null;
  nonce: string;
  snapshot_sha: string;
  version?: string;
  ticket_source?: { kind: string; versions: string | null } | null;
  leg_state?: 'forge' | 'branch';
  scope?: string[];
  /** B-39: where the leg's declared pointers may reach (R-BTN-109). */
  pointer_reach?: PointerReach;
  brief?: { signed: boolean; signer?: string; commit: string };
  /** B-311: a reconcile leg's displaced leg and the evidence Baton captured for it. */
  displaced?: string;
  evidence?: { ref: string; kind: string }[];
  last_written_by?: LastWrittenBy;
  default_branch?: string;
  handoff_url?: string;
  control?: { required: boolean; keys: string[]; register_moved?: boolean; [group: string]: unknown };
  advice?: unknown;
  previous_attempts?: {
    claim_id: number;
    status: string;
    end_reason: string | null;
    detail: string | null;
    ended_at: number | null;
    resume: unknown;
    legs: { leg: string; run_id?: string; from: string; reached: string | null; outcome: string }[];
  }[];
}

export interface BeatClaim {
  id: number;
  ticket_id: string;
  nonce: string;
  claimed_at: number;
  station?: string;
  leg?: string;
  deadline_at?: number;
  git?: unknown;
  activity?: { id: string; kind: string; label: string | null; started_at: number; claim_id: number | null } | null;
}

export interface BeatMessage {
  id: number;
  kind: string;
  payload?: {
    reason?: string;
    ticket_id?: string;
    tickets?: { ticket_id: string; cleared: { kind: string; ref: string; leg?: string }[] }[];
  } | null;
  sent_at: number;
}

export interface BeatAnswer {
  runner_id: number;
  worker_id?: number;
  incarnation: number;
  lease_timeout_s?: number;
  grant?: { capabilities: string[] };
  claims?: BeatClaim[]; // Older servers return only `claim`.
  claim?: BeatClaim | null;
  messages: BeatMessage[];
  bars: unknown[];
  stale_courses: { repository: string; course: string; version: number | null; min_runner_version: number | null }[];
  mode: Record<string, 'shadow' | 'cut-over'>;
  server_time: number;
  reports_refused?: number[];
  tier_ceilings_unregistered?: string[];
  courses_retired?: string[];
  protection_refused?: { repository: string; code: string }[];
  session_url_dropped?: string;
  transcripts_refused?: { index: number; code: string; message: string }[];
  transcripts_unlinked?: number[];
  refused_couriers?: { repository: string; code: string }[];
}

export interface AdvanceAnswer {
  ok: true;
  station?: string;
  next?: NextLegs;
  run_id?: string;
  seq?: number;
  /** B-335 (R-BTN-63): the run's number of its leg, this one included. */
  run?: number;
  /** B-39: the leg's resolved inputs (R-BTN-109). */
  inputs?: ResolvedInput[];
  session_url_dropped?: string;
  advice?: unknown;
}
