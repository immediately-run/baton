export const TOKEN_KEYS: readonly ['input', 'cacheWrite5m', 'cacheWrite1h', 'cacheRead', 'output'];
export const OFF_PEAK: ' (off-peak)';
export const LEDGER_HEADER: string;
export const LEDGER_RULE: string;

type Tokens = Record<typeof TOKEN_KEYS[number], number>;
interface UsageRecord extends Tokens { id?: string; at: string | null | undefined; model: string; scope: string }
interface Bucket extends Tokens { calls: number; model: string; scope: string }
interface Price extends Partial<Tokens> {
  match: string;
  offPeak?: { factor?: number; peakUtc?: { days: readonly number[]; hours: readonly (readonly [number, number])[] } };
}
interface Prices { models?: readonly Price[] }
interface LedgerRow extends Bucket { date: string; session: string; harness: string; item: string; from: string | null; through: string; usd: number | null }
interface ItemCost { inputTokens: number; cachedInputTokens: number; outputTokens: number; usd: number; unpricedTokens: number; sessions: number; agentHours: number; firstCall: string | null }
interface Commit { at: string; subject: string; added?: string }

export function claudeRecords(text: string, scope?: string): UsageRecord[];
export function claudeSubagentScope(metaText: string): string;
export function opencodeRecords(exported: { messages?: readonly unknown[] } | null | undefined, scope?: string): { records: UsageRecord[]; children: { sessionId: string; scope: string }[] };
export function inWindow<T extends { at: string | null | undefined }>(records: readonly T[], since: string | null, through: string): T[];
export function isOffPeak(at: string | null | undefined, entry: Price | null | undefined): boolean;
export function aggregate(records: readonly UsageRecord[], prices?: Prices | null): Bucket[];
export function priceFor(model: string, prices: Prices | null | undefined): Price | null;
export function costOf(bucket: Tokens & { model: string }, prices: Prices | null | undefined): number | null;
export function firstCall(records: readonly { at: string | null | undefined }[]): string | null;
export function toRows(buckets: readonly Bucket[], context: { through: string; firstCall?: string | null; session: string; harness: string; item: string }, prices: Prices | null, options?: { withholdModel?: boolean }): string[];
export function parseLedger(text: string): LedgerRow[];
export function lastCheckpoint(rows: readonly LedgerRow[], session: string): string | null;
export function rowUsd(row: LedgerRow, prices: Prices | null | undefined): number | null;
export function rollUp(rows: readonly LedgerRow[], by?: 'item' | 'model', prices?: Prices | null): (Tokens & { calls: number; unit: string; sessions: number; usd: number; unpriced: number; agentHours: number })[];
export function itemCost(rows: readonly LedgerRow[], id: string, prices?: Prices | null): ItemCost | null;
export function claimedAt(commits: readonly Commit[], id: string): string | null;
export function parseItemLog(text: string): Commit[];
export function costBlock(cost: ItemCost | null, options: { claimed: string | null; done: string; noLedgerReason?: string | null }): string;
export function ledgerGate(cost: ItemCost | null, noLedgerReason: string | null | undefined): { ok: boolean; noLedgerReason: string | null };
export function setCostBlock(frontmatter: string, block: string): string;
