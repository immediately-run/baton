# Screens — the contract

One file per screen under `screens/<name>/`, registered by **one line** in `screens/index.ts`:
`export { BoardScreen as 'repository/board' } from './board/BoardScreen';` — the export's name is
the screen's `id` in `src/core/screens.ts`; a screen with no line draws "not built yet". A screen
may import a stylesheet of its own (`import './board.css'`).

## What a screen gets — `ScreenProps` (`./contract.ts`)
`screen` (its `screens.ts` entry), `params` (the URL's id-shaped segments: `repository`, and
`ticket` / `course` / `condition` / `runner`), `repository` (the `GET /v1/repositories` row for
`params.repository` — always set on a repository screen; null on root and tenant screens),
`repos` (the whole `repo.list` answer), `role` (`'administrator' | 'owner' | null`). The frame —
sidebar, strip, sign-in — is the shell's: a screen returns its content only, starting with
`<PageHeader title=… />`. Sidebar and strip counts come from `repo.list`; a screen supplies none.

## Reading — `lib/reads` (the one polling layer; never call `fetch` for a read)
```tsx
const read = useRead<Ticket>(`/v1/repositories/${params.repository}/tickets/${params.ticket}`);
const [a, b] = useReads([pathA, pathB]);          // fetched together; a null path waits
```
A `Read` is `{data, error, loading, okAt}`: polled every 10 s with `If-None-Match`, backing off
to 60 s while unchanged, paused while the tab is hidden. `data` is the last good answer and stays
through a later error (the sidebar's freshness line names it). `unauthenticated` never reaches a
screen: the shell draws sign-in in place. Gate the main read with `ReadGate` (`app/Refusal`): it
draws loading and §11.4's two refusals — `forbidden` → "This repository is not yours or does not
exist", `not-found` → "No such ticket" with the id as text:
`<ReadGate read={read} entity="ticket" id={params.ticket}>{(t) => <Body ticket={t} />}</ReadGate>`.
`encodeURIComponent` every value put in a read's path or query. A list with `next_cursor`:
`const pager = usePager()`, `pager.after` in the query, `<Pager pager={pager} next={data.next_cursor} />`.

## Drawing a value — text, never markup (§12.3; `test/ui/source-gate.test.ts` enforces it)
- `<Text value={x} />` (`lib/Text`; `mono` for ids) — any value from a read, as a text child.
  Plain `{row.title}` in JSX is a text child too; never build markup from a string.
- `<View value={v} schema={schemaId} repository={params.repository} />` (`lib/View`) — a value
  with a schema (a reading, a leg output, a condition's detail): R-BTN-112's view, else JSON.
  `<JsonText value={v} />` for any other blob.
- A link to another origin: `<ExtLink href={url}>…</ExtLink>` (`lib/links`; `kind="session"` for
  a session link; `showHost`) — a link only when it passes the link rule (`web_base`,
  `link_hosts`, `session_hosts` from `repo.list`), else text. A repository's forge page:
  `forgeHref(row.web_base)`. Never write `<a href={valueFromARead}>` yourself.
- A link inside the app: `<Link to={pathOf('repository/tickets/{ticket}', {repository, ticket})}>`
  (`app/router`; `pathOrNull` when an id comes from a read and may not be id-shaped; `navigate`).
- Course-agnostic: station, leg, tag and course names are data, never the screen's own words.
- A concept that is not built: `<NotBuiltNote what="Goals" ticket="B-122" />`. No mock rows.

## Controls — `app/controls/Controls` (B-207)
```tsx
<Controls view="repository/tickets/{ticket}" allowed={read.data.allowed}
  target={{ repository, ticket: qualifiedId, ticket_id: qualifiedId, to_runner_id, claim, reason: 'requested' }} />
```
Draws the session's `GET /v1/actions` entries whose `ui.view` names `view`; nothing else decides
what is shown. `target` fills the routes' `{param}`s (`{claim}` from `claim` or `claim_id`) and
the input fields of the same name; the fields it leaves become the form; an entry whose `{param}`
the target lacks is not drawn. Pass `allowed` only where the read carries one: then only the
entries it names are drawn. A destructive entry opens the confirm dialog (`confirm: true`), a
`202` the code dialog; on `200` every read refetches. `useControls(view, target, allowed)` gives
the list. A new control is a registry entry in `src/core/actions.ts` with `ui.view` — never a
hand-written `fetch` POST.

## Shared pieces — `lib/ui` (the mockup's language: dense, state by shape and label)
`PageHeader` (h1, sub, actions slot) · `Section` (h2, count, hint) · `Table` (a real table:
`label columns={[{head, cell, align?, width?, rowHeader?}]} rows rowKey empty`) · `Card`, `Cards` ·
`KeyValues` · `Band` (`tone="warn"`) · `StatusMark` (`tone`: ok ● run ◆ warn ▲ bad ■ mut ○, plus
its label — never colour alone) · `Badge` · `Tabs` · `FilterInput` · `usePager`, `Pager` ·
`Empty`, `Loading`, `ErrorNote`, `NotBuiltNote` · `RelTime`, `UtcTime` (epoch ms or s, or ISO) ·
`Mono`, `CliLine` (the CLI command that changes what a read-only screen shows). `lib/format`:
`relTime`, `span`, `utc`, `shortSha`, `count`. Tokens and classes: `styles/tokens.css`,
`styles/app.css` (`.mono`, `.mut`, `.tone-*`, `.btn`, `.input`). Hold at 375 px, light and dark.

## Testing a screen — `test/ui/<screen>.test.tsx` (vitest project `ui`: jsdom, mocked `fetch`)
```tsx
afterEach(() => { cleanup(); resetShell(); });
mockFetch({ '/v1/repositories/docs/tickets/R3-1': { id: 'R3-1' }, 'POST /v1/ui/x': () => refuse('conflict') });
renderWithShell(<TicketScreen {...props} />, { actions, repos: repoList([repoRow('docs')]) });
expect(await screen.findByText('R3-1')).toBeDefined();
```
`test/ui/helpers.tsx`: `mockFetch` (routes by `'METHOD /path'` or bare path; returns `calls`),
`refuse`, `repoRow`, `repoList`, `renderWithShell` (returns `store`; `await act(() =>
store.refresh())` polls now), `renderApp(path)` for the whole app. Test that a hostile string
stays text. Run `npx vitest run test/ui/<file> --project ui`.
