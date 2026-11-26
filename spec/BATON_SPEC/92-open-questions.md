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

- **A human act over MCP (R-BTN-185, R-BTN-186).** A dashboard session is a human; a delegated
  key never is, so where the policy counts a person's answer from `human` alone (`protected`), or
  an `approvers.*` list is human-only, MCP cannot take the act. R-BTN-186 makes that a defect
  unless it is mechanical. The recommendation: MCP hands such an act to the person — a dashboard
  page that shows it and takes it as a session does, with R-BTN-185's security-key touch under
  `hardware` — instead of refusing it.
- **A confirmation channel without a terminal (R-BTN-155).** A session's authority-changing
  act is confirmed by its key through a channel other than the session; the proposal's channel
  is the CLI (`baton admin confirm`, `baton owner confirm`), which a person signed in through
  Access may not have at hand. Confirming stays required whatever is decided. The
  recommendation: a WebAuthn assertion by a passkey or security key registered to the session's
  key, over the action and its parameters, made in the page but checked against a key the
  session cannot register or replace — the same assertion R-BTN-185 asks under `hardware`; the
  CLI code stays for keys with no passkey.
- **Members' Access lines (R-BTN-155, R-BTN-204).** Only whoever controls the deployment writes
  `ACCESS_IDENTITIES`, so a member who signs in through Access needs an administrator as well as
  an owner. Should an owner bind a member's email to the member's key in Baton's state, for that
  repository only? It widens the second root of trust (R-BTN-57) from the Access configuration to
  an owner's word about an email, within what a member may do.
- **MCP for administrators and members (R-BTN-130, R-BTN-186).** An MCP key is an owner's
  delegated key, so MCP carries no administrator's and no member's role, and R-BTN-186 makes that
  a defect. Should an administrator and a member mint MCP keys of their own, delegated within
  their role as R-BTN-186 narrows an owner's?
