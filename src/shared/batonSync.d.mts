export interface Unconfirmed {
  claim_id: number;
  ticket_id: string;
  ended_at_sha?: string | null;
  end_reason?: string;
}
interface Confirmation { claim_id: number; sha: string }
type Awaitable<T> = T | Promise<T>;
type IsAncestor = (ancestor: string, descendant: string) => Awaitable<boolean>;
interface ConfirmationDeps { isAncestor: IsAncestor; statusOf: (id: string) => string | null | undefined }
interface Refusal { ok: false; code: string }
export type PostResult = { ok: true } | Refusal;
export interface Observation { ok?: true; observation: number; sha?: string | null; bars?: unknown }
export interface Head { ok?: true; sha: string | null; unconfirmed?: readonly Unconfirmed[] }
export interface SyncDeps extends ConfirmationDeps {
  observe: () => Awaitable<Observation | Refusal>;
  fetchNext?: () => Awaitable<string>;
  readHead: () => Awaitable<Head | Refusal>;
  post: (body: Record<string, unknown>) => Awaitable<PostResult>;
  buildPayload: () => Awaitable<Record<string, unknown>>;
  sleep: (ms: number) => Awaitable<unknown>;
}
export function decide(head: string | null | undefined, next: string, isAncestor: IsAncestor): Promise<'advance' | 'confirm-only' | 'force'>;
export function localId(ticketId: string): string;
export function confirmations(unconfirmed: readonly Unconfirmed[] | null | undefined, next: string, deps: ConfirmationDeps): Promise<Confirmation[]>;
export function syncOnce(next: string, deps: SyncDeps, options?: { backoffMs?: number }): Promise<{ outcome: 'advanced' | 'confirmed' | 'held' | 'busy' | `failed:${string}`; steps: string[]; next: string }>;
export function compareReady(readyByTier: Record<string, readonly string[]> | null | undefined, localOf: (tier: string) => readonly { id: string }[], tiers: Iterable<string>): Record<string, { baton: readonly string[]; local: string[]; same: boolean }>;
