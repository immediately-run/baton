// GoalsScreen.tsx — `/repositories/{r}/goals` (B-198; BATON_SPEC §11.4). Goals are B-122's and
// B-122 is not built: no goal exists in Baton — no file is read for one, no row holds one, no
// read answers one. So this screen reads nothing and says so; it draws no goal, no progress and
// no count, and it does not repeat the board's ready order under another name. When B-122
// lands its `GET …/goals`, this file grows the cards the ticket describes.
import { Link, pathOrNull } from '../../app/router';
import { NotBuiltNote, PageHeader } from '../../lib/ui';
import type { ScreenProps } from '../contract';

export function GoalsScreen({ params }: ScreenProps) {
  const board = pathOrNull('repository/board', { repository: params.repository });
  const tickets = pathOrNull('repository/tickets', { repository: params.repository });
  return (
    <>
      <PageHeader title="Goals" sub="The repository’s objectives: each goal’s open work in Baton’s order, what is done, and what blocks it." />
      <NotBuiltNote what="The goals read" ticket="B-122" />
      <p className="hint">
        Baton holds no goal for this repository or any other, so there is nothing to list here.
        The open work in Baton’s order is on {board ? <Link to={board}>Board</Link> : 'Board'} and {tickets ? <Link to={tickets}>Tickets</Link> : 'Tickets'}.
      </p>
    </>
  );
}
