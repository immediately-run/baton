// The numbered schema migrations, applied in order before the object serves (BATON_SPEC §3).
// A migration is never edited once merged: a change is a new file and a new entry here.
import init from './0001_init.sql';
import workers from './0002_workers.sql';
import claims from './0003_claims.sql';
import cutover from './0004_cutover.sql';
import tickets from './0005_tickets.sql';
import repositories from './0006_repositories.sql';
import courses from './0007_courses.sql';
import observations from './0008_observations.sql';
import tiers from './0009_tiers.sql';
import keys from './0010_keys.sql';
import webhooks from './0011_webhooks.sql';
import forges from './0012_forges.sql';
import stations from './0013_stations.sql';
import admin from './0014_admin.sql';
import claimReady from './0015_claim_ready.sql';
import blocks from './0016_blocks.sql';
import notices from './0017_notices.sql';
import history from './0018_history.sql';
import independence from './0019_independence.sql';
import schemas from './0020_schemas.sql';
import legQueues from './0021_leg_queues.sql';
import legCapabilities from './0022_leg_capabilities.sql';
import webhookSyncs from './0023_webhook_syncs.sql';
import windDown from './0024_wind_down.sql';
import ontology from './0025_ontology.sql';
import stationWrites from './0026_station_writes.sql';
import routeChoices from './0027_route_choices.sql';
import repositoryPolicies from './0029_repository_policies.sql';
import capacitySeats from './0030_capacity_seats.sql';
import personLegs from './0031_person_legs.sql';
import answerDeferred from './0032_answer_deferred.sql';
import ownerRuns from './0033_owner_runs.sql';
import scopeAudit from './0034_scope_audit.sql';
import scopeEvents from './0035_scope_events.sql';
import retireModelTables from './0036_retire_model_tables.sql';
import ticketVersions from './0037_ticket_versions.sql';
import runIds from './0038_run_ids.sql';
import crossHostCodeRepos from './0039_cross_host_code_repos.sql';
import signedControl from './0040_signed_control.sql';
import claimControl from './0041_claim_control.sql';
import retireOntology from './0042_retire_ontology.sql';
import part4Resources from './0043_part4_resources.sql';
import part4Settings from './0044_part4_settings.sql';
import checkConclusions from './0045_check_conclusions.sql';
import ticketProvenance from './0046_ticket_provenance.sql';
import legRunInputs from './0047_leg_run_inputs.sql';
import conditions from './0048_conditions.sql';
import coreConditions from './0075_core_conditions.sql';
import retireReviewerSettings from './0076_retire_reviewer_settings.sql';
import legTimeoutFence from './0082_leg_timeout_fence.sql';
import eventLookups from './0049_event_lookups.sql';
import alarmIndexes from './0052_alarm_indexes.sql';
import retention from './0053_retention.sql';
import retirement from './0050_retirement.sql';
import instanceSettings from './0051_instance_settings.sql';
import stateVersion from './0054_state_version.sql';
import dashboardLookups from './0055_dashboard_lookups.sql';
import workerProfile from './0056_worker_profile.sql';
import severalClaims from './0057_several_claims.sql';
import clientVersions from './0058_client_versions.sql';
import sequences from './0059_sequences.sql';
import runners from './0061_runners.sql';
import dependencyConsents from './0062_dependency_consents.sql';
import runnersViewReads from './0063_runners_view_reads.sql';
import childrenOwnerState from './0064_children_owner_state.sql';
import readEfficiency from './0065_read_efficiency.sql';
import legContracts from './0100_leg_contracts.sql';
import pinnedContracts from './0101_pinned_contracts.sql';
import runnerViews from './0066_runner_views.sql';
import leaseRecovery from './0123_lease_recovery.sql';
import retirePolicyPins from './0070_retire_policy_pins.sql';
import accessSignIn from './0071_access_sign_in.sql';
import sessionLinkSecrets from './0079_session_link_secrets.sql';
import interactionDeliveryGrant from './0080_interaction_delivery_grant.sql';
import sessionLinkIncarnation from './0081_session_link_incarnation.sql';
import conditionRecords from './0085_condition_records.sql';
import ticketPrerequisites from './0102_ticket_prerequisites.sql';
import prerequisiteIdentityAndReady from './0103_prerequisite_identity_and_ready.sql';
import runnerIdle from './0121_runner_idle.sql';
import runnerIdleRepositories from './0122_runner_idle_repositories.sql';
import { isUniqueViolation, logEvent, mintRunId, type Random } from '../core/db';
import type { Store } from '../core/ports';

