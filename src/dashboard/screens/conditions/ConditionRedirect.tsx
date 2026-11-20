// ConditionRedirect.tsx — `/conditions/{id}`, the address a notification carries (B-195;
// R-BTN-163). The front answers it with a redirect when the request is one R-BTN-16 admits
// for a session; a link opened from elsewhere arrives without the cookie (it is SameSite
// Strict) and gets the shell, which lands here once the session stands: one read —
// `condition.locate`, the session's repositories only — then the condition's own page in the
// tree. An id the session does not hold is "No such condition", the same as none.
import { useEffect } from 'react';
import { NotFound } from '../../app/Refusal';
import { navigate, pathOrNull } from '../../app/router';
import { useRead } from '../../lib/reads';
import { ErrorNote, Loading } from '../../lib/ui';

/** The id `/conditions/{id}` names, or null for any other path. */
export function conditionAddress(pathname: string): string | null {
  const m = /^\/conditions\/([A-Za-z0-9][A-Za-z0-9._:-]{0,127})$/.exec(pathname);
  return m ? m[1] : null;
}

export function ConditionRedirect({ id }: { id: string }) {
  const read = useRead<{ repository?: unknown; condition_id?: unknown }>(`/v1/conditions/${encodeURIComponent(id)}`);
  // The tree path is built here from the read's two ids, each id-shaped or no link at all —
  // never navigated to as the read spelt it.
  const to = read.data && typeof read.data.repository === 'string'
    ? pathOrNull('repository/conditions/{condition}', { repository: read.data.repository, condition: String(read.data.condition_id ?? id) })
    : null;
  useEffect(() => {
    if (to) navigate(to, { replace: true });
  }, [to]);
  if (to) return <Loading what="the condition" />;
  if (read.error?.code === 'not-found' || read.error?.code === 'forbidden' || read.data !== undefined) return <NotFound entity="condition" id={id} back={{ to: '/', label: 'Your repositories' }} />;
  if (read.error) return <ErrorNote error={read.error} />;
  return <Loading what="the condition" />;
}
