// Types for mask.mjs (R-BTN-144).
/** R-BTN-144 class 5: every bearer prefix Baton issues, followed by `[A-Za-z0-9_-]*`. */
export const BEARER_TOKEN: RegExp;
/** R-BTN-144 class 6: the line that opens a private key block, and the line that closes one. */
export const KEY_BEGIN: RegExp;
export const KEY_END: RegExp;
/** R-BTN-144 class 6: how much of a block never closed is held before it is masked whole. */
export const KEY_HOLD: number;
/** Class 6 over one whole string: a block's body masked whole, `BEGIN` and `END` lines alike. */
export function maskKeys(text: string): string;
/** `text`, with every class-5 and class-6 occurrence replaced by `***`. */
export function maskSecrets(text: string): string;
/** Class 6 across a stream fed whole lines: `push` takes what arrived and returns what may
 *  leave now (`''` while a block is held); `flush` returns what is still held. */
export function createMasker(): { push(text: string): string; flush(): string };