/** A migration: its SQL, and — when a step needs what SQL lacks, as a ULID needs the core's
 *  random source — a `backfill` run in the same transaction: after the SQL, or before it when
 *  the SQL drops the rows it reads (`first`). */
export interface Migration {
  id: number;
  sql: string;
  backfill?: (store: Store, random: Random, now: () => number) => void;
  first?: boolean;
}

/** 0038 (B-185, R-BTN-63): runs recorded before run ids get one, minted from each run's
 *  `started_at` as an advance mints one; a collision is refused by the unique index and retried. */
function backfillRunIds(store: Store, random: Random) {
  const rows = store.exec<{ id: number; started_at: number }>('SELECT id, started_at FROM claim_legs WHERE run_id IS NULL ORDER BY id').toArray();
  for (const r of rows) {
    for (let tries = 0; ; tries++) {
      try {
        store.exec('UPDATE claim_legs SET run_id = ? WHERE id = ?', mintRunId(r.started_at, random), r.id);
        break;
      } catch (e) {
        if (!isUniqueViolation(e) || tries >= 8) throw e;
      }
    }
  }
}

/** 0043 (B-168, R-BTN-76): each `worker`-scope resource and each implicit instance the migration
 *  drops is logged as an `admin` event naming what it was — the same act an administrator's own
 *  registration logs — read before its SQL drops them (`first`). */
function backfillPart4Resources(store: Store, _random: Random, now: () => number) {
  const rows = store.exec<{ name: string; kind: 'resource' | 'instance' }>(
    `SELECT name, 'resource' AS kind FROM external_resources WHERE scope = 'worker'
     UNION
     SELECT DISTINCT instance, 'instance' FROM instance_serves WHERE instance LIKE '%@worker:%'
     UNION
     SELECT DISTINCT instance, 'instance' FROM instance_readings WHERE instance LIKE '%@worker:%'
     UNION
     SELECT DISTINCT instance, 'instance' FROM instance_states WHERE instance LIKE '%@worker:%'
     ORDER BY kind, name`).toArray();
  for (const r of rows) logEvent(store, now(), 'admin', 'migration:0043', { act: 'resource-dropped', kind: r.kind, name: r.name }, null, null, null);
}

