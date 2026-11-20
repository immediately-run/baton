---
title: "Proposal — the branch course"
description: "A course that reads the home repository's git alone: branches, verdict commits and merge trailers, with no forge."
---
# Proposal — the branch course

**Status:** proposal — not built; moves into BATON_SPEC §5 or `docs/standard-courses.mdx` when built (tickets: none yet)

R-BTN-96 (proposed). **The `branch` course** (a course directory of the baton repository, `facts:
["branches"]`; `baton repo init --course branch`) reads the home repository's git alone:

- stations `filed` → `pushed` → `reviewed` → `merged`, with `fixed` between `reviewed` and the
  next review; legs `implement`, `review` (`max_runs` 4), `fix` (`max_runs` 3), `merge`; no
  `short_waits`;
- a ticket's branch is a ref matching the current or previous `branch_pattern` with a commit not
  reachable from the default branch; with several, the least advanced decides; none is `filed`;
- a content commit's tree differs from its first parent's; a verdict is an empty commit whose
  trailers (`git interpret-trailers --parse`, last occurrence per key) carry
  `Baton-Verdict: approve|changes`, `Baton-Reviewed: <40-hex>` and `Baton-Claim: <nonce>` (the
  `review` claim's). A verdict no `review` claim wrote counts like any other: whoever can push is
  trusted (R-BTN-46, R-BTN-66), and where the policy admits no `sync` verdict the review is an
  attestation instead (R-BTN-187). Walking first-parent history from the head, the newest verdict
  reviewing the newest content commit decides: approve is `reviewed` with `merge` ready, changes
  `reviewed` with `fix` ready; content after it is `fixed`; content and no verdict is `pushed`;
- `merged`, judged first, holds when the default branch's first-parent history has a commit with
  trailer `Baton-Ticket: <local id>`; the `merge` stub merges with `git merge --no-ff` and that
  trailer and pushes.
