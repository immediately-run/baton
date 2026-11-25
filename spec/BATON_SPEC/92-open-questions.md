---
title: "Open questions"
description: "BATON_SPEC — Open questions."
---
## Open questions

- **§12.8's remaining items.** Each is to be settled before the rule it names is built:
  - **Foreign-commit resets race honest work** (R-BTN-183): a reset can discard an honest leg's
    unreported pushes, and any runner can trigger one through the shared forge identity until
    each claim has its own push credential (B-131).
  - **A human's wrong-head merge is caught after it lands** (R-BTN-184): the forge cannot refuse a
    human's merge of another head; whether trusted runners should revert it, or the human's merge
    should itself go through a pinned expected head, is open.
  - **Multi-repository tickets** (R-BTN-140) under `tickets-approved`: one chain and one approval per
    repository, or one per ticket.
  - **Deleted paths in `std:approval@1`**, which have no blob; **sync imports** reached transitively
    outside `imports`; **release assets**, which a forge `write` role can still replace, unless
    releases are made immutable.
  - **`bypass_actors` read access** (R-BTN-180): whether a narrower permission than write access to
    the ruleset suffices on GitHub (B-140).
  - Whether `human_only` keys registered while every approver was `owner` must be re-registered
    when one becomes `human`.

- **Confirmation by keys a same-user process can reach (R-BTN-155, R-BTN-159).** Any
  administrator or owner key, SSH or API, binds a sign-in code and confirms its session's
  actions, so the confirmation keeps a stolen session from an authority-changing act only when
  the key needs a touch. Should binding and confirming refuse API keys and SSH keys without the
  `sk-` user-presence flag? Refusing closes that gap; it locks out holders who chose an API key,
  which R-BTN-159 makes their trade. Until it is decided, any key of the session's role confirms.

