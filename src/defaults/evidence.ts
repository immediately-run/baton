// evidence.ts — the sync's `std:git.evidence@1` attestations (BATON_SPEC §9.6 R-BTN-10, §4.3,
// R-BTN-191). The observation lists every unconfirmed end that named evidence — a commit sha or
// an https URL (R-BTN-8) — and the sync answers, in the post read under that number, whether git
// or the forge shows each one. Baton confirms an end only on `found: true` for exactly the
// evidence it named; `found: false`, or no answer at all, leaves it unconfirmed, flagged at 6 h.
//
// What counts as shown:
// - a commit: the object is in the home checkout, after a fetch of that sha when it is not;
//   failing that, the home's forge knows it (a claim's commit may be on a branch not fetched);
// - a URL: the forge adapter of the host it names (an adapter's public host, or a registered
//   repository's) reads the object it names — on GitHub the comment, review, review comment,
//   PR or commit — and a 200 is `found: true`. A 404, 410 or 422 is `found: false`. Any other
//   answer, a failed request, an unknown host, a forge whose adapter reads no evidence, or a URL
//   form the adapter does not read is no answer — never `found: false` for what was not looked
//   at, and the credential is never sent anywhere but a known host's API (forges/index.ts,
//   `evidenceReader`).

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
  /** The forge read answering whether the evidence exists — its HTTP status, null when the
   *  request failed — chosen by the forge adapter (forges/index.ts, `evidenceReader`); null
   *  when no adapter may be asked: no credential, an unknown host, an unread form. */
  forgeRead: (evidence: string) => (() => Promise<number | null>) | null;
  log: (line: string) => void;
}

const SHA = /^[0-9a-f]{40}$/;

/** One attestation per end the run could answer; the rest are left for a later run or the owner. */
export async function attestEvidence(list: readonly UnconfirmedEnd[], ports: EvidencePorts): Promise<EvidenceAttestation[]> {
  const out: EvidenceAttestation[] = [];
  let spent = 0;
  let skipped = 0;
  const ask = async (read: () => Promise<number | null>): Promise<boolean | null> => {
    if (spent >= EVIDENCE_REQUESTS_MAX) {
      skipped++;
      return null;
    }
    spent++;
    const status = await read();
    if (status === 200) return true;
    if (status === 404 || status === 410 || status === 422) return false;
    return null;
  };
  for (const u of list) {
    if (!Number.isSafeInteger(u.claim) || typeof u.evidence !== 'string' || typeof u.ticket !== 'string') continue;
    let found: boolean | null = null;
    const read = ports.forgeRead(u.evidence);
    if (SHA.test(u.evidence)) found = ports.hasCommit(u.evidence) ? true : read ? await ask(read) : false;
    else if (read) found = await ask(read);
    if (found === null) continue;
    out.push({ type: GIT_EVIDENCE_TYPE, ticket: u.ticket, ref: String(u.claim), value: { claim: u.claim, evidence: u.evidence, found } });
  }
  const missing = out.filter((a) => !a.value.found).length;
  ports.log(`baton: evidence — ${list.length} unconfirmed end${list.length === 1 ? '' : 's'} named evidence; attested ${out.length} (${missing} not found)${skipped ? `, ${skipped} left for a later run (budget ${EVIDENCE_REQUESTS_MAX})` : ''}`);
  return out;
}
