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
import retireOntology from './0039_retire_ontology.sql';
import { isUniqueViolation, mintRunId, type Random } from '../core/db';
import type { Store } from '../core/ports';

/** A migration: its SQL, and — when a step needs what SQL lacks, as a ULID needs the core's
 *  random source — a `backfill` run after the SQL in the same transaction. */
export interface Migration {
  id: number;
  sql: string;
  backfill?: (store: Store, random: Random) => void;
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
  // 0033 is B-110's (owner runs), renumbered at the merge behind B-7's 0031/0032; 0028 stays reserved for B-107 (#149).
  { id: 33, sql: ownerRuns },
  { id: 34, sql: scopeAudit },
  { id: 35, sql: scopeEvents },
  { id: 36, sql: retireModelTables },
  { id: 37, sql: ticketVersions },
  { id: 38, sql: runIds, backfill: backfillRunIds },
  { id: 39, sql: retireOntology },
];
