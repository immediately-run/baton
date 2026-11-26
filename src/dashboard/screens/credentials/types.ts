// types.ts — the answers the credential, governance and tenant screens read. Shapes only, and
// every field is optional in spirit: a read is untrusted data, drawn through `Text` whatever it
// holds, and a field an older server leaves out is drawn as "—" or an empty list. They restate
// what `src/core/reads/credentials.ts` and `src/core/reads/tenant.ts` answer; nothing of the
// core is imported here, even as a type — those modules reach the store's own, which the
// dashboard's build does not know.

/** An owner key (`owner.grant.list`'s `owners[]`). */
export interface OwnerRow {
  repository_id?: string;
  fingerprint: string;
  added_by?: string;
  added_at?: number;
  kind?: string;
  human_only?: boolean;
}

/** A sync key (R-BTN-93). */
export interface SyncKeyRow { fingerprint: string; role?: string; added_by?: string; added_at?: number }

/** §3.1 (B-113): the repository's owners' consent to `repository`'s tickets depending on its own. */
export interface DependencyConsentRow { repository: string; granted_by?: string; granted_at?: number }

/** A reading in force on an instance (R-BTN-76, R-BTN-101). */
export interface ReadingRow {
  source?: string;
  writer?: string | null;
  kind?: string;
  available?: boolean | null;
  until?: number | null;
  observed_at?: number;
  lapses_at?: number;
  detail?: unknown;
  stale?: boolean;
}

/** An instance as `admin.instance.list` lists it. */
export interface InstanceRow {
  name: string;
  repositories?: string[];
  serves?: string[];
  state: string;
  until?: number | null;
  readings?: ReadingRow[];
}

/** A grant in force (R-BTN-146), as `owner.grant.list` lists it. */
export interface GrantRow {
  credential_id: string;
  hostname?: string | null;
  label?: string | null;
  capabilities?: unknown;
  max_claims?: number | null;
  granted_by?: string | null;
  granted_at?: number | null;
  other_repositories?: string[];
  role?: string | null;
  domain?: string | null;
  set_by?: string | null;
}

/** An owner bar in force or scheduled (R-BTN-67). */
export interface BarRow {
  id: number;
  course?: string;
  tag?: string;
  legs?: string[];
  applies?: string;
  starts_at?: number | null;
  ends_at?: number | null;
  release_holders?: boolean;
  reason?: string;
  set_by?: string | null;
}

/** `GET /v1/owner/{repository}/grants`. */
export interface GrantsAnswer {
  repository?: string;
  owners?: OwnerRow[];
  sync_keys?: SyncKeyRow[];
  dependency_consents?: DependencyConsentRow[];
  grants?: GrantRow[];
  settings?: Record<string, unknown> | null;
  bars?: BarRow[];
  not_built?: Record<string, string>;
  server_time?: number;
}

/** `GET /v1/repositories/{repository}/policy` (R-BTN-188, R-BTN-189). */
export interface PolicyAnswer {
  repository?: string;
  version?: number;
  hash?: string;
  policy?: unknown;
  guarantees?: Record<string, boolean>;
  floors?: { name: string; guarantees?: string[]; remove_by?: string; added_by?: string; added_at?: number }[];
  at?: number;
}

/** `GET /v1/owner/{repository}/policy/log`. */
export interface PolicyLogAnswer {
  versions?: { version: number; hash?: string; previous_hash?: string | null; changed_by?: string; approver?: string | null; preset?: string | null; at?: number; changed?: unknown[] }[];
}

/** `GET /v1/admin/repositories` (`admin.repo.list`). */
export interface RegistryAnswer {
  repositories?: RegistryRow[];
  seed_owners?: string[];
}
export interface RegistryRow {
  id: string;
  github?: string | null;
  forge?: string | null;
  web_base?: string | null;
  default_branch?: string | null;
  weight?: number;
  head?: { sha?: string; received_at?: number | null } | null;
  /** `{mode: 'shadow' | 'cut-over'}` as the registry's rows carry it. */
  mode?: { mode?: string } | string;
  courses?: { id: string; version?: unknown }[];
  sync_keys?: { fingerprint: string; role?: string }[];
  ci_identity?: unknown;
  retired_at?: number | null;
}

/** `GET /v1/admin/instances` (`admin.instance.list`). */
export interface InstancesAnswer {
  instances?: InstanceRow[];
}

/** `GET /v1/admin/resources` (`admin.resource.list`). */
export interface ResourcesAnswer {
  resources?: { name: string; scope?: string; detail_schema?: unknown; instances?: string[] }[];
  probes?: { fingerprint: string; label?: string | null; instances?: unknown; added_by?: string | null }[];
}

/** `GET /v1/admin/capacities` (`admin.capacity.list`). */
export interface CapacitiesAnswer {
  capacities?: { capability: string; capacity?: number; set_by?: string; set_at?: number; held?: number; holders?: { claim_id: number; ticket_id?: string; runner_id?: number }[] }[];
}

/** `GET /v1/admin/settings` (`admin.settings.show`). */
export interface InstanceSettingsAnswer {
  link_hosts?: string[];
  session_hosts?: string[];
  check_app_id?: string | null;
  recommended_client?: string;
}

/** `GET /v1/admin/tenant` (`admin.tenant`). */
export interface TenantAnswer {
  envelope?: Record<string, number>;
  figures?: { figure: string; value?: number; envelope?: number; ratio?: number; over?: boolean }[];
  day?: { day?: string; requests?: number; rows_written?: number; limits?: { requests?: number; rows_written?: number } };
  live_claims?: number;
  frozen_at?: number | null;
  sealed_at?: number | null;
  needs_you?: {
    keys?: { refused?: string; revoked_listed?: string[] } | null;
    capacity?: { figure: string; value?: number; envelope?: number }[];
    /** An instance `unknown` a day while a posted leg needs what it serves. */
    instances_unknown?: { instance: string; since?: number }[];
    /** A live runner whose client is below the recommended one. */
    stale_clients?: { hostname: string; session_name: string; client_version: string; recommended: string }[];
    /** A live runner declaring no course at all. */
    stale_skills_no_course?: { id: number; hostname: string; session_name: string }[];
  };
  not_built?: Record<string, string>;
}

/** `GET /v1/admin/sessions` (`admin.session.list`). */
export interface SessionsAnswer {
  sessions?: { role?: string; key_fingerprint?: string; created_at?: number; expires_at?: number; current?: boolean }[];
  not_built?: Record<string, string>;
}
