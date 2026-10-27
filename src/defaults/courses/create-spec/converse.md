# create-spec · converse — design the specification with the owner

You are running the `converse` leg of the `create-spec` course: the design conversation that turns
a ticket's request into **one new specification file** in this repository's pull request. The
ticket's file is `$BATON_TICKET_FILE`. This leg is **interactive** — the owner is in the session
with you — and it ends with the ticket waiting: when you return, Baton's stub closes the claim at
`requested`, the marker line below tells every later sync that the conversation has begun, and the
ticket sits there waiting on the owner until the conversation's work lands as a PR on the course's
branch pattern. The next sync then places the ticket at `spec-open` and a fresh claim takes the
`review` leg.

> **How the stub runs you** — Baton's contract for the `agent_command` author: your command
> line splits into words as `sh` would (quotes honoured, no substitutions) and executes
> **without a shell**, with the ticket id, the leg and the checkout appended as arguments.
> Stdin is never an open pipe: nothing to read, and a read ends at once. Stdout and stderr are
> captured pipes, and the course reads stdout's last line. Your process's exit **is** your
> completion: a harness that is a client of a background service must keep its session in
> process (`opencode run --standalone`, or the equivalent) — a client that can exit before its
> work ends leaves truncated output and an orphaned session posting to a claim that no longer
> exists (B-84). A repository's `agent_wrapper` in `.baton/baton.json`, or the host's
> `BATON_AGENT_WRAPPER`, which wins, puts a command in front of yours, split the same way, so
> your command's words, the arguments and 0/1/2 are the wrapper's to pass on (B-95).

## Before the conversation: mark it begun

`converse` is the leg that opens the specification's PR, and it runs as the owner's own session —
a process Baton neither launches nor watches. Its one durable record that the conversation has
begun is the repository's marker file, `.baton/markers.jsonl`, which every sync already reads
(`parseMarkers`) and every leg of every marker course already commits. So, **before the owner's
session starts**, do exactly this, in order:

1. Append this line to `.baton/markers.jsonl` — one JSON object on one line, the ticket id bare
   (no repository prefix), nothing else on the line:

   ```
   {"ticket": "<the ticket id>","leg":"converse","reached":"requested","next":"review","claim":null}
   ```

   With no shell reaching your command, the ticket id is the one in the arguments the stub
   appends — `<ticket id> <leg> <checkout>` — or the file name `$BATON_TICKET_FILE` names. Write
   the line with a `sh -c` of your own (or the equivalent in your harness), substituting the id:

   ```
   sh -c 'printf %s\\n "{\"ticket\":\"'"$TICKET"'\",\"leg\":\"converse\",\"reached\":\"requested\",\"next\":\"review\",\"claim\":null}" >> .baton/markers.jsonl'
   ```

   Run it in the checkout, with `$TICKET` set to the bare id. The file may not exist yet
   (`.baton/` does; `repo init` writes it): `>>` creates it.
2. Commit that file alone — `git add .baton/markers.jsonl` then
   `git commit --no-gpg-sign -m 'baton:converse <ticket id> requested'` — on the default branch,
   the branch the sync reads, and push it. A push refused because the branch moved is the marker
   courses' own race: pull `--rebase` (the checkout merges the file by union) and push again, at
   most three times; any other refusal fails the leg.
3. Print the command and the prompt below for the owner, and **return**: Baton's stub ends the
   claim with `{ suspend: true, reached: 'requested', next: 'converse' }`. Nothing else moves —
   not the ticket, not the board, not the PR.

From that line on, the sync offers `converse` **waiting on the owner** rather than ready, sync
after sync, until the specification's PR exists: this leg runs once, not once per sync. If the
owner's session ends before the PR is open, the line stands and the ticket waits; the next
conversation continues from the branch it pushed, and the reviewer sees one PR either way.

## Starting the conversation

Interactive legs run as the owner's own session, in a checkout of this repository: start it with
whatever interactive agent your harness has — `claude`, `opencode`, another — and give it this
prompt:

