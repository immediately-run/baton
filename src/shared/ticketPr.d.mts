// ticketPr.d.mts — the types for the vendored ticketPr.mjs (docs' scripts/lib is the source,
// R-BTN-37; this file is Baton's own and is not vendored). The implementation is JavaScript
// with JSDoc; these declarations give `src/defaults` the same shapes at type-check time.
export declare const STATUS_FIELDS: string[];
export declare const CONTROL_FIELDS: string[];
export declare function splitFrontmatter(text: string): { fm: string; body: string };
export declare function frontmatterFields(text: string): Record<string, string>;
export declare function briefOf(body: string): string;
export declare function diffPairs(aText: string, bText: string, max?: number): { pairs: number; shown: number; lines: string[] };
export declare function ticketPathsUnder(items: string, paths: string[]): string[];
export declare function ticketId(path: string, text: string): string;

export interface TicketFieldChange {
  field: string;
  from: string | null;
  to: string | null;
  control: boolean;
}
/** The forge's reading of one commit (B-126): the account behind the git author and committer
 *  (null when none is associated) and the commit's signature verification. */
export interface TicketForge {
  author: string | null;
  committer: string | null;
  verified: boolean;
}
export interface TicketProvenance {
  sha: string;
  author: string;
  committer: string;
  date: string;
  forge?: TicketForge;
}
export interface TicketChange {
  path: string;
  id: string;
  kind: 'added' | 'removed' | 'changed';
  fields: TicketFieldChange[];
  body: { changed: boolean; pairs?: number; shown?: number; lines?: string[] };
  brief: { changed: boolean };
  statusOnly: boolean;
  reasons: string[];
  provenance: TicketProvenance[];
}
export interface TicketPrView {
  changed: TicketChange[];
  statusOnly: boolean;
  reasons: string[];
}
export declare function ticketPrView(arg: {
  items: string;
  base: Record<string, string | undefined>;
  head: Record<string, string | undefined>;
  provenance?: Record<string, TicketProvenance[]>;
}): TicketPrView;
export declare function formatTicket(c: TicketChange): string[];
export declare function claimMismatch(view: TicketPrView, claimedStatusOnly: boolean): string | null;
