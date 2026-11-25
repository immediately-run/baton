// NotBuilt.tsx — what the router draws for a screen of `screens.ts` no component is registered
// for yet (B-221 item 1): the plain fact, with the screen's name and path. The screen tickets
// fill them, one line each in `screens/index.ts`.
import { PageHeader } from '../lib/ui';
import type { ScreenProps } from '../screens/contract';

export function NotBuilt({ screen }: ScreenProps) {
  return (
    <>
      <PageHeader title="This screen is not built yet" />
      <p>
        The dashboard has no page for <span className="mono">{screen.path}</span> yet (screen <span className="mono">{screen.id}</span>).
        The address is right and the rest of the dashboard works; this page arrives with its ticket.
      </p>
    </>
  );
}
