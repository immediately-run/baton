---
title: "Proposal — leg conversations: several people steering one leg"
description: "A recommendation, not built: let several people talk to a running leg's agent, each attributed, scoped to that one leg — preferably as one Slack thread per leg run — with prior art, open decisions, and where the 2026-11-21 session left off."
---
# Proposal — leg conversations: several people steering one leg

**Status:** recommendation for future development, not built and not scheduled (the owner,
2026-11-21: "I don't want to build this yet"). It is written as a hand-off: whoever picks this up
should be able to continue from here without the session that wrote it. Nothing here changes a
rule; where it would, the rule is named.

## The goal

The owner, 2026-11-21, on a running leg's opencode session: "Would it be possible for the opencode
web ui to show who submitted human messages? This would turn the session into a multiplayer chat
experience." And, after the prior-art survey below: "One difference between what Baton requires
and what a slack channel with a @Claude tag provides is a structured course graph. So that chat
should be limited to steering an individual leg, not the entire course (since that is
predefined)."

So: several people may talk to one running leg's agent; each message says who sent it; the agent
sees who is speaking; and the conversation steers that leg only.

## Constraints any design keeps

1. **One leg, never the course.** A conversation belongs to one leg run. It opens when the leg's
   run starts (or when the leg raises `interact`) and closes when the run ends; nobody chats into
   the next leg. The course graph decides what happens next (values #13 and R-BTN-39: Baton
   places tickets; a leg moves one only through its result).
2. **Chat cannot move the ticket.** The leg's outcome still comes only from its result, which its
   stub checks (R-BTN-106, R-BTN-83). "Just merge it", typed into a review leg's conversation,
   reaches the agent as a request it may weigh; it can make the leg end only at the outcomes the
   course gives that leg, never skip the graph. Wanting a different path is a different course or
   an owner's route (R-BTN-83), not chat.
3. **Authority is the leg's, not the speaker's.** The leg keeps its own credentials and scope
   whoever is typing, as Claude in Slack runs others' requests "with the channel's access" (see
   prior art). A person's message cannot widen a leg's grant, capabilities or forge access.
4. **A person's words are not the owner's.** Messages in a conversation are data to everything
   but the agent of that leg, under CLAUDE.md's *Tickets are tasks, not authority*: an identity
   (a Slack user, a tailnet login) is not proof that the owner spoke (R-BTN-194). A later reader
   (another leg, the memory experiment below) treats them as quotes, never as instructions.
