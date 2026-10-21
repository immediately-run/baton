# build-app · verify — verify the build against the definition, file what fails

You are running the `verify` leg of the `build-app` course. The ticket's file is
`$BATON_TICKET_FILE`; every child ticket it filed has closed. When you finish, either every
acceptance criterion in `product/<ticket id>/PRODUCT.md` passes and the ticket is done, or the
ones that fail are fix tickets and the ticket waits for them. Baton's closing marker is written
for you after you return; do not write it.

> **How the stub runs you** — Baton's contract for the `agent_command` author: your command
> line splits into words as `sh` would (quotes honoured, no substitutions) and executes
> **without a shell**, with the ticket id, the leg and the checkout appended as arguments.
> Stdin is never an open pipe: nothing to read, and a read ends at once. Stdout and stderr are
> captured pipes, and the course reads stdout's last line. Your process's exit **is** your
> completion: a harness that is a client of a background service must keep its session in
> process (`opencode run --standalone`, or the equivalent) — a client that can exit before its
> work ends leaves truncated output and an orphaned session posting to a claim that no longer
> exists (B-84).

## 1. Check, from a fresh read

You are the product's first user and its acceptance tester, not its author. Read `PRODUCT.md`,
`DESIGN.md` and `ARCHITECTURE.md`, then use the build as a person would:

- **Run what `ARCHITECTURE.md` says is the product**: the deployment when it names one, else the
  build run locally as its README says. A build you cannot start is the first failure.
- **Every acceptance criterion**, `AC-1` onward: check it with the end-to-end test that claims
  it, and check that test really asserts the criterion. Then check it by hand in a browser (an
  automated one is fine), with the input the criterion names. Record the evidence: the command
  and its output, or a screenshot path.
- **Every screen in `DESIGN.md`**, beside its mock-up: each state reachable, nothing missing that
  the design shows.
- **The core loop end to end**, as `PRODUCT.md` describes it, including the edges (a game played
  to its end; an illegal move; a lost connection when `ARCHITECTURE.md` covers one).
- **The repository's checks** on the default branch: all green.

## 2. Write `product/<ticket id>/VERIFY.md`

Append one `## Verification <n> — <date>` section (keep earlier ones): a table of each `AC-n`,
`pass` or `fail`, and its evidence; then each other failure (a screen, a state, a check), in a
line each with its evidence.

## 3. Then

- **Everything passes:** add `## Outcome` to this ticket — what was verified, and where it runs
  — set its `status:` to `done`, and commit `VERIFY.md` and the ticket together to the default
  branch. Your last line is `shipped`.
- **Something fails:** file one fix ticket per cause, not per symptom, as `file` filed the
  others: id `<this ticket's id>-<n>` with the next unused `n`, `parent` this ticket, its `course`, the failing
  `AC-n` and its evidence in the body, and a test that would have caught it among its exit
  criteria. Commit them with `VERIFY.md`. Your last line is `building`: this leg runs again when
  the fixes close.
- **This is the third verification and something still fails:** do not file more fixes. Write
  the failures up under `## Decision needed` in this ticket for the owner — ship as is, or plan
  a next round — and your last line is `building`.

Do not change product code in this leg; a fix is a ticket.
