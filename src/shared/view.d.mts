// Types for view.mjs (R-BTN-112): the repository type-checks TypeScript only (allowJs off).
import type { Resolve } from './schema.mjs';
export type { Resolve };
/** What links a render may draw: the ticket's repositories' `web_base`s (R-BTN-92) and the
 *  instance's `link_hosts` (R-BTN-157), and the clock `time` fields read. */
export interface ViewContext {
  webBases?: string[];
  linkHosts?: string[];
  now?: number;
}
/** A ui node, as src/ui/app.js's `el` mounts it: text set through `textContent`, positions
 *  through the CSSOM (`style`) — an extension B-56/B-57 owe `el()`, which drops them today —
 *  never markup. */
export interface UiNode {
  tag: string;
  text?: string;
  cls?: string;
  attrs?: Record<string, string>;
  style?: Record<string, string>;
  children?: UiNode[];
}
export const VIEW_TEXT_MAX: number;
export const VIEW_TABLE_ROWS: number;
/** R-BTN-112's link gate: the url a view may draw as a link, or null (drawn as text). */
export function viewLink(url: unknown, ctx?: ViewContext): string | null;
/** The view a value renders by: its own schema's, else the nearest up its base chain, else null. */
export function viewOf(schemaId: string, resolve: Resolve): Record<string, unknown> | null;
export function renderPlain(value: unknown, schemaId: string, resolve: Resolve, ctx?: ViewContext): string;
export function renderHtml(value: unknown, schemaId: string, resolve: Resolve, ctx?: ViewContext): string;
export function renderUi(value: unknown, schemaId: string, resolve: Resolve, ctx?: ViewContext): UiNode;
/** Core's own one-line template for an event (R-BTN-112), `slot` the course's view of the
 *  relevant value, rendered by `renderPlain` by the caller. */
export function renderEvent(kind: string, row?: Record<string, unknown>, slot?: string): string;
