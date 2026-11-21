// R-BTN-82 and §12.3: the pointer shapes and ticket-scoped allowlist, shared with the runner.
import { underWebBase } from '../shared/links.mjs';

const GIT_POINTER = /^git:([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)(?:@([0-9a-f]{40}):([A-Za-z0-9._/-]{1,512})|#blob=([0-9a-f]{40}))$/;
export const S3_POINTER = /^s3:\/\/([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])\/[^\s?#]+\?versionId=[^\s&#]+$/;

export function gitPointer(uri: string) {
  const m = GIT_POINTER.exec(uri);
  if (!m || m[3]?.split('/').some((s) => !s || s === '.' || s === '..')) return null;
  return { repository: m[1], commit: m[2], path: m[3], blob: m[4] };
}

export interface PointerReach {
  git: string[];
  web: string[];
  buckets: string[];
}

export function pointerAllowed(uri: string, reach: PointerReach): boolean {
  if (uri.startsWith('https://')) return reach.web.some((base) => underWebBase(uri, base));
  const git = gitPointer(uri);
  if (git) return reach.git.includes(git.repository.toLowerCase());
  const bucket = S3_POINTER.exec(uri)?.[1];
  return bucket != null && reach.buckets.includes(bucket);
}

/** §12.3: decode one marker field, not the framing around it. */
export function decodeMarkerField(field: string): string {
  if (!/^(?:[A-Za-z0-9._~-]|%[0-9A-Fa-f]{2})*$/.test(field)) throw new Error('invalid marker field encoding');
  return decodeURIComponent(field);
}
