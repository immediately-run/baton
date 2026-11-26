---
title: "Proposal — personal secrets and notification"
description: "A recommendation, not built: a person seals a secret — an ntfy topic, a webhook — on their own machine, signed with their SSH key and encrypted with age to the arena's notifier keys; Baton stores the ciphertext, which the person who set it may overwrite, never read. A notifier in the deployment reads what is due from Baton, decrypts, checks the signature and the version, sends, and attests what it sent. Preferences and non-secret contact identifiers are the person's own, self-serve."
---
# Proposal — personal secrets and notification

**Status:** recommendation, not built and not scheduled. An **arena** is the unit Baton
coordinates ([vocabulary](../../docs/context/vocabulary.mdx)); the spec and the API still write
it `repository`. The owner settled its design on 2026-11-26
([The owner's decisions](#the-owners-decisions)), after a survey of how others keep secrets out of
a control plane ([Prior art](#prior-art)), and a first adversarial review the same day. It takes
from the earlier *users and groups* proposal (immediately-run/baton#300, closed) what Baton tells a
notifier and what the notifier tells Baton ([Delivering](#delivering)). It relies on people as
Baton knows them ([people](people-and-dashboard.md#5-people-identities-and-the-roster)) and on
[human intent and autonomy](../../docs/context/human-intent.mdx). What is deliberately left for
later is the [hardening proposal](hardening.md). Nothing here changes a rule yet; every rule it
would change is in [Amends](#amends).

## The goal

Three constraints, the owner's, 2026-11-26:

- **Simple to understand.** One sentence: *you can write it; only a notifier can read it.*
- **No plaintext credential in the Baton server**, ever — not at rest, not in transit through it.
- **Self-serve.** Any person changes where and when they are notified, and the secrets that
  needs, without an administrator or an owner.

And one fact that shapes it: an **ntfy topic is a secret**. On a public ntfy server, whoever knows
a topic's name can post to it, so a topic is a credential, not an address.

## The owner's decisions

Settled 2026-11-26; not reopened by a review.

1. **A secret is signed by the person's own SSH key and encrypted to the notifiers' keys.**
   People already authenticate to Baton with SSH keys; a secret reuses them. Several notifier keys
   may be recipients at once, so a key can be replaced without an outage.
2. **Baton stores the ciphertext on the person's behalf.** The person who set a secret may
   overwrite or delete it, never read it back; Baton holds no key that can decrypt it.
3. **The formats are standard tools:** SSH signatures (`ssh-keygen -Y sign`) and
   [age](https://github.com/FiloSottile/age), which encrypts to SSH public keys and to several
   recipients at once.
4. **Notifiers re-encrypt on rotation.** A notifier that can decrypt a secret re-encrypts the
   same signed bundle to the new set of keys; the person re-enters nothing.
5. **Owners set an arena's notifier keys**, an `approvers.members` act
   ([R-BTN-188](../BATON_SPEC/12-security.md#sec-12-8)).
6. **A version check against rollback.**
7. **Notifier keys are per arena**; a person on several arenas seals once for each, which the CLI
   does in one command.
8. **CLI first.** Sealing in the browser can follow; key handling there needs more care.
9. **Trusting the notifier key list is hardening, for later** ([Accepted risk](#accepted-risk),
   [hardening](hardening.md)): Baton runs, but still needs intervention several times a day, and
   the secrets' security can be tightened once it runs unattended.
10. **Notifying a team is not per person.** Baton keeps no groups and never fans one entry out to
    each member of a team: a team pulls from Needs you, or one notification goes to a channel the
    team already shares, whose membership is the channel's ([Later](#not-in-this-proposal)).

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
| **Person** | someone Baton knows, with SSH keys and linked identities ([people](people-and-dashboard.md#5-people-identities-and-the-roster)) | Baton |
| **Notifier** | a delivery runner (R-BTN-163) with a **notifier key** of its own: an SSH key pair, registered as a notifier of an arena, whose private half never leaves its host. `notifier` is a principal of its own, never a runner's key; it signs its requests as every key does (R-BTN-13). A notifier's host runs no legs, so no leg can read its key. | the deployment, beside the team's channel credentials |
| **Notifier keys** | each arena's list of notifier public keys, set by its owners | Baton |
| **Sealed secret** | a person's secret for one arena: its name, purpose, version, recipients and inner hash in the clear, its value in age ciphertext | Baton, ciphertext only |
| **Channels** | the ways a person is reached, each verified, and preferences over them | Baton: identifiers and preferences only |
| **Team channel credentials** | the Slack bot token, SMTP, an ntfy sender account | the notifier's host; never Baton |

## Sealing a secret

`baton secret set <name> --purpose <purpose>` reads the value from stdin — never from the command
line, where a shell keeps it, and without echo when stdin is a terminal — and for each arena the
person is on (or the one `--repo` names):

1. **Builds the bundle**, canonical JSON: `{v: 1, baton, person, arena, name, purpose, version,
   value, signed_at}`, `baton` the instance's origin. `version` is one more than the highest
   version Baton has ever held for that person, arena and name, deletions included.
2. **Signs it** with the person's SSH key, `ssh-keygen -Y sign -n baton-secret` (through
   `ssh-agent` where the key is there), so a signature made for anything else does not verify.
3. **Encrypts bundle and signature together** with age to every notifier key the arena lists,
   ASCII-armoured.
4. **Uploads** `{name, purpose, version, recipients, inner_hash, ciphertext}`, `inner_hash` the
   SHA-256 of the signed bundle, the request signed with the person's SSH key as every request is
   (R-BTN-13). Secrets are set only by a person's SSH key, never by an interactive grant or any
   delegated credential.

Baton refuses an upload whose `version` is not greater than every version it has held for that
name, and one whose `recipients` are not exactly the arena's current notifier keys; it stores the
rest as given. It cannot check the signature or the contents: they are inside the ciphertext.

`baton secret list` shows each name, purpose, version, recipients and update time; `baton secret
rm <name>` deletes one, leaving a tombstone of its version so the next is higher. Nothing shows a
value.

## Delivering

From #300, unchanged in substance:

- **Each Needs-you entry carries its recipients**: the person a ticket's assignee resolves to
  through their verified linked identities (decision 5 of [ticket ownership](ticket-ownership.md)),
  when that person is on the arena's roster or one of its owners; else the arena's owners' people.
  So whoever can edit an assignee can route an entry only to the arena's own people.
- **One read, no cursor.** `GET /v1/needs-you?due=1` answers, across the arenas the notifier
  serves, every open entry that no notifier has yet attested, with its recipients, their verified
  channels and their preferences, resolved as the read is made. A notifier keeps no cursor: it
  reads, sends, attests, and reads again a minute later; a restart or a second notifier needs no
  place carried over, and two that race may both send. The one thing it keeps on its host is the
  highest version it has seen of each secret (below).
- **The notifier's word.** For each entry it worked, a notifier attests `std:notified@1`: `{entry,
  told: [<person>], unreachable: [<person>]}`, naming no channel and no address. Only a key on the
  arena's notifier list writes it, whatever the policy admits for other types; a runner's word
  that someone was told counts for nothing. Needs you shows who was told.
- **A silent notifier is a condition.** Where the policy admits a writer for `std:notified@1`, an
  entry unattested for 15 minutes raises `baton.notifier-silent` on the arena.

For a channel that needs a secret, the notifier also:

1. **Fetches** the person's sealed secret for that arena.
2. **Decrypts** it with its notifier key.
3. **Checks the signature** against the person's SSH keys as Baton lists them, and checks every
   field: the instance and the arena are its own, the person is the recipient, the name is the
   channel's, the purpose admits notifications, the bundle's hash is `inner_hash`, and the inner
   version equals the outer one and is not lower than the highest it has recorded for that person
   and name, which it keeps on its host. A failed check drops the secret, sends nothing on that
   channel, and lists the person as `unreachable`.
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

**Every channel is verified before it is used, and again for every new secret behind it.** When a
person adds a channel or sets a new version of its secret, the next notifier to read it mints a
code — eight Crockford base32 characters, valid fifteen minutes — sends it through the channel,
and stores its hash in Baton against the channel and the secret's version
(`POST /v1/notify/verifications`, a notifier's call); a second notifier's code for the same
version is refused `conflict`. The person confirms it with their SSH key (`baton notify verify
<channel> <code>`), at most five tries per code. An unconfirmed channel, or a secret version not
yet confirmed, receives nothing.

**A webhook is sent with care.** A notifier posts only to an `https` URL, refuses an address that
resolves to a private, loopback or link-local network, follows no redirect, and sends at most a
few requests a minute to one webhook — verification codes included.

## Preferences

A person's own settings, plain text, self-serve: which events (interaction requests, person legs
waiting on them, their tickets closing, conditions on tickets they started) go to which channels,
and quiet hours. `baton notify prefs set interact=ntfy,slack others=email`; a dashboard page later.
No one else edits them.

## Rotation

- **Adding a notifier key.** An owner adds it to the arena's list. A notifier holding a current
  key fetches each of the arena's secrets, decrypts it, and re-encrypts **the same signed bundle**
  to the new list: `version` and `inner_hash` stay, the person's signature stays valid inside.
  Baton accepts a re-encryption only from a notifier key on the current list, only with the version
  and `inner_hash` it holds, and only while that is still the secret's newest version; it records a
  `rewrapped` event.
- **Removing one** is the same, to the shorter list.

## Who reads what

- **The person**: their own secrets' metadata, their preferences, their channels.
- **A notifier key on the arena's list**: the ciphertext, verified channels and preferences of the
  arena's people — those on its roster and its owners' people — and the due entries, with their
  session links.
- **Owners and administrators**: through their own reads, who an entry will reach and on which
  kinds of channel, never a contact identifier or ciphertext. An owner who adds a notifier key of
  their own reads all a notifier reads ([Accepted risk](#accepted-risk)).
- **No runner key, no other person, no delegated credential** reads any of it.
- **Events** record each set, overwrite, delete, re-encryption, verification and notifier key
  change, with the person, the name and the version — never a value, never a contact identifier.

## Accepted risk

Stated as it is, for now (decision 9):

- **Whoever controls the notifier key list can read secrets.** The CLI seals to the list Baton
  serves, and honest notifiers re-encrypt every secret to the list Baton serves. So an owner who
  adds a notifier key whose private half they hold, or a compromised Baton that lists a key of its
  own, can read every secret sealed or re-encrypted from then on — and every channel, preference
  and due entry, session links included, that a notifier reads. The fix — the CLI and notifiers
  confirming list changes out of band, and each person told when their secrets' recipients change
  — is in the [hardening proposal](hardening.md).
- **A compromised Baton can forge a person's secret.** Notifiers check signatures against the SSH
  keys Baton says a person holds, so a Baton that adds a key of its own to a person can sign and
  seal a secret in their name — redirecting their notifications, which carry session links, to a
  topic it reads. Baton's own server is trusted and its compromise recovered from, not resisted
  ([architecture](../../docs/context/architecture.mdx), *Four nouns at the boundary*).
- **A fresh notifier can be replayed to.** The rollback check rests on the highest version a
  notifier has seen, kept on its host: a new or re-keyed notifier has seen none, so a compromised
  Baton can serve it an older signed version, or one the person deleted. Durable marks carried
  across rotation, and tombstones the person signs, are in the [hardening proposal](hardening.md).
- **An administrator can enter as a person once.** An administrator mints the attach code for a
  person's first key where nothing else lets the person in (plain git); the person is told on their
  verified channels, and an administrator who keeps the code for themselves acts as that person.
- **What leaks in the clear:** each secret's name, purpose, version and size (age does not pad).

**Recovery.** Replace every notifier key; have every person **change** each secret at its source — a
new ntfy topic, a new webhook — and seal the new one, since sealing a leaked value again protects
nothing; and read the events for notifier keys and person keys added that nobody meant to add.

## Not in this proposal

- **Notifying a team** (decision 10). Two shapes, neither built now: **pull**, the dashboard's
  Needs you, where a team checks what waits on it; and **push to one shared channel**, an
  arena-level Slack channel or team topic, sent with the team's credential, its membership the
  channel's. Baton never fans out to each member of a team, and never holds a team's membership.
- **Escalation**: telling more people when no one answers. Left out: one push to a shared channel
  is where it would go.
- **Sealing in the browser** (decision 8).
- **Secrets used to act as the person** — their own model subscription, a token that acts as them
  at a forge. The same sealing serves them, but a leg using one is an agent-driven act *on behalf
  of* the person ([human intent](../../docs/context/human-intent.mdx)), which needs its own design.
- **Short-lived credentials from an identity provider** (OIDC), which avoid stored secrets
  altogether where a provider offers them.
- **The rest of the secret strategy** the earlier proposal asked for (its B-309): the host's own
  secrets, runners' and legs' credentials, deliverers' tokens. This proposal covers a person's own.

## Amends

- **R-BTN-53 (§1)**: "Secrets never enter Baton" gains its one exception: a person's sealed secret,
  ciphertext Baton cannot open, which it stores and serves only to the arena's notifiers.
- **R-BTN-33 (§1)**: the sealed-secret and channel tables beside the filter fields.
- **R-BTN-163 (§7.3)**: a delivery runner may be a **notifier**; "records no delivery" becomes
  "records the notifier's attestation of it"; each entry's recipients; `needs-you?due=1`;
  `baton.notifier-silent`.
- **R-BTN-181 and R-BTN-110**: the attestation type `std:notified@1` in the standard library.
- **R-BTN-188 (§12.8)**: `approvers.members` gains an arena's notifier keys.
- **R-BTN-13, R-BTN-129 and §12.1**: the notifier key, a principal of its own, and what it reads.
- **R-BTN-127**: the nouns `secret` (`set`, `list`, `rm`) and `notify` (`prefs`, `verify`, `test`);
  **§13**: the tables for sealed secrets, tombstones, notifier keys, channels, verifications and
  preferences; **§14**: their routes and `GET /v1/needs-you`.
- **[The vocabulary](../../docs/context/vocabulary.mdx)**: *Notifier*, *Sealed secret*.

## Open decisions

- **A person leaving.** Whether removing a person deletes their sealed secrets, or only stops their
  delivery.
- **Recipients when a ticket has no assignee**: the arena's owners' people, as above, or nobody but
  Needs you.
