---
name: spec-review
description: Review the whole of spec/BATON_SPEC.md for consistency — facts stated in several rules that disagree, owner rulings that reached the context pages or the tickets but not the spec, italic patch notes, cross-references to retired or renamed rules, Decisions entries the rules no longer match, and scenarios and gates that test rules as they used to be. Use when asked to "review the Baton spec", "audit the spec", "run the spec review", "is the spec consistent", or on a periodic schedule. Writes a dated review to docs/review/ with findings ready to become tickets; files them on request.
---

# Reviewing the whole Baton spec

A spec PR's review reads a diff. This review reads the spec, because what a diff misses is a
rule it did not touch that still states the old fact. It is the periodic counterpart of the
babysit skill's *Spec PRs*.

## Scope

- `spec/BATON_SPEC.md` whole, against:
  - `docs/context/` (product, architecture, values, vocabulary);
  - `spec/BATON_SPEC_HISTORY.md`'s changelog since the previous review (`docs/review/*-spec-review.mdx`, the newest);
  - the live tickets in `tickets/` (not `archive/`) whose brief quotes an owner ruling.
- Out of scope: whether the design is right. A finding is a disagreement, a gap or a dangling
  reference, never a preference.

## Steps

1. **Rulings not yet in the spec.** List every owner ruling since the previous review: the
   history's changelog entries, the context pages' changes (`git log --since=<previous review>
   -- docs/context`), and live tickets whose brief quotes the owner. For each, check that the
   spec states it in the rules themselves. A ruling a ticket holds and the spec does not is a
   finding of kind `unpropagated`.
2. **Facts stated twice.** For each ruling found in step 1, and for each rule changed since the
   previous review, run `npm run spec:impact -- <rule> --term "<key phrase>"`. Read every entry:
   one that states the fact differently is `contradiction`.
3. **Patch notes and stale lists.** `npm run check:spec` must pass. Any entry still in
   `PATCH_NOTES_ALLOWED` is reported with its age (`patch-note`).
4. **References.** Every `R-BTN-n` the spec cites is defined and not retired; every `S-BTN`/`G-BTN`
   row cites rules that still say what the row tests; every Decisions entry names rules that
   still carry the decision (`stale-reference`).
5. **Fresh reviewers.** Split the spec into four to six spans by section. Give each span to one
   fresh reviewer, with the impact lists from step 2 that touch it, and ask only: which facts in
   this span disagree with a fact stated elsewhere (quote both, with line numbers)? Verify each
   answer against the text before keeping it.

## The record

Write `docs/review/<YYYY-MM-DD>-spec-review.mdx`: frontmatter (`title`, `description`, `tags:
[review]`), a one-paragraph verdict, then one table of findings: kind, rules (with line
numbers), what each says, and the smallest fix (a rule rewritten, a ticket rewritten, a
reference corrected). End with the count of findings by kind against the previous review.

`npm run check:wiki` must pass. Commit the review on its own. On request, file each finding as a
ticket (`node cli/baton.mjs tickets new …`, which pushes to `main`: ask before running it from a session
told to push only to its own branch) or fold the small ones into one spec PR that follows the
babysit skill's *Spec PRs*.
