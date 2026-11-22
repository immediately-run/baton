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
}
export interface FactRead { tickets: string[]; entry?: CodeRepoEntry }
export interface FactContext {
  log: (line: string) => void;
  owns: (pr: { number: number; head: string; repository: string }) => boolean;
  pushers: { host: string; id: string }[];
}
export interface ForgeClient {
  openPr(pr: OpenPr): Promise<string>;
  listOpenPrs(): Promise<OpenPrRef[]>;
  comment(number: number, body: string): Promise<string>;
  facts(read: FactRead): Promise<PrFact[]>;
  protectedRefusal(detail: string): boolean;
}
