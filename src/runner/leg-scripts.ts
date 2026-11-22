// R-BTN-133: Node decides the format; Baton only selects one entry per leg.
export const LEG_TREES = 'runner:leg-trees';
export const LEG_EXTENSION = /\.(?:mjs|js|cjs|mts|ts|cts)$/;

export function legScripts(files: string[]): Map<string, string> {
  const scripts = new Map<string, string>();
  for (const file of files.sort()) {
    if (!LEG_EXTENSION.test(file)) continue;
    const name = file.replace(LEG_EXTENSION, '');
    if (name.endsWith('.run')) continue;
    const other = scripts.get(name);
    if (other) throw new Error(`leg ${name} has two scripts: ${other} and ${file} (R-BTN-133)`);
    scripts.set(name, file);
  }
  return scripts;
}
