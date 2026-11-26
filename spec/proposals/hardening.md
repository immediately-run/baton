---
title: "Proposal — hardening, for when Baton runs unattended"
description: "A list, not a design: security measures the owner parked on 2026-11-26 until Baton runs without daily intervention — each a weakness a review found in a current proposal, what it would take to close it, and why it waits."
---
# Proposal — hardening, for when Baton runs unattended

**Status:** a list, not built and not scheduled. The owner, 2026-11-26: it is premature to nail
down these measures "before baton really works — runners need intervention multiple times a day
still". Each entry below is a weakness an adversarial review found in a current proposal, which
that proposal states as an accepted risk; it waits here until the measure is worth its cost. An
entry moves into its proposal, or into BATON_SPEC, when the owner takes it up.

## Personal secrets

From [personal secrets](personal-secrets.md), *Accepted risk*.

- **Trusting the notifier key list.** Today whoever controls the list — an owner, or a compromised
  Baton — can add a key and read every secret sealed or re-encrypted after. To close it:
  - the CLI remembers the notifier keys it has sealed to and refuses an unannounced change, asking
    the person to confirm the new key by its fingerprint;
  - a notifier re-encrypts only to a list its own operator has confirmed, out of band;
  - each person is told, on their own channels, when the recipients of their secrets change.
- **Trusting a person's own keys.** Notifiers check a secret's signature against the keys Baton
  lists for the person, so a compromised Baton can forge one. To close it: notifiers pin each
  person's key on first sight and report a later change instead of trusting it.
- **Replay to a fresh notifier.** The rollback check rests on each notifier's own record of the
  highest version it has seen, which a new or re-keyed notifier lacks. To close it: notifiers carry
  their records across rotation, and a deleted secret leaves a tombstone the person signs.
- **Padding.** A sealed secret's size is visible; age does not pad. To close it: pad each value to
  a fixed size before sealing.

## People and sessions

From [people and dashboard §5](people-and-dashboard.md#5-people-identities-and-the-roster) and
[ticket ownership](ticket-ownership.md), *Session claims*.

- **A fence for MCP session claims.** A lapsed MCP session claim is not stopped from pushing: the
  leg is requeued onto a fresh branch, pushes to any other branch are outside work, and the new
  holder checks its branch's remote head before it closes — but the old session still holds the
  person's forge credential and can push to the new branch, or merge its own PR, which the sync
  then finds as outside work. To close it: a Claude Code hook, shipped with Baton, that checks the
  claim before every `git push`, as the `pre-push` hook does for runners.
- **A runner on a person's machine.** A runner's legs under the default executor can use its
  `ssh-agent` (R-BTN-107); on a machine where a person's own keys live, that is the person's
  human-driven key. To close it: such a runner runs its legs in an executor that does not expose
  the person's agent or key files.
- **Governance acts by key signature only.** A proof level that admits a request signed with a key
  but not a bearer or OAuth token, which a policy may require for its `approvers.*` acts, so an
  injected instruction holding a person's grant cannot add owners, mint keys or list notifiers.
- **Proof beyond a token.** Over MCP a human-driven act carries a token's proof: whose credential,
  never that the person was present. To raise it: MCP requests signed per act by the person's SSH
  key through `ssh-agent`, so a hardware key's touch reaches MCP as it reaches the CLI.

## Interventions

From [intervention sessions](intervention-sessions.md), *Who drives*.

- **A human-driven intervention acts with everything the person's role admits.** An injected
  instruction in the session acts with it too. To narrow it: per-action opt-in for the acts a
  human-driven intervention may take directly, the rest confirmed on Baton's page.
