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
    // Plain prose, not an HTML comment: a `render: safe` bundle's parser rejects `<!--`, and the
    // page then renders blank (R3-1340). The note is meant to be read anyway.
    '_Written by `baton repo init`; do not edit it here. `baton tickets check` reports a page',
    "that differs from this release's text, and `baton repo init --force` writes it again._",
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
    '| `status` | `available`, `in-progress`, `in-review` and `deprioritized` are live; `done` is done, in place or in `archive/`; `deferred`, `withdrawn` and `superseded` are closed as withdrawn |',
    '| `depends_on` | the tickets this one waits for: it is offered only once each is done — another repository’s by its qualified id `<repository>:<id>` |',
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
    `New tickets take \`${prefix}<n>\` from Baton's sequence, unique across concurrent branches:`,
    `\`dibber new\` asks for it through \`.dibber/config.json\`'s coordinator, \`baton tickets next`,
    `ticket-<prefix> --coordinator\`, and refuses when Baton does not answer; only \`dibber new`,
    `--offline\` takes the next free number by a scan of \`${items}/\` and the branches.`,
    ...(legacy.length
      ? [`Ids under ${legacy.map((p) => `\`${p}\``).join(', ')} are still accepted — a ticket may be named by one — but Baton never allocates them.`]
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
    '- A dependency on **another repository’s ticket** is `depends_on: [<repository>:<id>]` — as',
    '  `baton:B-111` — named the same way on the `**Depends on:**` line: the ticket is offered',
    '  once the target is done on its own board, and the repository must be one `.baton/baton.json`’s',
    '  `repos` map names. `parent` stays inside this repository, and so does every unqualified id.',
    '- `**Waits on:**` names work no dependency can carry — a spec, a decision — since every',
    '  ticket-to-ticket wait is `depends_on`, local or qualified (`BATON_SPEC` §4).',
    '',
    '## Projects',
    '',
    'A ticket names a project — a page in the items folder’s projects/ folder whose frontmatter',
    'says `kind: project` — when its work belongs with other tickets’ work. Choose or create the',
    'project **before filing**: a session is the moment it is plain which tickets belong together,',
    'and a project page written afterwards leaves the tickets it was meant to group ungrouped.',
    project
      ? `This repository’s default project is \`${project}\`: file with \`dibber new --project ${project}\` unless the ticket belongs elsewhere.`
      : 'This repository names no default project: name one with `dibber new --project <id>`.',
    '',
    '## The commands',
    '',
    'Dibber writes the ticket files; Baton reads them, hands out their numbers and holds the claims.',
    'Every write lands in your working tree: commit it and push it — a filing alone, on its own',
    '`baton-ticket/<id>` branch, through a pull request.',
    '',
    '```sh',
    `dibber new --title "…" --project ${project ?? '<id>'} --body-file F  # file a ticket, ${prefix}<n> from Baton's sequence`,
    'baton tickets check <id> --claimable [-i KEY]  # may it be claimed? asks Baton first — a ticket past',
    '                                               # its course\'s start is a takeover, its PRs and branch',
    '                                               # printed; refuses one citing a rule amended since it',
    '                                               # was filed, until a rules re-read note names the ids',
    'dibber claim <id>                              # available → in-progress',
    'dibber set <id> <status> [--pr URL] [--note T] # any status; --pr adds a pull request URL',
    'dibber done <id> [--pr URL]                    # done',
    'baton tickets check [--repo DIR]               # check the tickets without posting them',
    '```',
    '',
    '`check --claimable` reads the ticket from Baton with the key `-i` names (else `BATON_KEY_FILE`)',
    'and writes nothing: a ticket Baton holds past its course\'s start is continued there — never',
    'started over; another live claim, an undone dependency, the git lock or a parked status is not',
    'claimable, and an unanswered read (Baton unreachable, no key) exits 2 unless `--offline` judges',
    'git\'s word alone. A rule re-read is recorded with',
    '`dibber set <id> --note "rules re-read: <ids>"`.',
    '',
    'A ticket carries `### Trust` (every new input it adds, who may write it, how it is',
    'verified) and `### Invariants` (the rules it must not break, by id); with `check.sections_since`',
    'set, `baton tickets check` fails a ticket filed on or after that day without them, or with either',
    'still empty or a placeholder. A ticket is dated by the later',
    'of its `_filed` Status line and its file’s first commit. With `check.sections_from_id` set (an',
    'id, `B-176`), every ticket at or above that id must carry a `_filed` Status line, so a',
    'shallow clone such as CI’s judges it; one below it with no `_filed` line, or under another prefix,',
    'is dated by its first commit, which a shallow clone cannot show, and is then listed, not judged.',
    'A request ticket (`tags: [request]`) is not judged: its course’s legs write the tickets that',
    'are, a child a leg files (`parent:`) included.',
    '',
    '`baton tickets --help` and `dibber --help` list every flag; `baton tickets --help` also lists the',
    'tags Baton reads.',
    '',
  ].join('\n');
}
