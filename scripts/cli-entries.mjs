// The checkout and published CLI expose the same command namespaces (B-280).
export const CLI_ENTRIES = {
  'baton-cli.mjs': [
    { entry: 'src/defaults/cli.ts', exports: ['initMain', 'parseSyncArgs', 'syncMain', 'migrateMarkersMain', 'prebuildDefaults', 'remoteSlug', 'verifyConfigMain'] },
    { entry: 'src/defaults/tickets.ts', exports: ['ticketsMain'] },
    { entry: 'src/defaults/request.ts', exports: ['requestMain'] },
    { entry: 'src/defaults/homes.ts', exports: ['homeMain', 'resolveHomes'] },
  ],
  'baton-leg.mjs': [{ entry: 'src/runner/leg.ts', exports: ['legMain', 'raiseMain'] }],
  'baton-run.mjs': [
    { entry: 'src/runner/main.ts', exports: ['runMain', 'queueCommand'] },
    { entry: 'src/runner/replay.ts', exports: ['replayMain'] },
  ],
};

/** Both builds use explicit ES exports so a name absent in its source fails the build. */
export function entryExports(entries) {
  return entries.map(({ entry, exports }) => `export { ${exports.join(', ')} } from ${JSON.stringify(`./${entry}`)};`).join('\n');
}
