// Types for mask.mjs (R-BTN-144).
/** R-BTN-144 class 5: every bearer prefix Baton issues, followed by `[A-Za-z0-9_-]*`. */
export const BEARER_TOKEN: RegExp;
/** R-BTN-144 class 6: a `-----BEGIN … PRIVATE KEY-----` … `-----END … -----` block. */
export const PRIVATE_KEY_BLOCK: RegExp;
/** `text`, with every class-5 and class-6 occurrence replaced by `***`. */
export function maskSecrets(text: string): string;
