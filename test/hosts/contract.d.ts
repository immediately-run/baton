import type { BatonCore } from '../../src/core/baton';
import type { Config } from '../../src/core/ports';

export const HOST: 'cloudflare' | 'local';
export const config: Config;
export function call(req: Request): Promise<Response>;
export function raw(req: Request): Promise<Response>;
export function withCore<T>(fn: (core: BatonCore) => T | Promise<T>): Promise<T>;
export function reset(): Promise<void>;
export function tick(): Promise<void>;
export function writeTrace(testPath: string, test: string): Promise<void>;

export type AssertHost<T extends typeof import('./contract')> = T;
