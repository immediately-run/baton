---
title: "Proposal — personal secrets and notification preferences"
description: "A recommendation, not built: a person seals a secret — an ntfy topic, a webhook — on their own machine, signed with their SSH key and encrypted with age to the repository's notifier keys; Baton stores the ciphertext and lets its owner overwrite it, never read it; a notifier in the deployment decrypts, checks the signature and the version, and delivers. Preferences and non-secret contact identifiers are the person's to edit, self-serve."
---
# Proposal — personal secrets and notification preferences

**Status:** recommendation, not built and not scheduled. The owner settled its design on
2026-11-26 ([The owner's decisions](#the-owners-decisions)), after a survey of how others keep
secrets out of a control plane ([Prior art](#prior-art)). It relies on people as Baton knows them
([people, roles and identities](people-and-dashboard.md#5-people-roles-and-identities)) and on
[human intent and autonomy](../../docs/context/human-intent.mdx). Nothing here changes a rule
yet; every rule it would change is in [Amends](#amends).

## The goal

Three constraints, the owner's, 2026-11-26:

- **Simple to understand.** One sentence: *you can write it; only the notifier can read it.*
- **No plaintext credential in the Baton server**, ever — not at rest, not in transit through it.
- **Self-serve.** Any person changes where and when they are notified, and the secrets that
  needs, without an administrator or an owner.

And one fact that shapes it: an **ntfy topic is a secret**. On a public ntfy server, whoever knows
a topic's name can post to it, so a topic is a credential, not an address.

## The owner's decisions

Settled 2026-11-26; not reopened by a review.

1. **A secret is signed by the person's own SSH key and encrypted to the notifiers' keys.**
   People already authenticate to Baton with SSH keys, and so do runners; a secret reuses them.
   Several notifier keys may be recipients at once, so a key can be replaced without an outage.
2. **Baton stores the ciphertext on the person's behalf.** The person may overwrite or delete
   their own secret, never read it back; Baton holds no key that can decrypt it.
3. **The formats are standard tools:** SSH signatures (`ssh-keygen -Y sign`) and
   [age](https://github.com/FiloSottile/age), which encrypts to SSH public keys and to several
   recipients at once.
4. **Notifiers re-encrypt on rotation.** A notifier that can decrypt a secret re-encrypts the
   same signed bundle to the new set of keys; the person re-enters nothing.
5. **Owners set a repository's notifier keys**, an `approvers.members` act
   ([R-BTN-188](../BATON_SPEC/12-security.md#sec-12-8)); under `protected`, only trusted runner
   hosts may hold one.
6. **A version check against rollback**, and no key pinning for now.
7. **CLI first.** Sealing in the browser can follow; key handling there needs more care.
8. **A compromised Baton can forge a person's secret, and Baton does not guarantee against it**
   ([Accepted risk](#accepted-risk)): it is documented, not defended.

## Prior art

| Pattern | Who | What Baton takes from it |
|---|---|---|
| Seal to a published public key; only a worker in your own infrastructure decrypts | [Bitnami Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets), [SOPS with age](https://getsops.io/docs/usage/identities/age/) | the whole shape; SOPS's several recipients, for rotation |
| Seal on the client before upload; write-only from then on | [GitHub Actions secrets](https://docs.github.com/en/enterprise-cloud@latest/code-security/reference/secret-security/secret-types) | the self-serve experience: set, replace, delete, never view |
| The control plane never touches secrets; they live beside the agents | [Buildkite agent hooks](https://buildkite.com/docs/pipelines/secrets), [1Password Connect](https://agilebits.github.io/security-design/secrets.html) | the notifier runs in the deployment, not in Baton |
| A user's channel data is an identifier, sent with the team's own credential | [Knock's Slack channel data](https://docs.knock.app/integrations/slack), its [preference center](https://docs.knock.app/preferences/hosted-preference-center) | Slack ids and emails are not secrets; preferences are self-serve |
| A sender holds a write-only account for its topics | [ntfy access control](https://docs.ntfy.sh/config/) | the notifier's own ntfy credential, where the server has access control |

## The parts

| Part | What it is | Where it lives |
|---|---|---|
| **Person** | someone Baton knows, with SSH keys and linked identities ([people](people-and-dashboard.md#5-people-roles-and-identities)) | Baton |
| **Notifier** | a delivery runner (R-BTN-163) holding a **notifier key**: an SSH key pair whose private half never leaves its host | the deployment, beside the team's channel credentials |
| **Notifier keys** | each repository's list of notifier public keys, set by its owners | Baton |
| **Sealed secret** | a person's secret for one repository: its name, purpose, version and recipients in the clear, its value in age ciphertext | Baton, ciphertext only |
| **Preferences** | which events reach the person on which channels, and when | Baton, plain text |
| **Team channel credentials** | the Slack bot token, SMTP, an ntfy sender account | the notifier's host; never Baton |

## Sealing a secret

`baton secret set <name> --purpose <purpose>` reads the value from stdin — never from the command
line, where a shell keeps it — and for each repository the person has a role on (or the one
`--repo` names):

1. **Builds the bundle**, canonical JSON: `{v: 1, person, repository, name, purpose, version,
   value, signed_at}`. `version` is one more than the version Baton holds for that name, or 1.
2. **Signs it** with the person's SSH key, `ssh-keygen -Y sign -n baton-secret` (through
   `ssh-agent` where the key is there), so a signature made for anything else does not verify.
3. **Encrypts bundle and signature together** with age to every notifier key the repository
   lists, ASCII-armoured.
4. **Uploads** `{name, purpose, version, recipients, ciphertext}`, the request signed with the
   person's key as every request is (R-BTN-13).

Baton refuses an upload whose `version` is not greater than the one it holds, and one whose
`recipients` are not exactly the repository's current notifier keys. It stores the rest as given.
It cannot check the signature or the contents: they are inside the ciphertext.

`baton secret list` shows each name, purpose, version, recipients and update time; `baton secret
rm <name>` deletes one. Nothing shows a value.

## Delivering

A notifier reads Needs you (R-BTN-163), resolves each entry's recipients (the ticket's assignee,
by the person's linked identities, [ticket ownership](ticket-ownership.md), decision 5), reads
their preferences, and for a channel that needs a secret:

1. **Fetches** the person's sealed secret for that repository.
2. **Decrypts** it with its notifier key.
3. **Checks the signature** against the person's SSH keys as Baton lists them, and checks every
   field: the person and the repository are the ones it fetched for, the name is the channel's,
   the purpose admits notifications, and the version is **not lower than the highest it has seen**
   for that person and name. A failed check drops the secret, sends nothing on that channel and
   reports it.
4. **Sends**, with the team's channel credential where the channel needs one, and keeps the
   plaintext in memory only for the send.

## Channels

Each channel kind says what the person supplies:

| Channel | The person supplies | Secret? | Sent with |
|---|---|---|---|
| ntfy, a public server | the topic | **yes**: knowing it is posting to it | nothing else |
| ntfy, with access control | the topic | no: an address | the notifier's write-only account |
| Slack | their Slack user id | no: an identifier | the team's bot token |
| Email | their address | no, but personal data | the team's SMTP |
| A personal webhook | its URL | **yes** | nothing else |

**Every channel is verified before it is used.** When a person adds a channel, the notifier sends
a code through it, and the person confirms it (`baton notify verify <channel> <code>`). An
unconfirmed channel receives nothing: nobody points notifications at someone else's Slack or
topic, and a mistyped topic is caught at once.

## Preferences

A person's own settings, plain text, self-serve: which events (interaction requests, person legs
waiting on them, their tickets closing, conditions on tickets they started) go to which channels,
and quiet hours. `baton notify prefs set interact=ntfy,slack others=email`; a dashboard page later.
No one else edits them; an owner sees whom an entry will reach, not how to reach them.

## Rotation

- **Adding a notifier key.** An owner adds it to the repository's list. A notifier holding a
  current key fetches each of the repository's secrets, decrypts it, and re-encrypts **the same
  signed bundle** to the new list; the person's signature stays valid inside, and `version` does
  not change. Baton accepts a re-encryption only from a notifier key on the current list, records
  it as a `rewrapped` event, and keeps it only when its recipients are the new list.
- **Removing one** is the same, to the shorter list. Until every secret is re-encrypted, the old
  key still opens the old ciphertexts, so a key removed because its host was compromised is
  followed by each person setting their secrets again ([Accepted risk](#accepted-risk)).

## Who reads what

- **The person**: their own secrets' metadata; their preferences; their channels.
- **A notifier key on the repository's list**: the ciphertext of the people with a role on that
  repository, and their preferences and channel identifiers.
- **Owners and administrators**: who an entry will reach and on which kinds of channel; never an
  identifier, never ciphertext.
- **No runner key, no other person, no delegated key** reads any of it.
- **Events** record each set, overwrite, delete, re-encryption and notifier key change, with the
  person, the name and the version — never a value, never an identifier.

## Accepted risk

**A compromised Baton can forge a person's secret.** The notifier checks signatures against the
SSH keys Baton says the person holds, so a Baton that adds a key of its own to a person can sign
and seal a secret in their name — redirecting their notifications to a topic it reads. Baton does
not guarantee against this: Baton's own server is trusted, and its compromise is recovered from,
not resisted ([architecture](../../docs/context/architecture.mdx), *Four nouns at the
boundary*; the owner, 2026-11-01).

**Recovery:** replace every notifier key; have every person set their secrets again; and read the
events for keys added to a person that the person did not add.

**What it does not expose.** Ciphertext stolen from Baton without a notifier key reveals nothing;
a compromised Baton cannot read a secret already sealed, only forge a new one, which the person
then sees as a version they did not set.

## Not in this proposal

- **Sealing in the browser**, for a dashboard page that sets secrets (decision 7).
- **Secrets used to act as the person** — their own model subscription, a token that acts as them
  at a forge. The same sealing serves them, but a leg using one is an autonomous act *on behalf
  of* the person ([human intent](../../docs/context/human-intent.mdx)), which needs its own design:
  which legs, under what standing consent, recorded how.
- **Key pinning** by notifiers (decision 6).
- **Short-lived credentials from an identity provider** (OIDC), which avoid stored secrets
  altogether where a provider offers them.

## Amends

- **R-BTN-163 (§7.3)**: a delivery runner may be a **notifier**, holding a notifier key; what it
  reads (above) and how it resolves recipients.
- **R-BTN-188 (§12.8)**: `approvers.members` gains a repository's notifier keys; under `protected`
  only a trusted runner's host holds one.
- **R-BTN-127**: the nouns `secret` (`set`, `list`, `rm`) and `notify` (`prefs`, `verify`, `test`);
  **R-BTN-129**: their actions, and a notifier's reads; **§13**: the tables for sealed secrets,
  notifier keys, channels and preferences; **§14**: their routes.
- **[The vocabulary](../../docs/context/vocabulary.mdx)**: *Person*, *Notifier*, *Sealed secret*.

## Open decisions

- **Notifier keys per repository or per tenant.** Per repository follows owners' authority, so a
  person on several repositories seals once for each (the CLI does it in one command); per tenant
  would seal once, but needs an administrator's act.
- **Delivery records.** Whether a notifier attests each delivery — the entry, the person, the
  channel kind, the time, no content — so Needs you can show who was told.
- **A person leaving.** Whether removing a person's last role deletes their sealed secrets, or
  only stops their delivery.
