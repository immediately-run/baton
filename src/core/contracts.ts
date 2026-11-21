// S-BTN-48: resolve contract envelopes without reading the bytes behind a pointer.
import { codeReposOf, homeForgeOf, ticketRepositories } from './codeRepos';
import type { PointerReach } from './contractPointers';
import type { Store } from './ports';
import type { Graph, Leg } from './graph';
import type { Output } from './validate';

export interface ResolvedInput extends Output {
  from_leg: string;
  from_run: number;
  leg_version: number;
  course_version: number;
}

interface StoredOutput {
  run: number;
  schema: string;
  uri: string | null;
  digest: string | null;
  value_json: string | null;
  leg_version: number;
  course_version: number;
}

export function resolveInputs(graph: Graph, leg: string, latest: (producer: string, output: string) => StoredOutput | undefined):
  { inputs: ResolvedInput[]; wait?: 'input-missing' | 'input-version' } {
  const inputs: ResolvedInput[] = [];
  for (const [name, def] of Object.entries(graph.legs.get(leg)?.inputs ?? {})) {
    const [producer, output] = def.from.split('.');
    const found = latest(producer, output);
    const accepted = def.accepts ?? [graph.legs.get(producer)!.version];
    if (!found || !accepted.includes(found.leg_version)) {
      if (def.required !== false) return { inputs: [], wait: found ? 'input-version' : 'input-missing' };
      continue;
    }
    inputs.push({ name, schema: found.schema, from_leg: producer, from_run: found.run, leg_version: found.leg_version, course_version: found.course_version,
      ...(found.uri != null ? { uri: found.uri, ...(found.digest != null ? { digest: found.digest } : {}) } : { value: JSON.parse(found.value_json!) }) });
  }
  return { inputs };
}

export function ticketInputs(store: Store, ticket: string, graph: Graph, leg: string) {
  return resolveInputs(graph, leg, (producer, output) => store.exec<StoredOutput>(
    `SELECT run, schema, uri, digest, value_json, leg_version, course_version FROM leg_outputs
     WHERE ticket_id = ? AND leg = ? AND name = ? ORDER BY run DESC LIMIT 1`, ticket, producer, output).toArray()[0]);
}

export function declaredOutputFault(leg: Leg | undefined, outputs: Output[]): string | null {
  if (!leg?.outputs) return null;
  for (const [name, { schema }] of Object.entries(leg.outputs)) {
    if (!outputs.some((o) => o.name === name && o.schema === schema)) return `output ${name} must carry ${schema}`;
  }
  return outputs.some((o) => !Object.hasOwn(leg.outputs!, o.name)) ? 'the leg returned an undeclared output' : null;
}

export function pointerReach(store: Store, repo: string, ticket: string): PointerReach {
  const row = store.exec<{ repos: string }>('SELECT repos FROM tickets WHERE id = ?', ticket).toArray()[0];
  const paths = JSON.parse(row?.repos ?? '[]') as string[];
  const home = homeForgeOf(store, repo)?.github.toLowerCase();
  const entries = codeReposOf(store, repo);
  const git = home ? [home, ...paths.map((r) => (r.includes('/') ? r : `${home.split('/')[0]}/${r}`).toLowerCase())
    .filter((r) => entries.length === 0 || entries.some((e) => e.path.toLowerCase() === r))] : [];
  const web = ticketRepositories(store, repo, paths).map((r) => r.webBase);
  const settings = store.exec<{ artifact_buckets: string }>('SELECT artifact_buckets FROM repositories WHERE id = ?', repo).toArray()[0];
  return { git, web, buckets: JSON.parse(settings?.artifact_buckets ?? '[]') as string[] };
}