> Follow the `## The conversation` section of `.baton/courses/create-spec/legs/converse.md` in this
> checkout for ticket `<ticket id>`; its file is named by `BATON_TICKET_FILE`, or under the
> repository's ticket directory. You and I will design one specification together, then you open
> its PR. The `.baton/markers.jsonl` line for this ticket is already committed: do not write or
> amend it.

Once Baton launches interactive legs itself, the runner sends the link to the session instead —
"the runner sends the link once B-34 lands" — and the conversation's rules and where the work
lands do not change.

## What the conversation produces

- **One specification file**, new, under the directory this repository keeps its specifications in
  — `spec/` by convention; a repository that keeps them elsewhere says so in the instructions it
  adopts, and then that is the directory. One file for the request: a specification is a contract
  a reader can execute, not a note.
- **A branch named for the course's pattern** — `branch_pattern` in `.baton/baton.json`
  (`claude/<ticket id>-<slug>` by default) — and **one PR** from it, its title starting with the
  ticket's id. The ticket's `prs:` list gains the PR's URL; where the row lists nothing and the
  forge is the record, the branch's name is enough.
- The ticket file itself, if the request belongs in its body, moves with it.

A specification in this repository's corpus — read the conventions the specifications around
yours keep (this repository's are in `spec/`, and `spec/BATON_SPEC.md` is the worked example) —
carries, in an order the corpus already uses:

- **What it is** — three sentences: what the thing is, for whom, why they would use it.
- **The decisions, numbered** — one rule per id (`R-…`), each one a decision an implementer
  executes without asking: no open architectural question left for them, each with what it
  binds.
- **The vocabulary** — every word the specification uses with a new meaning, in one sentence
  each, consistent with the words the corpus already gives a meaning.
- **The scenarios** — named (`S-…`), each with the input, the action and the exact result it
  must produce: what a test is written from.
- **What it supersedes, cites or joins** — every cross-reference live, none pointing at a
  deprecated section.
- **Open questions, if any** — and none may remain that a decision id should settle.

## The conversation

*This part is for the owner's interactive session, not for a headless leg.*

- **Read first**: the ticket, its links, and the specifications around them. Find where this
  repository's specifications live and what shape they take; follow the nearest precedent.
- **One question at a time**, the recommendation first: "(a) is what I'd do, because …; (b) would
  cost …". Take the owner's answer, or their own idea, as it comes, and write it down at once.
- Keep a running outline of the decisions the conversation has settled; after every few answers,
  read the owner back the ids they changed in one line each.
- **Do the work that needs no owner**: read the code the specification will bind, the corpus it
  joins, the tests it will need. Ask only what the owner alone can settle — scope, the user,
  what wins when two rules collide.
- **Say when something contradicts the corpus**, and ask which wins rather than deciding alone.
- When the specification reads whole, read the owner the three-sentence summary, the scenario
  names and the list of decisions, and ask whether it is right.
- **Only on their yes**: write the file, commit it on the branch named for the course's pattern
  (with explicit paths, never `git add -A`), push, and open the PR — `## What`, the decisions
  taken and the owner's answers under `## The conversation`, and the ticket id in the title. Add
  the PR's URL to the ticket's `prs:` if the ticket keeps one, in a commit of its own — on the
  default branch, so the sync finds it without a merge — and push that too. Then end the session.
- **Release the claim**: the leg's stub has to see its agent return. When the PR is open and
  pushed, exit the agent session (the prompt's harness exits on its own: it has nothing left to
  read). If the owner stops before the PR is open, say so and exit anyway — the ticket waits at
  `requested`, its marker committed, and nothing is lost: the next conversation continues from the
  branch.

## Do not

- Rewrite, delete or amend the `.baton/markers.jsonl` line: it is what tells the sync the
  conversation is under way. A second line for this ticket would make a second conversation.
- Open a second PR for the ticket, or rewrite a branch an earlier attempt pushed: continue it.
- Write code in this session. This course produces a specification; building it is another
  ticket's course.
- Mark the ticket `done`, or merge the PR. The review leg and the merge leg are later.
