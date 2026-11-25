// schemaForm.ts — a registry entry's `input` schema as a form (B-207 item 2): one pure table
// from the schema subset `src/core/actions.ts` states to the fields the page draws. A field the
// entry fixes (`const`, a scalar of `http.match`) or the screen's context fills is never drawn;
// `confirm` is never a field — the confirm dialog sends it. A property the table cannot draw
// makes the whole entry undrawable: the control is then named as text, never a guessed form.
import type { Action, InputProperty } from './types';

export type Scalar = string | number | boolean;

/** How one field is drawn. */
export type FieldKind = 'select' | 'radio' | 'checkbox' | 'number' | 'text' | 'list';

export interface Field {
  /** The field's place in the body: `reason`, or `payload.reason` inside an object. */
  path: string;
  /** The property's own name — what the screen's context is asked for. */
  name: string;
  kind: FieldKind;
  label: string;
  required: boolean;
  description?: string;
  options?: Scalar[];
  integer?: boolean;
  pattern?: string;
  maxLength?: number;
}

/** An entry's form: the values it fixes or the context fills (`preset`, by body path), the
 *  fields left for the person — or the one property that cannot be drawn. */
export type FormSpec =
  | { drawable: true; preset: Record<string, unknown>; fields: Field[] }
  | { drawable: false; why: string };

/** The names drawn as radio buttons rather than a select (B-207). */
const RADIO_NAMES = new Set(['restart', 'option']);

const isScalar = (v: unknown): v is Scalar => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

/** `name` as a label: `to_runner_id` → `to runner id`. */
const labelOf = (name: string) => name.replace(/[_-]+/g, ' ');

/** The form of `entry` for a screen whose context is `context`. */
export function formOf(entry: Pick<Action, 'input' | 'http'>, context: Record<string, unknown> = {}): FormSpec {
  const preset: Record<string, unknown> = {};
  const fields: Field[] = [];
  const match = entry.http.match ?? {};
  let undrawable: string | null = null;

  const walk = (props: Record<string, InputProperty>, required: readonly string[], prefix: string, top: boolean) => {
    for (const [name, prop] of Object.entries(props)) {
      const path = prefix + name;
      const need = required.includes(name);
      if (top && name === 'confirm') continue; // the dialog's, never a field
      if (prop.const !== undefined) {
        preset[path] = prop.const;
        continue;
      }
      if (top && isScalar(match[name])) {
        preset[path] = match[name];
        continue;
      }
      if (prop.type === 'object') {
        if (!prop.properties) {
          undrawable ??= path;
          continue;
        }
        walk(prop.properties, prop.required ?? [], `${path}.`, false);
        continue;
      }
      const given = context[name];
      if (given !== undefined && given !== null && given !== '') {
        preset[path] = prop.type === 'integer' || prop.type === 'number' ? Number(given) : given;
        continue;
      }
      const extra = prop as InputProperty & { pattern?: unknown; maxLength?: unknown };
      const base = { path, name, label: labelOf(name), required: need, ...(prop.description ? { description: prop.description } : {}) };
      if (Array.isArray(prop.enum) && prop.enum.every(isScalar) && prop.enum.length > 0) {
        fields.push({ ...base, kind: prop.type === 'string' && RADIO_NAMES.has(name) ? 'radio' : 'select', options: prop.enum });
      } else if (prop.type === 'boolean') fields.push({ ...base, kind: 'checkbox' });
      else if (prop.type === 'integer' || prop.type === 'number') fields.push({ ...base, kind: 'number', integer: prop.type === 'integer' });
      else if (prop.type === 'string') {
        fields.push({ ...base, kind: 'text', ...(typeof extra.pattern === 'string' ? { pattern: extra.pattern } : {}), ...(typeof extra.maxLength === 'number' ? { maxLength: extra.maxLength } : {}) });
      } else if (prop.type === 'array' && prop.items?.type === 'string' && !prop.items.enum) fields.push({ ...base, kind: 'list' });
      else undrawable ??= path;
    }
  };
  walk(entry.input?.properties ?? {}, entry.input?.required ?? [], '', true);
  if (undrawable !== null) return { drawable: false, why: undrawable };
  return { drawable: true, preset, fields };
}

/** A field's starting value: an enum's first option (so a required choice is one click), an
 *  unchecked box, an empty text. */
export function initialOf(field: Field): string | boolean {
  if (field.kind === 'checkbox') return false;
  if ((field.kind === 'select' || field.kind === 'radio') && field.options?.length) return field.required ? String(field.options[0]) : '';
  return '';
}

/** The form's raw values as body values, or the faults that stop the call: a required field
 *  left empty, a number that is not one. The server validates again (`invalid-params`); this is
 *  convenience, not a gate. */
export function readForm(fields: readonly Field[], raw: Record<string, string | boolean>): { values: Record<string, unknown>; faults: Record<string, string> } {
  const values: Record<string, unknown> = {};
  const faults: Record<string, string> = {};
  for (const f of fields) {
    const v = raw[f.path];
    if (f.kind === 'checkbox') {
      values[f.path] = v === true;
      continue;
    }
    const text = typeof v === 'string' ? v.trim() : '';
    if (text === '') {
      if (f.required) faults[f.path] = 'required';
      continue;
    }
    if (f.kind === 'number') {
      const n = Number(text);
      if (!Number.isFinite(n) || (f.integer && !Number.isInteger(n))) faults[f.path] = f.integer ? 'must be a whole number' : 'must be a number';
      else values[f.path] = n;
    } else if (f.kind === 'list') values[f.path] = text.split(',').map((s) => s.trim()).filter((s) => s !== '');
    else if (f.kind === 'select' || f.kind === 'radio') values[f.path] = f.options?.find((o) => String(o) === text) ?? text;
    else values[f.path] = text;
  }
  return { values, faults };
}

/** Values by body path (`payload.reason`) as the nested body the route takes. */
export function bodyOf(...parts: Record<string, unknown>[]): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const part of parts) {
    for (const [path, value] of Object.entries(part)) {
      const keys = path.split('.');
      let at = body;
      for (const k of keys.slice(0, -1)) {
        if (typeof at[k] !== 'object' || at[k] === null) at[k] = {};
        at = at[k] as Record<string, unknown>;
      }
      at[keys[keys.length - 1]] = value;
    }
  }
  return body;
}

/** An entry's path with each `{param}` filled from the context — `{ticket}` from `ticket`, or
 *  from `ticket_id` — and encoded; null while a parameter is missing (the control is not drawn). */
export function routeOf(path: string, context: Record<string, unknown>): string | null {
  let ok = true;
  const out = path.split('/').map((seg) => {
    if (!(seg.startsWith('{') && seg.endsWith('}'))) return seg;
    const name = seg.slice(1, -1);
    const value = context[name] ?? context[`${name}_id`];
    if ((typeof value !== 'string' && typeof value !== 'number') || value === '') {
      ok = false;
      return '';
    }
    return encodeURIComponent(String(value));
  }).join('/');
  return ok ? out : null;
}
