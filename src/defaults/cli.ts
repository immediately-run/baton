// The checkout's repo command bundle entry. Implementations live with their own concerns.
export { initMain, prebuildDefaults, syncWorkflow } from './init';
export { BUSY_RETRY_S, courseSchemas, migrateMarkersMain, parseSyncArgs, syncMain, verifyConfigMain, type ResolvedDep, type SyncArgs } from './sync';
export { githubFacts, plainGitRemote } from './facts';
export { ownRepositoryId, remoteSlug } from './remote-slug';
