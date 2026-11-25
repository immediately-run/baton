// Refusal.tsx — §11.4's two refusals, one component, one wording (B-221): a repository the
// session cannot read, or none — "This repository is not yours or does not exist", linking `/`;
// an entity not found in a readable repository — "No such ticket" (condition, runner, course,
// goal alike) with the id as text. A path that is no screen at all says so the same way.
import type { ReactNode } from 'react';
import type { ApiError } from '../lib/api';
import { ErrorNote, Loading } from '../lib/ui';
import type { Read } from '../lib/reads';
import { Link } from './router';

export const REPOSITORY_REFUSED = 'This repository is not yours or does not exist';

/** The repository refusal (`forbidden` on a repository read, or a repository `repo.list` does
 *  not carry). */
export function RepositoryRefusal({ id }: { id?: string }) {
  return (
    <div className="refusal" role="alert">
      <h1>{REPOSITORY_REFUSED}</h1>
      {id ? <p className="mono">{id}</p> : null}
      <p><Link to="/">Your repositories</Link></p>
    </div>
  );
}

/** "No such ticket" — `entity` is Baton's own word for the kind (ticket, condition, runner,
 *  course, goal), `id` the id the URL named, drawn as text. */
export function NotFound({ entity, id, back }: { entity: string; id?: string; back?: { to: string; label: ReactNode } }) {
  return (
    <div className="refusal" role="alert">
      <h1>No such {entity}</h1>
      {id ? <p className="mono">{id}</p> : null}
      {back ? <p><Link to={back.to}>{back.label}</Link></p> : null}
    </div>
  );
}

/** A URL that names no screen of §11.4. */
export function NoPage({ path }: { path: string }) {
  return <NotFound entity="page" id={path} back={{ to: '/', label: 'Your repositories' }} />;
}

/** The refusal screen an error calls for, or null where it is not one of the two: `forbidden`
 *  is the repository's, `not-found` the entity's. */
export function refusalOf(error: ApiError | null, entity: string, id?: string, back?: { to: string; label: ReactNode }): ReactNode | null {
  if (!error) return null;
  if (error.code === 'forbidden') return <RepositoryRefusal />;
  if (error.code === 'not-found') return <NotFound entity={entity} id={id} back={back} />;
  return null;
}

/** A screen's main read, gated: loading until it answers, the two refusal screens for
 *  `forbidden` and `not-found`, any other refusal as its code and message when no answer is
 *  held — and otherwise the children, drawn from the last good answer (a later error shows in
 *  the sidebar's freshness line while the data stays). `unauthenticated` never reaches here:
 *  the shell draws the sign-in in place. */
export function ReadGate<T>({ read, entity, id, back, children }: { read: Read<T>; entity: string; id?: string; back?: { to: string; label: ReactNode }; children: (data: T) => ReactNode }) {
  const refusal = refusalOf(read.error, entity, id, back);
  if (refusal) return <>{refusal}</>;
  if (read.data === undefined) {
    if (read.error) return <ErrorNote error={read.error} />;
    return <Loading />;
  }
  return <>{children(read.data)}</>;
}
