// std.mjs — Baton's standard output formats (BATON_SPEC §2m.2 R-BTN-110; B-3): the `std:`
// schemas Baton ships beside its CLI, which a course refines by `x-baton-base` and a sync may
// never post. To core each is a string with a digest (R-BTN-50); what a field means is the
// library's. A published version never changes — a new field is a new version.
//
// Each schema is bounded as R-BTN-108 asks of a stored inline value: closed objects, strings of
// at most 256 characters. Each carries a view (R-BTN-110, R-BTN-112; B-54), rendered by Baton's
// three renderers in src/shared/view.mjs — declaratively, so a course refines a `std:` schema and
// its view arrives with it.

const str = (extra = {}) => ({ type: 'string', minLength: 1, maxLength: 256, ...extra });
const sha = str({ pattern: '^[0-9a-f]{40}([0-9a-f]{24})?$' });
const repository = str({ description: 'the repository as the course names it' });
const closed = (properties, required) => ({ type: 'object', additionalProperties: false, properties, required });

/** id → schema. */
export const STD = Object.freeze({
  'std:git.commit@1': {
    ...closed({ repository, sha }, ['repository', 'sha']),
    'x-baton-view': { title: 'a commit in {/repository}', summary: '{/sha}', fields: [{ label: 'sha', pointer: '/sha', as: 'text' }] },
  },
  'std:git.file@1': {
    ...closed({ repository, commit: sha, path: str(), blob: sha }, ['repository', 'commit', 'path']),
    'x-baton-view': { title: '{/path}', summary: 'at {/commit} in {/repository}', fields: [{ label: 'path', pointer: '/path', as: 'text' }] },
  },
  'std:forge.change@1': {
    ...closed({
      repository, number: { type: 'integer', minimum: 1 }, url: str({ format: 'uri' }), head_sha: sha,
      state: { type: 'string', enum: ['open', 'closed', 'merged', 'draft'] },
    }, ['repository', 'number', 'url', 'head_sha', 'state']),
    'x-baton-view': {
      title: 'change #{/number} in {/repository}',
      fields: [
        { label: 'state', pointer: '/state', as: 'status', tones: { open: 'info', merged: 'ok', closed: 'warn', draft: 'info' } },
        { label: 'url', pointer: '/url', as: 'link' },
        { label: 'head', pointer: '/head_sha', as: 'text' },
      ],
    },
  },
  'std:forge.comment@1': {
    ...closed({ url: str({ format: 'uri' }), change: str({ format: 'uri' }), author: str() }, ['url']),
    'x-baton-view': { title: 'a comment', fields: [{ label: 'url', pointer: '/url', as: 'link' }, { label: 'author', pointer: '/author', as: 'text' }] },
  },
  'std:forge.check@1': {
    ...closed({
      repository, sha, name: str(), conclusion: { type: 'string', enum: ['success', 'failure', 'neutral', 'cancelled', 'skipped', 'timed_out', 'action_required'] },
      check_id: str(),
    }, ['repository', 'sha', 'name', 'conclusion']),
    'x-baton-view': {
      title: '{/name}',
      summary: 'a check in {/repository} at {/sha}',
      fields: [{ label: 'conclusion', pointer: '/conclusion', as: 'status', tones: {
        success: 'ok', failure: 'bad', timed_out: 'bad', action_required: 'warn', cancelled: 'warn', skipped: 'info', neutral: 'info',
      } }],
    },
  },
  'std:object@1': {
    ...closed({
      uri: str({ format: 'uri' }), digest: str({ pattern: '^sha256:[0-9a-f]{64}$' }), media_type: str(), size: { type: 'integer', minimum: 0 },
    }, ['uri', 'digest', 'media_type', 'size']),
    'x-baton-view': {
      title: '{/media_type}',
      summary: '{/digest}',
      fields: [{ label: 'size', pointer: '/size', as: 'number', unit: 'bytes' }, { label: 'uri', pointer: '/uri', as: 'link' }],
    },
  },
  'std:url@1': {
    ...closed({ url: str({ format: 'uri' }) }, ['url']),
    'x-baton-view': { title: 'a url', fields: [{ label: 'url', pointer: '/url', as: 'link' }] },
  },
  'std:effect@1': {
    ...closed({ kind: str(), ref: str(), at: str({ format: 'date-time' }) }, ['kind', 'at']),
    'x-baton-view': { title: '{/kind}', fields: [{ label: 'at', pointer: '/at', as: 'time' }, { label: 'ref', pointer: '/ref', as: 'text' }] },
  },
  // R-BTN-116: a person's answer to a person leg — `{id, leg, option, reached, ref?, answered_by?,
  // commit?}`. `ref` names the answer for R-BTN-39's idempotence and is required of a sync
  // attestation (the commit that wrote it), optional of a person's own; the fields are checked
  // against the leg's question and options when the answer is applied, not by this shape.
  'std:decision@1': {
    ...closed({
      id: str(), leg: str(), option: str(), reached: str(), ref: str(), answered_by: str(), commit: sha,
    }, ['id', 'leg', 'option', 'reached']),
    'x-baton-view': { title: '{/option}', summary: 'decision {/id}', fields: [{ label: 'answered by', pointer: '/answered_by', as: 'text' }, { label: 'reached', pointer: '/reached', as: 'text' }, { label: 'leg', pointer: '/leg', as: 'text' }] },
  },
  // B-105: the base an API-capacity resource's schema refines. Not an output schema: a DETAIL
  // schema in R-BTN-76's subset, which an external resource's readings carry — so it uses only
  // that subset's keywords (no `pattern`, no `format`) and a fraction in fixed point
  // (`remaining_permille`). The library's one OPEN schema: a provider's resource schema refines
  // it by adding fields, so `additionalProperties` is not false and a refinement must restate
  // the base's own bounds (R-BTN-108).
  'std:api-capacity@1': {
    type: 'object',
    properties: {
      window_s: { type: 'integer', minimum: 1 },
      remaining_permille: { type: 'integer', minimum: 0, maximum: 1000 },
      resets_at_min: { type: 'integer', minimum: 0 },
    },
    required: ['window_s', 'remaining_permille'],
    'x-baton-view': {
      title: 'API capacity',
      fields: [
        { label: 'remaining', pointer: '/remaining_permille', as: 'gauge', max: 1000, unit: '‰' },
        { label: 'window', pointer: '/window_s', as: 'number', unit: 's' },
        { label: 'resets at', pointer: '/resets_at_min', as: 'number', unit: 'min' },
      ],
    },
  },
});

/** A `std:` schema, or null. */
export const stdSchema = (id) => (Object.prototype.hasOwnProperty.call(STD, id) ? STD[id] : null);
