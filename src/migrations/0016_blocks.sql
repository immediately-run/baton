-- 0016_blocks.sql — R3-1251 (BATON_SPEC §2g R-BTN-75–78, §2l R-BTN-101, §4): why each ticket cannot
-- move, kept as rows written with their causes; external resources, their instances and the
-- instruments' readings; the open decisions the sync posts; the fleet counts the rows are kept
-- against; and the `blocked`, `unblocked` and `resource` events and the `unblocked` message.

-- R-BTN-75: set while the ticket is blocked; NULL otherwise.
ALTER TABLE tickets ADD COLUMN blocked_since INTEGER;
CREATE INDEX tickets_blocked ON tickets(repository_id) WHERE blocked_since IS NOT NULL;
-- R-BTN-77 as amended (R3-1251): the `resource` rows a ticket lost, silently, when no live worker
-- could answer for them any more (JSON {kind, ref, leg}); the next answer settles it. NULL otherwise.
ALTER TABLE tickets ADD COLUMN answer_lost TEXT;
CREATE INDEX requires_by_name ON ticket_requires(name);  -- R-BTN-75: tickets needing a capability

CREATE TABLE leg_needs (                         -- R-BTN-76: the resources a next leg needs, as posted
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  ticket_id    TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  leg          TEXT NOT NULL,
  resource     TEXT NOT NULL,                     -- opaque name, `^[a-z][a-z0-9:._/-]{0,79}$`
  PRIMARY KEY (ticket_id, leg, resource)
);
CREATE INDEX needs_by_resource ON leg_needs(repository_id, resource);

CREATE TABLE external_resources (                -- R-BTN-76: registered by an administrator; per Baton
  name          TEXT PRIMARY KEY,
  scope         TEXT NOT NULL CHECK (scope IN ('worker','account','service')),
  detail_schema TEXT NOT NULL                     -- the JSON Schema subset R-BTN-76 names, ≤ 4 KB
);
CREATE TABLE resource_instances (                 -- R-BTN-76: registered instances ('worker' instances are implicit)
  name          TEXT PRIMARY KEY,                 -- for 'service', the resource's own name
  repositories  TEXT NOT NULL DEFAULT '[]'        -- 'account': JSON ids of the repositories whose workers may use it
);
CREATE TABLE instance_serves (                    -- R-BTN-76: what each instance serves, many to many
  instance      TEXT NOT NULL REFERENCES resource_instances(name),
  resource      TEXT NOT NULL REFERENCES external_resources(name),
  PRIMARY KEY (instance, resource)
);
CREATE INDEX serves_by_resource ON instance_serves(resource);
CREATE TABLE worker_instances (                   -- R-BTN-76: the account instances a worker declares it uses
  worker_id     INTEGER NOT NULL REFERENCES workers(id),
  instance      TEXT NOT NULL REFERENCES resource_instances(name),
  PRIMARY KEY (worker_id, instance)
);
CREATE INDEX worker_instances_by_instance ON worker_instances(instance);
CREATE TABLE instance_readings (                  -- R-BTN-101: per instance, the administrator's and each instrument's latest
  instance      TEXT NOT NULL,                    -- a registered name, or '<resource>@worker:<id>' for worker scope
  source        TEXT NOT NULL,                    -- 'admin', 'worker:<workers.id>' or 'probe:<fingerprint>'
  kind          TEXT NOT NULL CHECK (kind IN ('state','measure')),
  available     INTEGER,
  until         INTEGER,
  observed_at   INTEGER NOT NULL,
  lapses_at     INTEGER NOT NULL,                 -- observed_at + valid_for, or `until` if sooner when unavailable
  detail        TEXT,                             -- validated against the served resources' schema, ≤ 4 KB
  posted_by     TEXT NOT NULL,                    -- the key that posted it: 'admin:<fp>', 'worker:<id>', 'probe:<fp>'
  -- Keyed by kind too (spec-vs-code, recorded on R3-1251): §4's (instance, source) would let a
  -- worker's `measure` overwrite its own `state` reading, and a measure must never change the state.
  PRIMARY KEY (instance, source, kind),
  CHECK ((kind = 'state') = (available IS NOT NULL))
);
CREATE INDEX readings_lapse ON instance_readings(lapses_at);   -- the alarm's next lapse
-- Spec-silent (recorded on R3-1251): each instance's state as last evaluated, so a change of state
-- — by a reading or by a lapse the alarm sees — is logged once as a `resource` event and recounts.
CREATE TABLE instance_states (
  instance      TEXT PRIMARY KEY,
  state         TEXT NOT NULL CHECK (state IN ('available','unavailable','unknown')),
  until         INTEGER,
  changed_at    INTEGER NOT NULL
);
CREATE TABLE resource_fleet (                     -- R-BTN-76: per repository and resource, the two counts
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  resource      TEXT NOT NULL,
  usable_workers INTEGER NOT NULL,                -- live granted workers with a usable instance
  open_workers  INTEGER NOT NULL,                 -- of those, with one not unavailable; blocked: usable > 0, open = 0
  PRIMARY KEY (repository_id, resource)
);
CREATE TABLE ticket_decisions (                   -- R-BTN-78: open decisions as the sync posts them
  ticket_id     TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  decision_id   TEXT NOT NULL,
  leg           TEXT NOT NULL DEFAULT '',          -- '' for the whole ticket
  asks          TEXT NOT NULL,
  url           TEXT,
  source        TEXT NOT NULL DEFAULT 'sync' CHECK (source IN ('sync','baton')),
  PRIMARY KEY (ticket_id, decision_id)
);
CREATE TABLE fleet_capabilities (                -- R-BTN-75: live workers granted and declaring each capability
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  capability    TEXT NOT NULL,
  workers       INTEGER NOT NULL,
  PRIMARY KEY (repository_id, capability)
);
CREATE TABLE ticket_blocks (                     -- R-BTN-75: why a ticket cannot move; maintained, never recomputed on read
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  ticket_id    TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  leg          TEXT NOT NULL DEFAULT '',          -- '' for whole-ticket blocks: ticket, capability, a ticket's decision
  kind         TEXT NOT NULL CHECK (kind IN ('ticket','capability','resource','decision')),
  ref          TEXT NOT NULL,
  since        INTEGER NOT NULL,
  until        INTEGER,
  PRIMARY KEY (ticket_id, kind, ref, leg)
);
CREATE INDEX blocks_by_ref ON ticket_blocks(repository_id, kind, ref);

