// versions.mjs — the client versions Baton and its clients state about each other
// (BATON_SPEC §11.3 R-BTN-197, B-254): semver precedence (`+dev` and any build metadata take no
// part), the `Baton-Client` request header's shape (`baton/<version>`) and the
// `Baton-Client-Versions` response header (`min=<version>, recommended=<version>`). Pure, like
// every module here: the core (both hosts), the runner and the CLI import it, so the comparison
// a response decides with is the one the client printed its warning from.
//
// The header carries version numbers only, never a location or a package (R-BTN-197): no client
// acts on it beyond printing and stopping, so nothing here names where a version lives.

/** A version as semver writes it (spec.md §2 of semver.org): `MAJOR.MINOR.PATCH` with an
 *  optional `-prerelease` and an ignored `+build` — `0.1.4`, `0.1.4-rc.1`, `0.1.4+dev`. */
export function parseVersion(v) {
  if (typeof v !== 'string') return null;
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/.exec(v);
  if (!m) return null;
  // Precedence (semver §10): the numbers, then the prerelease — absent outranks present, numeric
  // identifiers compare as numbers, alphanumeric lexically. The build is parsed off and dropped.
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] === undefined ? null : m[4].split('.') };
}

/** Semver precedence: -1, 0 or 1. `+dev` takes no part (R-BTN-197). */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;   // an unparsable value compares as equal, never below: only a parsable floor refuses
  for (const k of ['major', 'minor', 'patch']) {
    if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  }
  if (x.pre == null && y.pre == null) return 0;
  if (x.pre == null) return 1;   // a release outranks its prerelease
  if (y.pre == null) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const l = x.pre[i];
    const r = y.pre[i];
    if (l === undefined) return -1;   // fewer identifiers rank lower when all before were equal
    if (r === undefined) return 1;
    const ln = /^\d+$/.test(l);
    const rn = /^\d+$/.test(r);
    if (ln && rn) {
      if (Number(l) !== Number(r)) return Number(l) < Number(r) ? -1 : 1;
    } else if (ln) return -1;   // numeric identifiers rank lower than alphanumeric
    else if (rn) return 1;
    else if (l !== r) return l < r ? -1 : 1;
  }
  return 0;
}

/** The higher of two versions by precedence (either unparsable: `a`). */
export function maxVersion(a, b) {
  return compareVersions(a, b) < 0 ? b : a;
}

/** The longest version a `Baton-Client` may name (R-BTN-197 with §13.3's R-BTN-33:
 *  `client_version` is a filter field, a short validated string, bounded like `session_name`'s
 *  1–128 — this one 64, the whole version including its `-prerelease` and `+build`). A longer
 *  claim is not a statement Baton reads: it compares as no header, is stored as NULL and echoes
 *  back as nothing, so no unbounded string reaches `runners.client_version`, a refusal's body or
 *  the Needs-you row. */
export const CLIENT_VERSION_MAX = 64;

/** The `Baton-Client` header's version (`baton/0.1.4+dev` → `0.1.4+dev`), or null for a header
 *  that does not say — absent, malformed, another product's or over `CLIENT_VERSION_MAX`. The
 *  caller's `0.0.0` default for a request without the header (R-BTN-197) is its own decision,
 *  made where the served floor is known. */
export function clientVersionOf(header) {
  if (typeof header !== 'string') return null;
  const m = /^baton\/(\S+)$/.exec(header.trim());
  return m && parseVersion(m[1]) && m[1].length <= CLIENT_VERSION_MAX ? m[1] : null;
}

/** `Baton-Client-Versions` as Baton writes it: version numbers only (R-BTN-197). */
export function clientVersionsValue({ min, recommended }) {
  return `min=${min}, recommended=${recommended}`;
}

/** A `Baton-Client-Versions` header read back: `{min, recommended}`, or null when it names
 *  neither version — an intermediary's answer, not Baton's. */
export function parseClientVersions(header) {
  if (typeof header !== 'string') return null;
  const min = /(?:^|,\s*)min=([^\s,]+)/.exec(header);
  const rec = /(?:^|,\s*)recommended=([^\s,]+)/.exec(header);
  return min && rec ? { min: min[1], recommended: rec[1] } : null;
}
