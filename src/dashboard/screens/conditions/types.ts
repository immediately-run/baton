// types.ts — the shapes the Conditions screens read (B-195's reads, `src/core/reads/
// conditions.ts`). Every field is still untrusted data: drawn through `Text`, `ExtLink` or
// `View`, never trusted for more than its shape.

/** One condition, as `repo.needs-you`, `condition.list` and `condition.show` answer it. */
export interface Condition {
  condition_id: number;
  ticket_id: string;
  leg: string;
  run_id?: string;
  type: string;
  disposition: string;
  severity: string;
  raised_at: number;
  url: string | null;
  restarts: Record<string, string> | null;
  default: string | null;
  outcome?: string | null;
  closed_at?: number | null;
  closed_how?: string | null;
  resolve_url?: string;
  allowed?: string[];
}

/** `condition.show`: the condition with its ticket's position and what waits on its ticket. */
export interface ConditionShown extends Condition {
  repository: string;
  claim_id?: number;
  ticket: { ticket_id: string; title?: string; course_id?: string; station?: string | null; next_leg?: string | null } | null;
  unblocks: string[];
  not_built?: Record<string, string>;
}

/** A queued person leg with its question (R-BTN-116) and whether the caller may answer it. */
export interface Question {
  ticket_id: string;
  leg: string;
  asks: string | null;
  title?: string;
  question_id: string | null;
  url: string | null;
  severity: string | null;
  options: { id: string; reached: string; action?: string }[];
  expires_at?: number;
  answerable: boolean;
  why: string | null;
  human_only: boolean;
}

/** One row of a listing that is not a condition yet (B-57): whatever its module answers. */
export type ListingRow = Record<string, unknown>;

/** `repo.needs-you`. */
export interface NeedsYou {
  repository: string;
  conditions: Condition[];
  questions: Question[];
  retry_decisions?: { ticket_id: string; station: string | null; opened_at: number | null }[];
  listings: Record<string, ListingRow[]>;
  held_posts: number;
  elsewhere: string[];
  not_built?: Record<string, string>;
  server_time?: number;
}

/** `condition.list`: the list, open and closed, by id. */
export interface ConditionsPage {
  conditions: Condition[];
  cursor: string | null;
}
