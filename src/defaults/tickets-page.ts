// tickets-page.ts — the "How tickets work" page `baton repo init` writes into a repository's items
// folder (B-112, BATON_SPEC §2f R-BTN-74): the same text in every repository — the frontmatter keys
// and statuses; the id prefix and the accepted legacy patterns, read from that repository's
// `.baton/baton.json`; the tags Baton reads; the body's header lines; projects; and the commands.
// Written, never edited: `baton tickets check` reports a page that differs from the text this
// release generates, so docs, baton and fieldhouse cannot diverge on how a ticket is written.
// Pure over the settings, so the page and its check are tested without a repository.
import { TAGS, type TicketSettings } from './tickets-config';

/** The page's file name, in the items folder: a `.md` page — not an `.mdx` one — so a wiki that
 *  links only its `.mdx` pages does not place it on a nav, as `tickets/README.md` is not. */
export const PAGE_NAME = 'HOW-TICKETS-WORK.md';

/** The generated page, for a repository whose `.baton/baton.json` holds `settings`. Every sentence
 *  about the ids, the tags and the project is derived from the settings, so the two cannot
 *  disagree. */
export function ticketsPage(settings: TicketSettings): string {
  const items = (settings.items ?? 'tickets').replace(/\/$/, '');
  const prefix = `${(settings.ticket_prefix ?? 'B').replace(/-$/, '')}-`;
  const legacy = Object.keys(settings.prefixes).filter((p) => p !== prefix).sort();
  const project = settings.project;
  return [
    '# How tickets work',
    '',
    '<!-- Written by `baton repo init`; do not edit it here. `baton tickets check` reports a page',
    "that differs from this release's text, and `baton repo init --force` writes it again. -->",
    '',
    `A ticket is one \`.mdx\` file in \`${items}/\`, named after its id, whose frontmatter carries`,
    'an `id`. `baton repo sync` reads every file under that folder at any depth — done tickets sit',
    'in `archive/` — and posts the tickets to Baton; the body is for people, and Baton never stores it.',
    '',
    '## Frontmatter',
    '',
    '| key | what Baton reads |',
    '|---|---|',
    '| `id` | the ticket’s id; the file is named after it |',
    '| `title` | its title on the board |',
    '| `status` | `available`, `in-progress`, `in-review` and `deprioritized` are live; `done` is done, in `archive/`; `deferred` and `superseded` are closed as withdrawn |',
    '| `depends_on` | the tickets this one waits for: it is offered only once each is done |',
    '| `order` | where it ranks on the board, lower first |',
    '| `tags` | the tags Baton reads, below |',
    '| `requires` | capability names a runner must hold to be offered the ticket |',
    '| `repos` | the other repositories its work changes, as `owner/name` or a short name `.baton/baton.json` maps |',
    '| `course` | the course it runs; `default_course` when it names none |',
    '| `parent`, `not_before` | a child ticket’s parent, and the earliest time it may be offered |',
    '| `project`, `prs`, `answer` | read by the courses and by this page, never posted |',
    '',
    'Every other key is ignored, so a repository may carry its own.',
    '',
    '## Ids',
    '',
    `New tickets take \`${prefix}<n>\`, the next free number across \`${items}/\` and \`${items}/archive/\`.`,
    ...(legacy.length
      ? [`Ids under ${legacy.map((p) => `\`${p}\``).join(', ')} are still accepted — a ticket may be named by one — but \`baton tickets new\` never allocates them.`]
      : ['No other id prefix is accepted in this repository.']),
    `\`.baton/baton.json\` sets \`ticket_prefix\`${legacy.length ? ' and `legacy_ids`' : ''}; changing them renames no ticket already filed.`,
    '',
    '## Tags Baton reads',
    '',
    ...TAGS.map((t) => `- \`${t.tag}\` — ${t.means}.`),
    '',
    'Another tag is the repository’s own ranking word; Baton reads it nowhere.',
    '',
    '## The body’s header lines',
    '',
    '- `**Depends on:**` names exactly the ticket’s `depends_on`, and nothing else — `none.` when',
    '  there is nothing to wait for. It runs to the next blank line or `**Label:**` line, and a',
    '  dependency written only in prose is one the cycle check cannot see. With `check.depends_line`',
    '  on in `.baton/baton.json`, `baton tickets check` holds the line to the frontmatter.',
    '- `**Used by:**` names the tickets that depend on this one: the reverse mention, kept by the',
    '  ticket that adds the dependency, so a file says who waits on it without a search.',
    '- `**Waits on:**` names work outside this repository — another repository’s ticket, a spec, a',
    '  decision — since `depends_on` and its relations stay inside one repository (`BATON_SPEC` §4).',
    '',
    '## Projects',
    '',
    'A ticket names a project — a page in the items folder’s projects/ folder whose frontmatter',
    'says `kind: project` — when its work belongs with other tickets’ work. Choose or create the',
    'project **before filing**: a session is the moment it is plain which tickets belong together,',
    'and a project page written afterwards leaves the tickets it was meant to group ungrouped.',
    project
      ? `This repository’s default project is \`${project}\`: \`baton tickets new\` writes it when \`--project\` names none.`
      : 'This repository names no default project: `baton tickets new` needs `--project`, or a `project` in `.baton/baton.json`.',
    '',
    '## The commands',
    '',
    'Each command is one commit pushed straight to the default branch, made in a throwaway worktree',
    'at the freshly fetched head: your own branch and working tree are never touched. A push refused',
    'because the branch moved is fetched again and retried on the new head.',
    '',
    '```sh',
    `baton tickets new --title "…" --project ${project ?? '<id>'}    # file a ticket, ${prefix}<n>, with the conventional body`,
    'baton tickets claim <id>                   # available → in-progress; refuses a ticket not available,',
    '                                           # or one whose dependencies are not done',
    'baton tickets set <id> <status> [--pr URL] # any live status; --pr adds a pull request URL',
    'baton tickets done <id> [--pr URL]         # done, moved to archive/',
    'baton tickets check [--repo DIR]           # check the tickets without posting them',
    '```',
    '',
    '`baton tickets --help` lists every flag, the tags Baton reads and the `Requires:` clause a',
    'description ends with.',
    '',
  ].join('\n');
}
