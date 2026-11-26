import type { PostedAttestation } from '../../core/board';
import type { Forge, PrForge } from '../../core/forges';
import type { CodeRepoEntry, PrFact } from '../course-pr';

/** Coordinates come from a registered repository, not an agent's answer URL. */
export interface ForgeRegistration {
  forge: Forge;
  path: string;
  webBase: string | null;
}
export interface ForgeRepo extends ForgeRegistration {
  forge: PrForge;
  webBase: string;
}
export type ForgeExec = (cmd: 'git' | 'gh', args: string[], cwd: string) => string;
export interface ForgeOptions {
  checkout?: string;
  run?: ForgeExec;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}
export interface OpenPr {
  head: string;
  base: string;
  title: string;
  body?: string;
}
export interface OpenPrRef {
  number: number;
  headRefName: string;
  headRefOid: string;
  sameRepository?: boolean;
  state?: PrFact['state'];
}
export interface FactRead { tickets: string[]; entry?: CodeRepoEntry; ticketOutputs?: PostedAttestation[]; readPrs?: boolean }
export interface FactContext {
  log: (line: string) => void;
  owns: (pr: Pick<PrFact, 'number' | 'head' | 'repository' | 'sameRepository'>) => boolean;
  outputEvidence?: PostedAttestation[];
  ownsOutput?: (ticket: string, pr: Parameters<FactContext['owns']>[0]) => boolean;
  pushers: { host: string; id: string }[];
}
export interface ForgeClient {
  openPr(pr: OpenPr): Promise<string>;
  listOpenPrs(): Promise<OpenPrRef[]>;
  listPrs(): Promise<OpenPrRef[]>;
  comment(number: number, body: string): Promise<string>;
  facts(read: FactRead): Promise<PrFact[]>;
  protectedRefusal(detail: string): boolean;
  /** R-BTN-82: post a ticket close's output witness on its commit; false where this forge's
   *  adapter reads no witness back. */
  witness(sha: string, body: string): Promise<boolean>;
  /** R-BTN-10: the read answering whether a commit of this repository, or an object a URL on it
   *  names, exists — its HTTP status, or null when the request failed — or null when this
   *  adapter has no credential or does not read that form. */
  evidence(ref: string): (() => Promise<number | null>) | null;
}
