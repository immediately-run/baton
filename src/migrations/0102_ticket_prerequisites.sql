ALTER TABLE tickets ADD COLUMN depends_at TEXT NOT NULL DEFAULT '[]';
ALTER TABLE closed_tickets ADD COLUMN final_station TEXT;
ALTER TABLE closed_tickets ADD COLUMN final_path TEXT;
ALTER TABLE closed_tickets ADD COLUMN course_id TEXT;

CREATE TABLE ticket_dependents (
  ticket_id TEXT NOT NULL,
  leg TEXT NOT NULL,
  ref TEXT NOT NULL,
  on_ticket TEXT NOT NULL,
  predicate TEXT NOT NULL,
  target_course TEXT,
  skip_withdrawn INTEGER NOT NULL,
  allow_empty INTEGER NOT NULL,
  why TEXT,
  station TEXT,
  cycle INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ticket_id, leg, ref)
);
CREATE INDEX ticket_dependents_by_target ON ticket_dependents(on_ticket, ticket_id);
