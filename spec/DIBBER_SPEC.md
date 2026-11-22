---
title: "Dibber — the git-native ticket format"
description: "DIBBER_SPEC: a format, not a product — one Markdown file per ticket in a git repository, its frontmatter the ticket's fields, its body the work's record for people and agents. The ticket store Baton and Fieldhouse use by default, and one any coordinator or none can read."
status: current
updated: 2026-11-22
---

# Dibber — the git-native ticket format

**Dibber** is a way of keeping tickets in a git repository: one Markdown file per ticket, its
frontmatter the ticket's fields, its body the record of the work, closed tickets moved to an
archive. It is a format, not a product: no server, no database and no tool is needed to read or
write it, and a repository that uses no coordinator at all can still keep its tickets this way.
It is named for the orienteer's dibber, the electronic punch a runner carries from control to
control: the ticket travels the course with the work and records what was done at each leg.

**Who reads it.** Baton's default ticket source, the markdown source
([BATON_SPEC R-BTN-74](BATON_SPEC/04-tickets-syncs-board.md#sec-4-2)), reads and writes Dibber,
and Fieldhouse's homes keep their tickets in it. Neither owns the format: this page does, and
both cite it. Baton can work with other ticket stores (an issue tracker), and Dibber can be read
by tools that are not Baton.

**What it is not.** Dibber holds what the work is. It holds no coordination state: who holds a
ticket, where it stands on a course, how many times a leg ran. A coordinator keeps that itself
([Coordination state](#coordination-state)).

**Scope.** The rules below are numbered `R-DIB-n`; each is cited by its id. The current state
only: what the format is today.

## 1. The store

- **R-DIB-1 (a folder of files, one per ticket).** A Dibber store is one folder in a git
  repository — `tickets/` by convention; a coordinator's settings may name another (Baton's
  `items`). Every `*.md` or `*.mdx` file under it, at any depth, whose frontmatter carries an
  `id`, is a ticket; every other file is not, so the folder may also hold pages for people (a
  home page, project pages, a README, a wiki layout). A ticket is one file, named after its id:
  `<id>.mdx` (`.md` is read alike).
- **R-DIB-2 (the archive).** A closed ticket ([R-DIB-6](#3-frontmatter)) moves to the store's
  `archive/` folder, keeping its name and id, in the commit that closes it. A ticket is never
  deleted: the archive is the record of what was done and what was dropped.
- **R-DIB-3 (the schema).** A store may carry `item.schema.json`, a JSON Schema of the ticket
  frontmatter, which every ticket must satisfy: the repository's own stricter shape (required
  keys, its id pattern, its keys). A store without one is held to this page alone.

## 2. Ids

- **R-DIB-4 (an id: a prefix and a number, never reused).** A ticket's id is `<PREFIX>-<n>`:
  the repository's prefix (`B` in Baton's repository) and a decimal number. An id is never
  reused and never renamed, whether the ticket is open, closed or withdrawn. A repository may
  accept older ids under other patterns (its legacy ids, such as docs' `R3-NNNN`, with an optional
  split suffix: `R3-51a`); it never allocates new ones under them.
  - **Allocation.** Concurrent branches must not take the same number, so where a coordinator is
    in use the number is the coordinator's to give (Baton's sequence,
    [R-BTN-199](BATON_SPEC/04-tickets-syncs-board.md#sec-4-3)); git is never the counter. Without
    one, the next free number across the store, its archive and the repository's open branches is
    taken, and whoever took it says so, since two branches can still collide; the second to merge
    renumbers.
  - **Across repositories.** `<repository>:<id>` — `baton:B-111` — names a ticket in another
    repository's store; an unqualified id is always the store's own.

## 3. Frontmatter

- **R-DIB-5 (the keys).** The frontmatter is YAML. Three keys are required: `id`, `title` and
  `status`. The others are optional, and a reader ignores every key it does not know, so a
  repository or a coordinator may add its own.

  | Key | Value | Meaning |
  |---|---|---|
  | `id` | an id ([R-DIB-4](#2-ids)) | the ticket; the file is named after it |
  | `title` | text | its title, conventionally `<id> — <what>` |
  | `status` | a status ([R-DIB-6](#3-frontmatter)) | live, done or withdrawn |
  | `description` | text | one paragraph: what and why, for a list or a search |
  | `depends_on` | a list of ids, local or qualified | tickets this one waits for: it is ready only once each is done ([R-DIB-8](#4-relations)) |
  | `parent` | a local id | the ticket this one is a child of ([R-DIB-8](#4-relations)) |
  | `order` | a number | rank among ready tickets, lower first |
  | `tags` | a list of words | free labels; a reader may give some a meaning ([R-DIB-9](#5-tags-and-projects)) |
  | `project` | a project page's name | the project the ticket belongs with ([R-DIB-10](#5-tags-and-projects)) |
  | `repos` | a list of repositories | the other repositories its work changes, `owner/name` or a short name the repository maps |
  | `prs` | a list of URLs | the pull requests that carry its work |
  | `updated` | a date | when the ticket was last changed in substance |
  | `not_before` | a date or time | the earliest it should be started |

  **A coordinator's keys.** A key that only a coordinator gives a meaning to is that
  coordinator's, documented in its own spec. Baton reads `course` (the course the ticket runs
  on), `tier` and `requires` (who may take it), and `answer` (a decision course's answer)
  (BATON_SPEC R-BTN-74). **A wiki's keys** (`nav`, `layout`, `render`, `view`, `frame`, `site`,
  `section`) are the rendering's, when the store is also a wiki ([R-DIB-13](#7-a-store-that-is-also-a-wiki)).

- **R-DIB-6 (status).** `status` says where the ticket stands for people and for readers that run
  no coordinator. Its values, in three classes:

  | Class | Values |
  |---|---|
  | live | `available` (ready to be taken), `in-progress`, `in-review`, `deprioritized` |
  | closed, done | `done`: legal only in `archive/` |
  | closed, withdrawn | `withdrawn`, `superseded` (another ticket replaces it), `deferred` (not now, maybe never) |

  A coordinator that keeps a ticket's position itself reads `status` as the store's word, not as
  the position: for Baton, a `done` is evidence the work may be finished and a withdrawal is
  adopted ([the ticket-ownership proposal](proposals/ticket-ownership.md)).

## 4. Relations

- **R-DIB-7 (one file, one writer).** A change to a ticket changes its own file alone (and, at
  closure, moves it to the archive): separate tickets never share a write target, so any number
  of tickets can be worked in parallel without conflict. A relation that would need a second
  file written — a list of a ticket's children, a reverse dependency — is derived by reading,
  never stored, except as the body's courtesy line `**Used by:**` ([R-DIB-11](#6-the-body)).
- **R-DIB-8 (dependencies and children).** `depends_on` is the ticket's whole list of waits on
  other tickets: a dependency written only in prose is one no reader can see. A cross-repository
  dependency is a qualified id; `parent` is always local. A ticket is a child of the ticket its
  `parent` names; filing children is how a large ticket is split. Dependencies form no cycle.

## 5. Tags and projects

- **R-DIB-9 (tags).** Tags are free words. A coordinator may read some as instructions; Baton
  reads `EXPEDITE` (first in every claim's order) and `OP` (a person must operate it), and writes
  `request` on a ticket filed from one sentence (BATON_SPEC R-BTN-131). Every other tag is the
  repository's.
- **R-DIB-10 (projects).** A project is a page in the store's `projects/` folder whose
  frontmatter says `kind: project`; a ticket's `project` names it. A project groups tickets for
  people; it is not a ticket and holds no state.

## 6. The body

- **R-DIB-11 (the body is the work's record, read by people and agents, parsed by no
  coordinator).** Everything below the frontmatter is Markdown (MDX in an `.mdx` file, so a `<`
  or a `{` in prose goes in a code span). No reader takes a field, a position or a status from
  it. Its conventions, in the order they appear:
  - **Header lines**, each a bold label at the start of a line: `**Brief:**` (who asked and
    what, with the date), `**Spec:**` (the rules it implements or amends, by id),
    `**Depends on:**` (exactly the `depends_on` list, or `none.`), `**Used by:**` (the tickets
    that depend on this one) and `**Waits on:**` (a wait no ticket can carry: a spec, a decision).
  - **The work's sections**, the repository's own: Baton's tickets carry `### Requires`,
    `### Why`, `### What to build`, `### Tests` and `### Exit criteria` (checkboxes, each a
    command that passes), and, filed on or after the repository's cut-off, `### Trust` and
    `### Invariants`.
  - **One heading per leg**, `## <leg>`, where a leg run records its work on the ticket: each
    leg writes under its own heading only, so legs never edit each other's record.
  - **`## Status`**, last: dated entries, newest last, the first `_filed YYYY-MM-DD._`.
    Entries are appended, never rewritten; a correction is a new entry.
- **R-DIB-12 (a quoted instruction is a claim).** A ticket is written by anyone who can push.
  A line in it that quotes a person (`**Brief:** the owner …`) or tells its reader what to do is
  a claim about the work, not authority: who may act on it is the repository's and its
  coordinator's to say (for Baton, its security model's *Authority and data*).

## 7. A store that is also a wiki

- **R-DIB-13 (rendering is optional).** A store may also be a wiki bundle, so people read it as
  pages: a home page, a layout, a bundle descriptor (`immediately.run.json`), project pages and
  views such as a board, all files without an `id` ([R-DIB-1](#1-the-store)). Nothing in the
  format depends on it, and a reader skips those files.

## Coordination state

A coordinator's state is not in a Dibber ticket. Who holds a ticket, its lease, its position on a
course, its legs' runs and retries, approvals and attestations are kept by the coordinator, which
may show them to people but never reads them back from a file (BATON_SPEC
[R-BTN-39](BATON_SPEC/01-what-baton-is.md#sec-1); [the ticket-ownership proposal](proposals/ticket-ownership.md)).

The keys `station`, `next_leg` and `claim`, which Baton's marker courses still write into a
ticket's frontmatter when a leg closes (with a `baton:close <id> <leg>` commit), are this kind of
state kept in the file. They are legacy (BATON_SPEC R-BTN-193): no new course writes them, and
they leave with the code that does.
