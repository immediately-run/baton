// evidence.ts — the sync's `std:git.evidence@1` attestations (BATON_SPEC §9.6 R-BTN-10, §4.3,
// R-BTN-191). The observation lists every unconfirmed end that named evidence — a commit sha or
// an https URL (R-BTN-8) — and the sync answers, in the post read under that number, whether git
// or the forge shows each one. Baton confirms an end only on `found: true` for exactly the
// evidence it named; `found: false`, or no answer at all, leaves it unconfirmed, flagged at 6 h.
//
// What counts as shown:
// - a commit: the object is in the home checkout, after a fetch of that sha when it is not;
//   failing that, the home's forge knows it (a claim's commit may be on a branch not fetched);
// - a URL on a known GitHub host (github.com, or a `code_repos` entry's): the comment, review,
//   review comment, PR or commit it names answers 200 on that host's API. A 404 or 410 is
//   `found: false`. Any other answer, a failed request, an unknown host or a URL form this file
//   does not read is no answer — never `found: false` for what was not looked at, and the token
//   is never sent anywhere but a known host's API.

export const GIT_EVIDENCE_TYPE = 'std:git.evidence@1';
/** The most forge requests one run spends on evidence: each unconfirmed end is asked again every
 *  sync until it is confirmed or resolved, so a backlog is worked through over runs, oldest
 *  first, inside the token's hourly budget beside the fact adapter's own MAX_REQUESTS. */
export const EVIDENCE_REQUESTS_MAX = 60;

export interface UnconfirmedEnd {
  ticket: string;
  claim: number;
  evidence: string;
}

export interface EvidenceAttestation {
  type: typeof GIT_EVIDENCE_TYPE;
  ticket: string;
  ref: string;
  value: { claim: number; evidence: string; found: boolean };
}

export interface EvidencePorts {
  /** Whether the commit is in the home checkout, fetching that one sha first when it is not. */
  hasCommit: (sha: string) => boolean;
  /** The home's forge path (`owner/name`) and host, when the home is on GitHub. */
  home: { host: string; slug: string } | null;
  /** GitHub hosts whose API the token may be sent to. */
  hosts: ReadonlySet<string>;
  /** A GET of the host's REST API: the status, or null when the request failed. */
  get: (host: string, path: string) => Promise<number | null>;
  log: (line: string) => void;
}

const SHA = /^[0-9a-f]{40}$/;

/** The REST path that answers whether a GitHub URL's object exists, or null for a form not read. */
export function evidencePath(url: URL): string | null {
  const m = /^\/([^/]+)\/([^/]+)\/(pull|issues|commit)\/([^/]+)\/?$/.exec(url.pathname);
  if (!m) return null;
  const [, owner, name, kind, id] = m;
  const repo = `/repos/${owner}/${name}`;
  const hash = url.hash.slice(1);
  if (kind === 'commit') return /^[0-9a-f]{7,40}$/.test(id) ? `${repo}/commits/${id}` : null;
  if (!/^\d+$/.test(id)) return null;
  let f: RegExpExecArray | null;
  if ((f = /^issuecomment-(\d+)$/.exec(hash))) return `${repo}/issues/comments/${f[1]}`;
  if (kind === 'issues') return hash === '' ? `${repo}/issues/${id}` : null;
  if ((f = /^pullrequestreview-(\d+)$/.exec(hash))) return `${repo}/pulls/${id}/reviews/${f[1]}`;
  if ((f = /^discussion_r(\d+)$/.exec(hash))) return `${repo}/pulls/comments/${f[1]}`;
  return hash === '' ? `${repo}/pulls/${id}` : null;
}

/** One attestation per end the run could answer; the rest are left for a later run or the owner. */
export async function attestEvidence(list: readonly UnconfirmedEnd[], ports: EvidencePorts): Promise<EvidenceAttestation[]> {
  const out: EvidenceAttestation[] = [];
  let spent = 0;
  let skipped = 0;
  const ask = async (host: string, path: string): Promise<boolean | null> => {
    if (spent >= EVIDENCE_REQUESTS_MAX) {
      skipped++;
      return null;
    }
    spent++;
    const status = await ports.get(host, path);
    if (status === 200) return true;
    if (status === 404 || status === 410 || status === 422) return false;
    return null;
  };
  for (const u of list) {
    if (!Number.isSafeInteger(u.claim) || typeof u.evidence !== 'string' || typeof u.ticket !== 'string') continue;
    let found: boolean | null = null;
    if (SHA.test(u.evidence)) {
      found = ports.hasCommit(u.evidence) ? true : ports.home ? await ask(ports.home.host, `/repos/${ports.home.slug}/commits/${u.evidence}`) : false;
    } else {
      let url: URL | null = null;
      try {
        url = new URL(u.evidence);
      } catch {
        url = null;
      }
      const path = url && url.protocol === 'https:' && ports.hosts.has(url.host) ? evidencePath(url) : null;
      if (url && path) found = await ask(url.host, path);
    }
    if (found === null) continue;
    out.push({ type: GIT_EVIDENCE_TYPE, ticket: u.ticket, ref: String(u.claim), value: { claim: u.claim, evidence: u.evidence, found } });
  }
  const missing = out.filter((a) => !a.value.found).length;
  ports.log(`baton: evidence — ${list.length} unconfirmed end${list.length === 1 ? '' : 's'} named evidence; attested ${out.length} (${missing} not found)${skipped ? `, ${skipped} left for a later run (budget ${EVIDENCE_REQUESTS_MAX})` : ''}`);
  return out;
}
