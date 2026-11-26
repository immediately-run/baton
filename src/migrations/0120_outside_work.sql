-- R-BTN-39: filtered outside-work evidence and the leg displaced to weigh it.
ALTER TABLE ticket_stations ADD COLUMN changed_at INTEGER NOT NULL DEFAULT 0;
CREATE TABLE ticket_evidence (
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  ref TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('mention', 'merged-early', 'fact')),
  leg TEXT,
  found_at INTEGER NOT NULL,
  claim_id INTEGER,
  weighed_at INTEGER,
  -- The read's cursor tiebreak, as 0140's insertion_order (B-278: no rowid).
  insertion_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ticket_id, ref)
);
CREATE INDEX evidence_unweighed ON ticket_evidence(ticket_id) WHERE weighed_at IS NULL;

CREATE TABLE reconcile_displaced (
  ticket_id TEXT PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  leg TEXT NOT NULL,
  station TEXT NOT NULL,
  recorded_at INTEGER NOT NULL
);

CREATE TABLE pending_fact_arrivals (
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  ref TEXT NOT NULL,
  leg TEXT NOT NULL,
  reached TEXT NOT NULL,
  next_leg TEXT,
  found_at INTEGER NOT NULL,
  PRIMARY KEY (ticket_id, ref)
);
