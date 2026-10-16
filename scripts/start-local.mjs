// start-local.mjs — `npm run start:local -- --db <path> --port <n>` (BATON_SPEC §3a R-BTN-55):
// bundles src/local/main.ts with the schema migrations and the dashboard as text, as wrangler's
// Text rule does for the Worker, and runs it in this Node.
import { bundleLocal } from './bundle.mjs';

await bundleLocal('src/local/entry.ts', 'baton-local.mjs');
