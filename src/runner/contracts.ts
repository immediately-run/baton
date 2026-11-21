// S-BTN-48: live runs and replay read the same bytes and use the shared schema validator.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitPointer, pointerAllowed, S3_POINTER, type PointerReach } from '../core/contractPointers';
import { declaredOutputFault, type ResolvedInput } from '../core/contracts';
import { checkOutputs, type Output } from '../core/validate';
import { baseChain, PATTERN_STEPS_MAX, unboundedAt, validate, type Resolve } from '../shared/schema.mjs';
import { stdSchema } from '../shared/std.mjs';
import { git, type CourseLoad } from './home';

const MAX_BYTES = 16 << 20;
export const sha256 = (bytes: Buffer): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

export function gitBytes(home: string, args: string[]): Buffer | null {
  try {
    return execFileSync('git', ['-C', home, ...args], { encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: MAX_BYTES, timeout: 30_000, killSignal: 'SIGKILL', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } });
  } catch {
    return null;
  }
}

export function slugOf(url: string): string {
  return url.trim().replace(/\.git$/, '').replace(/^.*[:/]([^/:]+\/[^/:]+)$/, '$1').toLowerCase();
}

async function pointerBytes(home: string, uri: string, reach: PointerReach): Promise<Buffer> {
  const pointer = gitPointer(uri);
  if (pointer) {
    const name = pointer.repository.toLowerCase();
    const origin = git(home, ['config', 'remote.origin.url']).trim();
    const base = reach.web.find((url) => new URL(url).pathname.slice(1).toLowerCase() === name);
    const originUrl = /^(?:[^@]+@)?([^:/]+):([^/].*)$/.exec(origin);
    const originHost = origin.includes('://') ? new URL(origin).host : originUrl?.[1];
    const local = slugOf(origin) === name && (!base || originHost?.toLowerCase() === new URL(base).host);
    const object = pointer.blob ?? `${pointer.commit}:${pointer.path}`;
    const existing = local ? gitBytes(home, ['cat-file', 'blob', object]) : null;
    if (existing) return existing;
    if (!base && !local) throw new Error('the pointer has no fetch location');
    const scratch = mkdtempSync(join(tmpdir(), 'baton-artifact-'));
    try {
      if (!gitBytes(scratch, ['init', '--bare', '--quiet']) || !gitBytes(scratch, [
        '-c', 'credential.helper=', '-c', 'http.followRedirects=false', 'fetch', '--no-tags', '--no-write-fetch-head',
        '--depth=1', '--', base ? `${base}.git` : origin, pointer.commit ?? pointer.blob!,
      ])) throw new Error('the Git object could not be fetched');
      const bytes = gitBytes(scratch, ['cat-file', 'blob', object]);
      if (!bytes) throw new Error('the pointer is not a readable blob');
      return bytes;
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  const bucket = S3_POINTER.exec(uri)?.[1];
  const url = bucket ? `https://${bucket}.s3.amazonaws.com${uri.slice('s3://'.length + bucket.length)}` : uri;
  if (!url.startsWith('https://')) throw new Error('the pointer has an unsupported scheme');
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok || !response.body) throw new Error(`the pointer answered ${response.status}`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, size);
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('the pointer exceeds the artifact size limit');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
}

export async function readArtifact(home: string, envelope: Omit<Output, 'schema'> & { schema?: string }, resolve: Resolve, reach: PointerReach, meter = { steps: PATTERN_STEPS_MAX }): Promise<unknown> {
  let value = envelope.value;
  if (envelope.uri) {
    if (!pointerAllowed(envelope.uri, reach)) throw new Error('pointer has no repository or bucket reach');
    const bytes = await pointerBytes(home, envelope.uri, reach);
    if (envelope.digest && sha256(bytes) !== envelope.digest) throw new Error(`the fetched bytes digest to ${sha256(bytes).slice(0, 17)}…, not the recorded digest`);
    if (!envelope.schema) return undefined; // a pre-contract replay recorded only the pointer
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new Error('the pointer does not contain UTF-8 JSON'); }
  } else if (!Object.hasOwn(envelope, 'value')) throw new Error('the envelope has neither a pointer nor a value');
  if (envelope.schema && validate(value, envelope.schema, resolve, meter).length) throw new Error(`value fails ${envelope.schema}`);
  return value;
}

export async function readLegInputs(home: string, course: CourseLoad, inputs: ResolvedInput[], reach: PointerReach) {
  const checked = [];
  const meter = { steps: PATTERN_STEPS_MAX };
  for (const input of inputs) {
    try {
      const value = await readArtifact(home, input, course.schema ?? stdSchema, reach, meter);
      checked.push({ ...input, value });
    } catch (e) {
      throw new Error(`input ${input.name} (${input.schema}) from ${input.from_leg} version ${input.leg_version}: ${(e as Error).message}`);
    }
  }
  return checked;
}

export async function checkLegOutputs(home: string, course: CourseLoad, leg: string, reached: string, raw: unknown, reach: PointerReach) {
  const outputs = checkOutputs(raw);
  const resolve = course.schema ?? stdSchema;
  const fault = declaredOutputFault(course.graph.legs.get(leg), outputs);
  if (fault) throw new Error(fault);
  for (const entry of course.graph.entry.get(reached) ?? []) {
    const o = outputs.find((x) => x.name === entry.output);
    if (!o || !baseChain(o.schema, resolve).includes(entry.schema)) throw new Error(`${reached} requires ${entry.output} (${entry.schema})`);
  }
  const meter = { steps: PATTERN_STEPS_MAX };
  for (const output of outputs) {
    if (Object.hasOwn(output, 'value') && unboundedAt(output.schema, resolve)) throw new Error(`output ${output.name} must be given by pointer`);
    await readArtifact(home, output, resolve, reach, meter);
  }
}
