// mask.d.mts — the types for the shared masking pattern, `src/shared/mask.mjs` (R-BTN-144 classes
// 5 and 6). The implementation is JavaScript; these declarations give `src/runner` the same
// shapes at type-check time. Baton's own file, not vendored: the masking happens in Baton.
export declare const BEARER_TOKEN: RegExp;
export declare const KEY_BEGIN: RegExp;
export declare const KEY_END: RegExp;
export declare const KEY_HOLD: number;

/** `text` with every class-6 key block masked whole, then every class-5 token. */
export declare function maskKeys(text: string): string;
export declare function maskSecrets(text: string): string;

export interface Masker {
  /** One line in; the lines that may leave now, joined by `\n` (`''` while a block is held). */
  push(line: string): string;
  /** The stream's end: the `***` a held block leaves, if one is held. */
  flush(): string;
}

export declare function createMasker(): Masker;
