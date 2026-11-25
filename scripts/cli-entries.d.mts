export interface CliEntry {
  entry: string;
  exports: string[];
}

export const CLI_ENTRIES: Record<string, CliEntry[]>;
export function entryExports(entries: CliEntry[]): string;