-- R-BTN-77: the coalesced unblocked dispatch — the tickets unblocked in the window, and when the
-- window's trailing dispatch is due (spec-silent, as webhook_dispatch keeps the sync's).
CREATE TABLE unblocked_dispatch (
  repository_id TEXT PRIMARY KEY REFERENCES repositories(id),
  last_sent_at  INTEGER,
  pending_json  TEXT NOT NULL DEFAULT '[]',
  due_at        INTEGER
);

-- The event log gains `blocked`, `unblocked` and `resource`. Nothing references `events`, so it is
-- rebuilt with the wider check, as 0014 did.
CREATE TABLE events_0016 (
  seq           INTEGER PRIMARY KEY,
  at            INTEGER NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('claimed','completed','confirmed',
                  'released','reaped','fence-cleared','adopted','rekeyed','override',
                  'suspension','reviewer-substituted','attempts-exhausted','held','cutover',
                  'snapshot-rejected','snapshot-accepted','shadow-conflict','foreign-claim',
                  'advanced','advice-overridden','off-graph','bars-mismatch','regressed','admin',
                  'blocked','unblocked','resource')),
  ticket_id     TEXT,
  claim_id      INTEGER REFERENCES claims(id),
  actor         TEXT NOT NULL,
  detail_json   TEXT,
  repository_id TEXT
);
INSERT INTO events_0016 (seq, at, kind, ticket_id, claim_id, actor, detail_json, repository_id)
  SELECT seq, at, kind, ticket_id, claim_id, actor, detail_json, repository_id FROM events;
DROP TABLE events;
ALTER TABLE events_0016 RENAME TO events;
CREATE INDEX events_by_ticket ON events(ticket_id, kind, seq);
CREATE INDEX events_by_claim ON events(claim_id, kind, seq);
CREATE INDEX events_by_repository ON events(repository_id, seq);

-- §9 gains the `unblocked` message. Only `messages` itself references `messages`, so it is rebuilt.
CREATE TABLE messages_0016 (
  id              INTEGER PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('release','status_request','status_report','unblocked')),
  payload_json    TEXT,
  from_worker_id  INTEGER REFERENCES workers(id),
  from_principal  TEXT,
  to_worker_id    INTEGER NOT NULL REFERENCES workers(id),
  in_reply_to     INTEGER REFERENCES messages_0016(id),
  sent_at         INTEGER NOT NULL,
  delivered_at    INTEGER,
  acknowledged_at INTEGER,
  status          TEXT NOT NULL CHECK (status IN ('pending','delivered','acknowledged','expired')),
  CHECK (from_worker_id IS NOT NULL OR from_principal IS NOT NULL)
);
INSERT INTO messages_0016 SELECT id, kind, payload_json, from_worker_id, from_principal, to_worker_id, in_reply_to, sent_at, delivered_at, acknowledged_at, status FROM messages;
DROP TABLE messages;
ALTER TABLE messages_0016 RENAME TO messages;
