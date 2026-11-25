// types.ts — `course.show`'s and `repo.courses`' answers as the Courses screens read them
// (B-197's shapes). Every field is untrusted data: the course file most of all — an opaque
// blob whose names are drawn as text and whose shape `fileLeg` reads defensively.

export interface LegState {
  ready: number;
  running: number;
  waiting: number;
  backing_off: number;
  blocked: { kind: string; found: 'before' | 'during' | string; count: number; tickets?: string[] }[];
}

export interface LegRun {
  run: number;
  claim: number;
  leg: string;
  run_id: string | null;
  ticket_id: string;
  runner: number;
  hostname: string | null;
  session_name: string | null;
  from: string;
  reached: string | null;
  started_at: number;
  ended_at: number | null;
  outcome: string;
  end: string | null;
  claim_end: string;
  detail: string | null;
  session_url: string | null;
  log_dir: string | null;
  transcripts: { repo: string; path: string; role: string }[];
}

export interface CourseLeg {
  leg: string;
  from: string[];
  to: string[];
  queue: { depth: number; max_queue: number | null; over: boolean; intake: string | null };
  state: LegState;
  window: { started: number; finished: number; abandoned: number; wait_p50_s: number | null; run_p50_s: number | null; fail_rate: number | null } | null;
  runs?: LegRun[];
}

export interface CourseStation {
  station: string;
  start: boolean;
  end: boolean;
  resting: number;
  claimed: number;
  arrived_today: number;
}

export interface CourseTicket {
  ticket_id: string;
  title: string | null;
  station: string;
  path: { leg: string; reached: string }[];
  claim_legs: { claim_id: number; leg: string; run_id: string | null; from: string; reached: string | null; started_at: number; outcome: string }[];
  waits_for: { leg: string; on: string | null; since: number | null } | null;
  handoff: string | null;
  blocks: { leg: string; kind: string; ref: string; since: number; until: number | null }[];
  backing_off_until: number | null;
  next_leg: string | null;
  source: string | null;
  parent: string | null;
  children: string[];
}

export interface Durations { count: number; median_s: number | null; max_s: number | null }

export interface CourseAnswer {
  course: { id: string; version: number | null; file: unknown; skill: string | null; min_runner_version: number | null };
  refused: { version: number; reason: string; refused_at?: number } | null;
  runners: { declaring: number; alive: number };
  intake: string | null;
  legs: CourseLeg[];
  stations: CourseStation[];
  counts: { tickets: number };
  window: { since: number; until: number };
  stats: {
    course: {
      legs: Record<string, { started: number; finished: number; abandoned: number; waited: Durations; ran: Durations; ready_now: { tickets: number; oldest_s: number | null }; queue: { depth: number; max_queue: number | null } }>;
      stations: Record<string, { waited: Durations }>;
      intake: string;
    } | null;
    ends: { end_reason: string; detail: string | null; claims: number }[];
    suspensions: { station: string; detail: string | null; claims: number }[];
    advice_overridden: { count: number; tickets: string[] };
  };
  off_graph: { count: number; tickets: string[] };
  tickets?: CourseTicket[];
  next_cursor?: string;
  runs_truncated?: boolean;
  summary?: boolean;
  server_time: number;
}

export interface CoursesAnswer { courses: { id: string; version: number | null }[] }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** What the screens draw of one leg's entry in the course file, read defensively. */
export interface FileLeg { kind: string | null; requires: string[]; maxRuns: number | null; maxQueue: number | null; timeoutS: number | null; outputs: string[] }

export function fileLeg(file: unknown, leg: string): FileLeg {
  const legs = isObj(file) && isObj(file.legs) ? file.legs : {};
  const def = isObj(legs[leg]) ? legs[leg] : {};
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const outputs = Array.isArray(def.outputs)
    ? def.outputs.map((o) => (typeof o === 'string' ? o : isObj(o) && typeof o.name === 'string' ? o.name : isObj(o) && typeof o.output === 'string' ? o.output : null)).filter((o): o is string => o !== null)
    : isObj(def.outputs) ? Object.keys(def.outputs) : [];
  return {
    kind: typeof def.kind === 'string' ? def.kind : null,
    requires: isObj(def.requires) ? strings(def.requires.capabilities) : [],
    maxRuns: num(def.max_runs), maxQueue: num(def.max_queue),
    timeoutS: num(def.max_duration) ?? num(def.timeout) ?? num(def.deadline_s),
    outputs,
  };
}

/** A qualified ticket id's local part — what the ticket screen's URL takes. */
export const localOf = (ticketId: string): string => {
  const at = ticketId.indexOf(':');
  return at < 0 ? ticketId : ticketId.slice(at + 1);
};

/** Seconds from a read as the mockup words a span; an em dash for none. */
export function seconds(s: number | null | undefined): string {
  if (typeof s !== 'number' || !Number.isFinite(s)) return '—';
  if (s < 60) return `${Math.round(s)} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86_400) return `${Math.round(s / 360) / 10} h`;
  return `${Math.round(s / 8640) / 10} d`;
}

export const percent = (rate: number | null | undefined): string => (typeof rate === 'number' && Number.isFinite(rate) ? `${Math.round(rate * 100)} %` : '—');
