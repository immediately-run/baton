// index.ts — the screens that are built: ONE LINE PER SCREEN, exporting the screen's component
// under its id in `src/core/screens.ts` (the router reads this module's exports by that id; a
// screen with no line here draws "not built yet"). To add a screen, add its line — nothing else
// in the shell changes:
//
//   export { BoardScreen as 'repository/board' } from './board/BoardScreen';
//
// Keep the lines in `screens.ts`'s order. The component's props are `ScreenProps`
// (./contract.ts); the contract is README.md beside this file.
export { RootScreen as 'root' } from './root/RootScreen';
export { BoardScreen as 'repository/board' } from './board/BoardScreen';
export { TicketsScreen as 'repository/tickets' } from './tickets/TicketsScreen';
export { TicketPage as 'repository/tickets/{ticket}' } from './tickets/TicketPage';
export { GoalsScreen as 'repository/goals' } from './goals/GoalsScreen';
export { CoursesScreen as 'repository/courses' } from './courses/CoursesScreen';
export { CoursePage as 'repository/courses/{course}' } from './courses/CoursePage';
export { RunnersScreen as 'repository/runners' } from './runners/RunnersScreen';
export { RunnerScreen as 'repository/runners/{runner}' } from './runners/RunnerScreen';
export { GrantsScreen as 'repository/grants' } from './credentials/CredentialScreens';
export { OwnersScreen as 'repository/owners' } from './credentials/CredentialScreens';
export { TokensScreen as 'repository/tokens' } from './credentials/CredentialScreens';
export { McpKeysScreen as 'repository/mcp-keys' } from './credentials/CredentialScreens';
export { SyncKeysScreen as 'repository/sync-keys' } from './credentials/CredentialScreens';
export { CheckRunnersScreen as 'repository/check-runners' } from './credentials/CredentialScreens';
export { PolicyScreen as 'repository/policy' } from './governance/GovernanceScreens';
export { SettingsScreen as 'repository/settings' } from './governance/GovernanceScreens';
export { BarsScreen as 'repository/bars' } from './governance/GovernanceScreens';
export { ConsentsScreen as 'repository/consents' } from './governance/GovernanceScreens';
export { ConditionsScreen as 'repository/conditions' } from './conditions/ConditionsScreen';
export { ConditionScreen as 'repository/conditions/{condition}' } from './conditions/ConditionScreen';
export { AttestationsScreen as 'repository/attestations' } from './attestations/AttestationsScreen';
export { SyncScreen as 'repository/sync' } from './sync/SyncScreen';
export { RegistryScreen as 'tenant/repositories' } from './tenant/TenantScreens';
export { InstancesScreen as 'tenant/instances' } from './tenant/TenantScreens';
export { ResourcesScreen as 'tenant/resources' } from './tenant/TenantScreens';
export { CapacitiesScreen as 'tenant/capacities' } from './tenant/TenantScreens';
export { InstanceSettingsScreen as 'tenant/settings' } from './tenant/TenantScreens';
export { StateScreen as 'tenant/state' } from './tenant/TenantScreens';
export { SessionsScreen as 'tenant/sessions' } from './tenant/TenantScreens';
