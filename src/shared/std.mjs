// std.mjs — Baton's standard output formats (BATON_SPEC §2m.2 R-BTN-110; B-3): the `std:`
// schemas Baton ships beside its CLI, which a course refines by `x-baton-base` and a sync may
// never post. To core each is a string with a digest (R-BTN-50); what a field means is the
// library's. A published version never changes — a new field is a new version.
//
// Each schema is bounded as R-BTN-108 asks of a stored inline value: closed objects, strings of
// at most 256 characters.

const str = (extra = {}) => ({ type: 'string', minLength: 1, maxLength: 256, ...extra });
const sha = str({ pattern: '^[0-9a-f]{40}([0-9a-f]{24})?$' });
const repository = str({ description: 'the repository as the course names it' });
const closed = (properties, required) => ({ type: 'object', additionalProperties: false, properties, required });

/** id → schema. */
export const STD = Object.freeze({
  'std:git.commit@1': closed({ repository, sha }, ['repository', 'sha']),
  'std:git.file@1': closed({ repository, commit: sha, path: str(), blob: sha }, ['repository', 'commit', 'path']),
  'std:forge.change@1': closed({
    repository, number: { type: 'integer', minimum: 1 }, url: str({ format: 'uri' }), head_sha: sha,
    state: { type: 'string', enum: ['open', 'closed', 'merged', 'draft'] },
  }, ['repository', 'number', 'url', 'head_sha', 'state']),
  'std:forge.comment@1': closed({ url: str({ format: 'uri' }), change: str({ format: 'uri' }), author: str() }, ['url']),
  'std:forge.check@1': closed({
    repository, sha, name: str(), conclusion: { type: 'string', enum: ['success', 'failure', 'neutral', 'cancelled', 'skipped', 'timed_out', 'action_required'] },
    check_id: str(),
  }, ['repository', 'sha', 'name', 'conclusion']),
  'std:object@1': closed({
    uri: str({ format: 'uri' }), digest: str({ pattern: '^sha256:[0-9a-f]{64}$' }), media_type: str(), size: { type: 'integer', minimum: 0 },
  }, ['uri', 'digest', 'media_type', 'size']),
  'std:url@1': closed({ url: str({ format: 'uri' }) }, ['url']),
  'std:effect@1': closed({ kind: str(), ref: str(), at: str({ format: 'date-time' }) }, ['kind', 'at']),
  'std:decision@1': closed({ id: str(), option: str(), answered_by: str(), commit: sha }, ['id', 'option', 'commit']),
  // B-105 (R-BTN-176): the base an API-capacity resource's schema refines. Not an output schema:
  // a DETAIL schema in R-BTN-76's subset, which an external resource's readings carry — so it
  // uses only that subset's keywords (no `pattern`, no `format`) and a fraction in fixed point
  // (`remaining_permille`), as R-BTN-176 asks. A refining schema tightens it (R-BTN-108).
  'std:api-capacity@1': {
    type: 'object', additionalProperties: false,
    properties: { remaining_permille: { type: 'integer', minimum: 0, maximum: 1000 } },
    required: ['remaining_permille'],
  },
});

/** A `std:` schema, or null. */
export const stdSchema = (id) => (Object.prototype.hasOwnProperty.call(STD, id) ? STD[id] : null);