export const MIGRATIONS: Migration[] = [
  { id: 1, sql: init },
  { id: 2, sql: workers },
  { id: 3, sql: claims },
  { id: 4, sql: cutover },
  { id: 5, sql: tickets },
  { id: 6, sql: repositories },
  { id: 7, sql: courses },
  { id: 8, sql: observations },
  { id: 9, sql: tiers },
  { id: 10, sql: keys },
  { id: 11, sql: webhooks },
  { id: 12, sql: forges },
  { id: 13, sql: stations },
  { id: 14, sql: admin },
  { id: 15, sql: claimReady },
  { id: 16, sql: blocks },
  { id: 17, sql: notices },
  { id: 18, sql: history },
  { id: 19, sql: independence },
  { id: 20, sql: schemas },
  { id: 21, sql: legQueues },
  { id: 22, sql: legCapabilities },
  { id: 23, sql: webhookSyncs },
  { id: 24, sql: windDown },
  { id: 25, sql: ontology },
  { id: 26, sql: stationWrites },
  { id: 27, sql: routeChoices },
  { id: 29, sql: repositoryPolicies },
  { id: 30, sql: capacitySeats },
  { id: 31, sql: personLegs },
  { id: 32, sql: answerDeferred },
  // 0033 is B-110's (owner runs), renumbered at the merge behind B-7's 0031/0032; 0028 was reserved for B-107 (#149), closed as superseded — it stays unused.
  { id: 33, sql: ownerRuns },
  { id: 34, sql: scopeAudit },
  { id: 35, sql: scopeEvents },
  { id: 36, sql: retireModelTables },
  { id: 37, sql: ticketVersions },
  { id: 38, sql: runIds, backfill: backfillRunIds },
  // 0039 (B-182): code repositories name their own forge and host, and pushers are host-qualified.
  { id: 39, sql: crossHostCodeRepos },
  // 0040 is B-127's (owner-signed control inputs), renumbered at the merge behind main's 0034–0039.
  { id: 40, sql: signedControl },
  // 0041 is B-127's review round 2 (the claim's own control record).
  { id: 41, sql: claimControl },
  // 0042 is B-167's (the ontology and route choices leave core), renumbered at the merge behind main's 0039–0041.
  { id: 42, sql: retireOntology },
  // 0043 and 0044 are B-168's (the restructure's part 4: resources, readings, owner settings),
  // renumbered at the merge behind main's 0039–0042.
  { id: 43, sql: part4Resources, backfill: backfillPart4Resources, first: true },
  { id: 44, sql: part4Settings },
  // 0045 is B-169's (the owners' `checks` map), renumbered at the merge behind B-168's 0043–0044.
  { id: 45, sql: checkConclusions },
  // 0046 is B-126's (ticket provenance), numbered behind B-169's 0045.
  { id: 46, sql: ticketProvenance },
  // 0047 is B-190's (replay: each run's inputs, the ticket's version among them).
  { id: 47, sql: legRunInputs },
  // 0048 is B-234's (R-BTN-195: raised conditions, and R-BTN-90's armed claim deadline).
  { id: 48, sql: conditions },
  // 0049 is B-235's (the dashboard's event lookups by kind and time; 0040's lost `events_unsigned_control`).
  { id: 49, sql: eventLookups },
  // 0050 is B-173's (a repository's retirement: the tombstone's `former_paths`), renumbered at
  // the merge behind main's 0043–0049.
  { id: 50, sql: retirement },
  // 0051 is B-4's (R-BTN-113, §13.1: the administrators' instance settings), renumbered at the merge behind 0049–0050.
  { id: 51, sql: instanceSettings },
  // 0052 is B-236's (the alarm's and the runner calls' indexes), 0053 B-238's (R-BTN-149's
  // retention); their queries also search 0055's claim and transcript indexes.
  { id: 52, sql: alarmIndexes },
  { id: 53, sql: retention },
  // 0054 is B-237's (the state version, R-BTN-196); 0052–0053 are reserved for other branches.
  { id: 54, sql: stateVersion },
  // 0055 is B-240's (the dashboard's claim, transcript and waiting-leg lookups; 0049–0054 are other branches').
  { id: 55, sql: dashboardLookups },
  // 0056 is B-253's (the runner's opaque profile, §13.3's `profile_json`; R-BTN-72's `cli` key).
  { id: 56, sql: workerProfile },
  // 0057 is B-188's (0056 is B-253's) (R-BTN-4: several claims per runner; `concurrency` and the grant's `max_claims`).
  { id: 57, sql: severalClaims },
  // 0058 is B-254's (R-BTN-197: the recommended client an administrator may raise, and each
  // runner's own statement of its version), renumbered at the merge behind B-188's 0057.
  { id: 58, sql: clientVersions },
  // 0059 is B-176's (the per-repository, per-kind sequences, and the `sequence` event kind),
  // renumbered at the merge behind main's 0048–0058, its events CHECK the union with B-234's.
  { id: 59, sql: sequences },
  // 0061 is B-68's implementation-wide worker → runner migration; 0060 belongs to B-259.
  { id: 61, sql: runners },
  // 0062 is B-113's (R-BTN-47's relations rule relaxed for `depends_on`: the target repository's
  // owners' consent to a less visible dependent, and the `dependency-consent` event), renumbered
  // at the merge behind main's 0061.
  { id: 62, sql: dependencyConsents },
  // 0063 is B-250's (the Runners view's own order and its status-report read), written as 0060
  // over the `workers` names and renumbered at the merge behind 0061's rename and B-113's 0062.
  { id: 63, sql: runnersViewReads },
  // 0064 is R3-1258's (§4.6 children, §4.8 owner state: `tickets.parent`, `pending_owner_state`,
  // the `spawned_children` a `spawned` end reports, and the `capacity`, `parent-invalid`,
  // `frozen`, `unfrozen`, `sealed`, `imported` event kinds).
  { id: 64, sql: childrenOwnerState },
  { id: 65, sql: readEfficiency },
  { id: 66, sql: runnerViews },
  { id: 70, sql: retirePolicyPins },
  { id: 71, sql: accessSignIn },
  { id: 75, sql: coreConditions },
  { id: 76, sql: retireReviewerSettings },
  { id: 79, sql: sessionLinkSecrets },
  { id: 80, sql: interactionDeliveryGrant },
  { id: 81, sql: sessionLinkIncarnation },
  { id: 82, sql: legTimeoutFence },
  { id: 85, sql: conditionRecords },
  { id: 100, sql: legContracts },
  { id: 101, sql: pinnedContracts },
  { id: 102, sql: ticketPrerequisites },
  { id: 103, sql: prerequisiteIdentityAndReady },
  { id: 121, sql: runnerIdle },
  { id: 122, sql: runnerIdleRepositories },
  { id: 123, sql: leaseRecovery },
];
