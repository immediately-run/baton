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

export const MIGRATIONS: { id: number; sql: string }[] = [
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
  // 0028 is B-107's (provider-advisory retirement), merging ahead of this: this branch numbers
  // its migration 0029, and 28 stays free for it.
  { id: 29, sql: repositoryPolicies },
];
