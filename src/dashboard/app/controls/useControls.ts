// useControls.ts — a screen's controls (B-207 item 1): the session's registry entries — the
// shell's cached `GET /v1/actions`, and nothing else — whose `ui.view` names the screen, each
// with the form its `input` schema gives and the route it calls. Where the screen's read
// carries an `allowed` list (B-191: a control whose answer depends on the target's policy),
// only the entries it names are drawn. No role is guessed and no policy is read here: a control
// is drawn when the server listed it, and the server authorizes every call again.
import { useMemo } from 'react';
import type { Action } from '../../lib/types';
import { formOf, routeOf, type FormSpec } from '../../lib/schemaForm';
import { useShell } from '../shell';

export interface Control {
  entry: Action;
  /** The button's words: the entry's `summary` up to its first colon or full stop, with "…"
   *  where a dialog follows. The whole summary is the button's description. */
  label: string;
  /** `effect: destructive` (§12.2). */
  destructive: boolean;
  /** A destructive entry whose input takes `confirm`: the dialog sends `confirm: true`. */
  dialog: boolean;
  form: FormSpec;
  method: string;
  /** The route with its parameters filled from the context. */
  path: string;
}

/** A summary as a button's words. */
export function labelOf(summary: string, dialog: boolean): string {
  const short = (/^[^:.]+/.exec(summary)?.[0] ?? summary).trim() || summary;
  return dialog ? `${short}…` : short;
}

/** The controls of screen `view` for `context` — pure, so a test reads it without React. */
export function controlsOf(actions: readonly Action[], view: string, context: Record<string, unknown>, allowed?: readonly string[] | null): Control[] {
  const out: Control[] = [];
  for (const entry of actions) {
    if (entry.effect === 'read' || !entry.ui?.view?.includes(view)) continue;
    if (allowed && !allowed.includes(entry.id)) continue;
    const route = entry.ui.route ?? entry.http;
    const path = routeOf(route.path, context);
    if (path === null) continue; // the screen holds no target for it (no live claim, say)
    const destructive = entry.effect === 'destructive';
    const dialog = destructive && entry.input?.properties?.confirm !== undefined;
    out.push({ entry, label: labelOf(entry.summary, dialog), destructive, dialog, form: formOf(entry, context), method: route.method, path });
  }
  // The primary act first, destructive ones last (the mockup's rows); the registry's order within.
  return [...out.filter((c) => !c.destructive), ...out.filter((c) => c.destructive)];
}

/** `controlsOf` over the shell's entries. `context` is the screen's known values —
 *  `repository`, `ticket`, `ticket_id`, `condition_id`, `to_runner_id`, `runner_id`, `claim`,
 *  `sha`, … — which fill path parameters and input fields of the same name. */
export function useControls(view: string, context: Record<string, unknown>, allowed?: readonly string[] | null): Control[] {
  const { actions } = useShell();
  const contextKey = JSON.stringify(context);
  const allowedKey = allowed ? allowed.join('\n') : null;
  // The keys stand for `context` and `allowed`: a new object with the same values is the same.
  return useMemo(() => controlsOf(actions, view, context, allowed), [actions, view, contextKey, allowedKey]);
}