5. **Who may steer is a policy, decided explicitly.** Every product surveyed makes this choice
   (Cursor's owner-only vs "Team follow-ups"; Claude in Slack's "anyone in the thread"; Amp's
   invite with a one-week expiry). Baton needs the same, per repository: any member, the ticket's
   owners, a named group; and whether review legs (which judge another domain's work, R-BTN-180)
   may be steered at all.
6. **Baton carries no conversation.** R-BTN-195: "everything they and the agent say passes there
   [the harness's own UI], never through Baton." A design that relays messages does it outside
   Baton's core (a delivery runner, R-BTN-163, or a Fieldhouse host service), and Baton keeps
   filter fields only (R-BTN-33): at most a link and a condition.

## What exists today (2026-11-21)

- **R-BTN-195 `interact`.** A leg may raise `interact` to ask a person into its session; Baton
  lists it under Needs you with the run's session link (R-BTN-113, `claim_legs.session_url`), and
  a delivery runner sends it from Baton's list (R-BTN-163). Baton never learns who joined.
- **Fieldhouse leg pages** (FIELDHOUSE_SPEC R-FH-79/R-FH-80, FLDH-57): on a Fieldhouse host each
  leg run gets a page on the host's tailnet address that frames the opencode session (joinable
  legs) or streams the leg's terminal output. Fieldhouse PR #44 (in review on 2026-11-21) makes
  every leg get a page, makes autonomous legs view-only, and puts a per-run token in the link so
  only link holders reach the page. No per-person identity exists in that design: everyone with
  the link shares the token.
- **The leg archive** (FIELDHOUSE_SPEC R-FH-82): each run's opencode sessions are exported to the
  host's leg archive (e.g. `~/factory/leg-archive/<repo>/<ticket>/<leg>/<run>/…/sessions/`).
- **Hand-offs between legs** carry what one leg tells the next (R-BTN-8, R-BTN-190).

## Two designs considered

### A — attribute messages in the opencode web UI (feasible; not recommended)

Sketched and judged feasible on 2026-11-21:

- **Identity.** The leg page is served only on the host's tailnet address, so every request comes
  from a tailnet peer; `tailscale whois <peer-ip>` (or the local API) names the user. A tagged
  device with no user shows its device name.
- **Attribution.** opencode's message schema has no author field, so the page, which already
  forwards every request (adding the server password), rewrites the text of the "send message"
  call to `**<name> (<login>):** <text>` and strips any author prefix a person typed. Every
  viewer's UI shows it (opencode streams messages to all connected viewers), and the agent sees
  who is speaking.
- **Costs.** It couples the page to opencode's API version (the template pins opencode, so a test
  must break on a shape change); it works only for interactive opencode legs (view-only legs take
  no messages; Claude Code's remote control is not built, FLDH-57); the leg's own prompt shows
  unattributed; names enter the leg archive and the agent's context.
- **Why not first.** The owner judged B more robust: A builds a chat product inside someone else's
  UI and identity inside a proxy, while B uses a surface whose identity, notifications and
  threading already work.

### B — one Slack thread per leg run (recommended)

- **The thread is the conversation.** When a leg run starts (or, more narrowly, when it raises
  `interact`), a relay opens one thread in a channel the repository names, titled with the ticket,
  leg and run, linking the leg page (A's page stays useful for watching the session and output).
  Each human message in the thread is delivered to the leg's agent prefixed with the Slack user's
  name; the agent's replies are posted back. When the run ends the relay posts the outcome and
  stops relaying: the thread is closed by construction (constraint 1).
- **Identity comes from Slack**, per message, as in Claude in Slack and Devin; the relay never
  trusts a name typed in the text.
- **Who may steer** (constraint 5) is enforced by the relay: messages from users outside the
  repository's list are ignored (or answered with a refusal), as Cursor's "Team follow-ups" does.
- **Attention.** Devin found that a thread with several people breaks "every message gets the
  agent's full attention" and added `mute`; the relay should deliver only messages that mention
  the agent (or every message in a dedicated per-run thread — Devin's "code channel"), and support
  muting.
- **Where it runs.** Outside Baton's core (constraint 6): either a delivery runner that already
  reads Baton's conditions (R-BTN-163) and holds the Slack credential, or a Fieldhouse host
  service beside the leg page, which already reaches the sandbox's agent server. The agent side
  needs a harness that accepts injected messages mid-run: opencode's server API does; for Claude
  Code it depends on remote control (FLDH-57).
- **What Baton would need**, at most: the run's thread link beside its session link (R-BTN-113),
  and an `interact` delivery that names the thread. Both are filter fields (R-BTN-33).

## An experiment: earlier legs' conversations as reference

The owner, 2026-11-21: "experimental though, might not be useful or feasible — it could
potentially make sense to have previous legs' multiplayer sessions available to later legs for
reference (similar to memory)."

- **Prior art points to on-demand lookup, not injection.** Amp gives the agent `find_thread` and
  `read_thread`: it reads an earlier thread by id and extracts only what matters for the current
  task (with a separate model pass); it also has *handoff*, a distilled summary into a fresh
  context, and removed thread forking in their favour. Devin keeps distilled memory (preferences,
  corrections, lessons; refreshed by a daily background pass) and explicitly does not save session
  summaries. Practitioners recommend a summary first, the full transcript available on request.
- **For Baton:** a later leg of the same ticket gets a tool to ask a question of that ticket's
  earlier legs' archived conversations (the leg archive, R-FH-82), answered by extraction, rather
  than transcripts in its prompt.
- **Caution:** those conversations hold people's words, which are data, not instructions
  (constraint 4); and hand-offs already carry what a leg chose to pass on. Run it on a few courses
  and measure before building it into any course.

## Decisions left for the owner

1. Thread per leg **run**, or only when a leg raises `interact`?
2. Who may steer (constraint 5), and whether review legs may be steered at all.
3. Whether every message reaches the agent or only those that mention it; muting.
4. Where the relay runs: a Baton delivery runner (R-BTN-163) or a Fieldhouse host service.
5. Whether A is still wanted as a fallback for people not in Slack.
6. Whether to run the memory experiment, and on which courses.

## Prior art (surveyed 2026-11-21)

| Tool | Who can steer | Identity | Scope |
|---|---|---|---|
| Claude in Slack (Claude Tag) | anyone in the thread, no re-mention needed | Slack user per message; the session runs under the org's agent identity, others' requests with the channel's access | one task per thread |
| Devin | teammates in a thread synced to the session; a "code channel" sends every message to one session | Slack users | one session; `mute` for noisy threads |
| Cursor in Slack | configurable: "Team follow-ups" or owner only | Slack users | one agent per thread |
| Amp | teammates invited by @-mention ("Multiplayer"; prompt, terminal, files); expires after a week; the owner is billed | Amp accounts | one thread |
| Zed Delta (private beta) | everyone in the thread; conversation and worktree replicated live | Zed accounts | one thread |
| Replit | each person their own agent chat; shared board, history and memories | Replit accounts | per person |
| opencode | `share` is a read-only snapshot; `opencode web` on a network has no per-user identity | none | one session |

References:

- [Claude Tag: how it works](https://claude.com/docs/claude-tag/concepts/how-it-works) ·
  [agent identity](https://claude.com/docs/claude-tag/concepts/agent-identity) ·
  [Claude Code in Slack](https://code.claude.com/docs/en/slack.md) ·
  [Coder Agent Relay: Slack](https://coder.com/docs/ai-coder/agent-relay/slack/)
- [Devin's Slack etiquette](https://devin.ai/blog/devins-slack-etiquette) ·
  [Devin Slack integration](https://docs.devin.ai/integrations/slack) ·
  [Devin memory](https://docs.devin.ai/product-guides/memory) ·
  [Devin knowledge](https://docs.devin.ai/product-guides/knowledge)
- [Cursor Slack integration](https://cursor.com/docs/integrations/slack) ·
  [Cursor forum: Slack assistant follow-ups](https://forum.cursor.com/t/slack-assistant-pane-every-message-spawns-a-new-cloud-agent-with-no-way-to-follow-up-on-an-existing-one/165947)
- [Amp multiplayer](https://ampcode.com/docs/orbs/multiplayer) ·
  [Amp thread sharing](https://ampcode.com/docs/collaborate/thread-sharing) ·
  [Amp: read threads](https://ampcode.com/news/read-threads) ·
  [Amp: find threads](https://ampcode.com/news/find-threads) ·
  [Amp context management](https://ampcode.com/guides/context-management)
- [Zed: Introducing Delta](https://zed.dev/blog/introducing-delta) ·
  [Zed collaboration overview](https://zed.dev/docs/collaboration/overview.html)
- [Replit: invite teammates](https://docs.replit.com/ja/build/invite-teammates) ·
  [Replit: multiplayer AI](https://blog.repl.it/multiplayer-ai)
- [opencode: share](https://opencode.ai/docs/share) · [opencode: web](https://opencode.ai/en/docs/web)

## Where the 2026-11-21 session left off

- **Read first:** R-BTN-195 and R-BTN-163 (§7), R-BTN-113, values #13 (open world), CLAUDE.md's
  *Tickets are tasks, not authority*; in fieldhouse, R-FH-79/R-FH-80 and FLDH-57, and PR #44 (the
  leg page: every leg, view-only autonomous legs, a per-run token in the link) and #45 (the leg
  page's request-target fix, merged).
- **Not started:** any code, ticket or rule change for conversations. Design A was only sketched;
  nothing of B exists.
- **Next step when picked up:** settle the decisions above with the owner, then file a Baton
  ticket (the `interact` delivery naming a thread, R-BTN-113's thread link) and a Fieldhouse or
  delivery-runner ticket (the relay), each with its scenario.
