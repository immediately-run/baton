---
title: "Open questions"
description: "BATON_SPEC — Open questions."
---
## Open questions

- **§12.8's remaining items (the fifth adversarial review, 2026-10-29).** The amendment merged as a
  proposal with these open; each is to be settled before the rule it names is built:
  - **Foreign-commit resets race honest work** (R-BTN-183): a reset can discard an honest leg's
    unreported pushes, and any runner can trigger one through the shared forge identity until B-131
    gives each claim its own push credential.
  - **A host-side signer** (R-FH-3), should signed authorship return: "signs only for the claim its
    runner holds" would need defining per kind (requests, commits); the signer is not designed, and
    `authorship: signed` left the specification with it (2026-11-01).
  - **A human's wrong-head merge is caught after it lands** (R-BTN-184): the forge cannot refuse a
    human's merge of another head; whether trusted runners should revert it, or the human's merge
    should itself go through a pinned expected head, is open.
  - **Multi-repository tickets** (R-BTN-140) under `tickets-approved`: one chain and one approval per
    repository, or one per ticket.
  - **Deleted paths in `std:approval@1`**, which have no blob; **sync imports** reached transitively
    outside `imports`; **release assets**, which a forge `write` role can still replace, unless
    releases are made immutable; **the shrinkwrap**, which the CLI package does not ship yet.
  - **`bypass_actors` read access** (R-BTN-180): whether a narrower permission than write access to
    the ruleset suffices on GitHub, to be verified when B-140 is built.
  - **Approval cost** (Fieldhouse Axiom 4): a human gate per VM grant (role and domain)
    and per proposed ticket; whether some may be batched or delegated to a policy.
  - **Smaller items**: whether `human_only` keys registered while every approver was `owner` must be
    re-registered when one becomes `human`.
  - **`baton-deploy.yml`**, whose production job restores the npm cache the test job saved: tracked
    in B-135 item 3 (the owner, 2026-10-29), so the deploy job restores no cache. (B-110 and the standard
    `review.md` running tests in a review leg are no longer open: the standard courses are written
    for the `cooperative` preset (R-BTN-131, 2026-10-29), and the courses that must not run branch code in a
    review are the deployment's.)

- **Confirmation by keys a same-user process can reach (R-BTN-155, R-BTN-159).** Any
  administrator or owner key, SSH or API, binds a sign-in code and confirms its session's
  actions, so the confirmation keeps a stolen session from an authority-changing act only when
  the key needs a touch. Should binding and confirming refuse API keys and SSH keys without the
  `sk-` user-presence flag? Refusing closes that gap; it locks out holders who chose an API key,
  which R-BTN-159 makes their trade. A candidate owner decision; until it is taken, any key of
  the session's role confirms.
