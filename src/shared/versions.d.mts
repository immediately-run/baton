// versions.d.mts — the types of src/shared/versions.mjs for the TypeScript side (the .d.mts
// convention of this directory: links.d.mts, mask.d.mjs's, std.d.mts).
export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  pre: string[] | null;
}
export declare function parseVersion(v: unknown): ParsedVersion | null;
export declare function compareVersions(a: string, b: string): number;
export declare function maxVersion(a: string, b: string): string;
export declare function clientVersionOf(header: unknown): string | null;
export declare function clientVersionsValue(versions: { min: string; recommended: string }): string;
export declare function parseClientVersions(header: unknown): { min: string; recommended: string } | null;
