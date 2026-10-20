// Types for schema.mjs (R-BTN-108): the repository type-checks TypeScript only (allowJs off).
export type Schema = Record<string, unknown>;
export type Resolve = (id: string) => Schema | null;
export interface SchemaFault { path: string; message: string }
export const SCHEMA_ID: RegExp;
export const SCHEMA_MAX_BYTES: number;
export const SCHEMA_MAX_DEPTH: number;
export const PATTERN_MAX_CHARS: number;
export const PATTERN_MAX_REPEAT: number;
export const PATTERN_MAX_STATES: number;
export const VALUE_MAX_BYTES: number;
export const INLINE_STRING_MAX: number;
export function parseSchemaId(id: unknown): { prefix: string; name: string; version: number } | null;
export function compilePattern(src: string): (input: string) => boolean;
export function checkSchema(schema: unknown): SchemaFault[];
export function schemaRefs(schema: unknown): string[];
export function checkSchemaSet(schemas: Record<string, unknown>, resolve: Resolve): (SchemaFault & { id: string })[];
export function validate(value: unknown, id: string, resolve: Resolve): SchemaFault[];
export function baseChain(id: string, resolve: Resolve): string[];
export function unboundedAt(id: string, resolve: Resolve): string | null;
export function refinementGaps(schema: unknown, base: unknown, resolve: Resolve): (SchemaFault & { keyword: string })[];
