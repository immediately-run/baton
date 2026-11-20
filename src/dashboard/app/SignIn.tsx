// SignIn.tsx — the sign-in screen (B-206 item 4, on what exists today — R-BTN-57's one-time
// link): a key holder runs the one CLI line, which mints a link and prints it; the link's token
// rides in the URL fragment, the page posts it to `POST /v1/login` and Baton answers the session
// cookie. Drawn at `/login`, and in place on any screen whose read answers `unauthenticated` —
// the URL stays, and the screen continues once a session stands. No return URL is carried
// anywhere (an open-redirect surface). The shell holds no key and reads no secret.
//
// Role-aware (R-BTN-155): each role is one row of `SIGN_IN_ROLES`. Only an administrator's
// sign-in exists; the owner's — and the confirmed-code flow, `POST /v1/login {role}` with its
// polling — is B-76's, and is added as a row and a `flow` here, not as a second screen.
import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiGet, asApiError } from '../lib/api';
import type { SessionRole } from '../lib/types';
import { CliLine, ErrorNote } from '../lib/ui';

export interface SignInRole {
  role: SessionRole;
  /** The heading's words: "Sign in as an administrator". */
  as: string;
  /** The one CLI line that signs this role in. */
  cli: string;
  /** How the role signs in: `link` — the one-time link (R-BTN-57). B-76 adds `code`. */
  flow: 'link';
}

/** The roles that can sign in today. B-76 appends the owner's. */
export const SIGN_IN_ROLES: readonly SignInRole[] = [
  { role: 'administrator', as: 'an administrator', cli: 'baton admin open', flow: 'link' },
];

/** A role named in `/login?as=…` that no sign-in exists for yet, with the ticket that builds it. */
const NOT_BUILT: Partial<Record<string, string>> = { owner: 'B-76' };

/** The link's token, as `baton admin open` writes it: the URL's fragment, 64 hex characters. */
export function tokenOf(hash: string): string | null {
  const m = /^#([0-9a-f]{64})$/.exec(hash);
  return m ? m[1] : null;
}

/** Does a session stand? `GET /v1/ui/session` — one row's cost. */
export async function sessionStands(): Promise<boolean> {
  try {
    await apiGet('/v1/ui/session');
    return true;
  } catch (e) {
    const error = asApiError(e);
    if (error.code === 'unauthenticated') return false;
    throw error;
  }
}

export function SignIn({ inPlace, as, error, onSignedIn }: { inPlace: boolean; as?: string | null; error?: ApiError | null; onSignedIn: () => void }) {
  const [note, setNote] = useState<string | null>(null);
  const [fault, setFault] = useState<ApiError | null>(null);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async (asked: boolean) => {
    setChecking(true);
    try {
      if (await sessionStands()) onSignedIn();
      else if (asked) setNote('No session yet: open the link the command prints in this browser.');
      setFault(null);
    } catch (e) {
      setFault(asApiError(e));
    } finally {
      setChecking(false);
    }
  }, [onSignedIn]);

  // The link opens in another tab of this browser and the cookie is this origin's: when this
  // tab is shown again, look once. No timer runs while signed out.
  useEffect(() => {
    const onShow = () => {
      if (document.visibilityState !== 'hidden') void check(false);
    };
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('focus', onShow);
    return () => {
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('focus', onShow);
    };
  }, [check]);

  const roles = SIGN_IN_ROLES.filter((r) => !as || r.role === as);
  const missing = as ? NOT_BUILT[as] : undefined;
  return (
    <main className="signin" aria-labelledby="signin-h">
      <h1 id="signin-h">Sign in to Baton</h1>
      <p className="page-sub">{inPlace ? 'Your session ended, or there is none. Sign in and this page continues where it is.' : 'The dashboard opens with a one-time link from a key holder’s terminal.'}</p>
      {error ? <ErrorNote error={error} what="The link did not sign in" /> : null}
      {missing ? <p className="band band-warn">Signing in as {as === 'owner' ? 'an owner' : as} is not built yet (<span className="mono">{missing}</span>). An administrator’s sign-in is below.</p> : null}
      {(roles.length ? roles : SIGN_IN_ROLES).map((r) => (
        <section key={r.role} className="card signin-role" aria-labelledby={`signin-${r.role}`}>
          <h2 id={`signin-${r.role}`}>Sign in as {r.as}</h2>
          <p>Run this where your key is:</p>
          <p><CliLine>{r.cli}</CliLine></p>
          <p className="mut">It prints a link that works once, for five minutes. Open it in this browser: the link signs the browser in, and nothing is typed here.</p>
        </section>
      ))}
      <p className="signin-continue">
        <button type="button" className="btn btn-primary" disabled={checking} onClick={() => void check(true)}>I have signed in — continue</button>
      </p>
      {note ? <p className="mut" role="status">{note}</p> : null}
      {fault ? <ErrorNote error={fault} /> : null}
    </main>
  );
}
