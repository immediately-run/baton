-- B-239 / S-BTN-73: effective declared holdings (rule 4). The empty repository key
-- represents an interim credential's tenant-wide allow-list, without copying it to every repo.
CREATE TABLE runner_effective_caps (
  runner_id INTEGER NOT NULL REFERENCES runners(id) ON DELETE CASCADE,
  repository_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  PRIMARY KEY (runner_id, repository_id, capability)
) WITHOUT ROWID;
CREATE INDEX runner_effective_caps_by_holding ON runner_effective_caps(runner_id, capability);

-- Only used on writes. Read the grant source, rather than depending on the firing order
-- of the existing grant_capabilities triggers. Match the capability type literally.
CREATE VIEW runner_effective_cap_source AS
SELECT h.runner_id, g.repository_id, h.capability
FROM runner_capabilities h JOIN runners w ON w.id = h.runner_id
JOIN credentials k ON k.id = w.credential_id
JOIN runner_grants g ON g.credential_id = k.id
WHERE k.revoked_at IS NULL AND g.revoked_at IS NULL
  AND (k.created_by GLOB 'owner:*' OR k.created_by GLOB 'admin:*')
  AND (h.capability GLOB 'runner:*' OR EXISTS (
    SELECT 1 FROM json_each(g.capabilities) j
    WHERE j.value = h.capability OR j.value = substr(h.capability, 1, instr(h.capability || ':', ':') - 1) || ':*'
  ))
UNION ALL
SELECT h.runner_id, '', h.capability
FROM runner_capabilities h JOIN runners w ON w.id = h.runner_id
JOIN credentials k ON k.id = w.credential_id
WHERE k.revoked_at IS NULL AND COALESCE(k.created_by, '') NOT GLOB 'owner:*'
  AND COALESCE(k.created_by, '') NOT GLOB 'admin:*'
  AND (h.capability GLOB 'runner:*' OR EXISTS (
    SELECT 1 FROM json_each(k.allowed_capabilities) j
    WHERE j.value = h.capability OR j.value = substr(h.capability, 1, instr(h.capability || ':', ':') - 1) || ':*'
  ));

INSERT INTO runner_effective_caps SELECT * FROM runner_effective_cap_source;

CREATE TRIGGER effective_holding_insert AFTER INSERT ON runner_capabilities BEGIN
  INSERT INTO runner_effective_caps SELECT * FROM runner_effective_cap_source
    WHERE runner_id = NEW.runner_id AND capability = NEW.capability;
END;
CREATE TRIGGER effective_holding_delete AFTER DELETE ON runner_capabilities BEGIN
  DELETE FROM runner_effective_caps WHERE runner_id = OLD.runner_id AND capability = OLD.capability;
END;
CREATE TRIGGER effective_holding_update AFTER UPDATE OF runner_id, capability ON runner_capabilities
WHEN OLD.runner_id IS NOT NEW.runner_id OR OLD.capability IS NOT NEW.capability BEGIN
  DELETE FROM runner_effective_caps WHERE runner_id = OLD.runner_id AND capability = OLD.capability;
  INSERT INTO runner_effective_caps SELECT * FROM runner_effective_cap_source
    WHERE runner_id = NEW.runner_id AND capability = NEW.capability;
END;

CREATE TRIGGER effective_grant_insert AFTER INSERT ON runner_grants WHEN NEW.revoked_at IS NULL BEGIN
  INSERT INTO runner_effective_caps SELECT * FROM runner_effective_cap_source WHERE repository_id = NEW.repository_id
    AND runner_id IN (SELECT id FROM runners WHERE credential_id = NEW.credential_id);
END;
CREATE TRIGGER effective_grant_delete AFTER DELETE ON runner_grants BEGIN
  DELETE FROM runner_effective_caps WHERE repository_id = OLD.repository_id
    AND runner_id IN (SELECT id FROM runners WHERE credential_id = OLD.credential_id);
END;
CREATE TRIGGER effective_grant_update AFTER UPDATE OF capabilities, revoked_at ON runner_grants
WHEN OLD.capabilities IS NOT NEW.capabilities OR OLD.revoked_at IS NOT NEW.revoked_at BEGIN
  DELETE FROM runner_effective_caps WHERE repository_id = NEW.repository_id
    AND runner_id IN (SELECT id FROM runners WHERE credential_id = NEW.credential_id);
  INSERT INTO runner_effective_caps SELECT * FROM runner_effective_cap_source WHERE repository_id = NEW.repository_id
    AND runner_id IN (SELECT id FROM runners WHERE credential_id = NEW.credential_id);
END;
CREATE TRIGGER effective_credential_update AFTER UPDATE OF allowed_capabilities, created_by, revoked_at ON credentials
WHEN OLD.allowed_capabilities IS NOT NEW.allowed_capabilities OR OLD.created_by IS NOT NEW.created_by OR OLD.revoked_at IS NOT NEW.revoked_at BEGIN
  DELETE FROM runner_effective_caps WHERE runner_id IN (SELECT id FROM runners WHERE credential_id = NEW.id);
  INSERT INTO runner_effective_caps SELECT * FROM runner_effective_cap_source
    WHERE runner_id IN (SELECT id FROM runners WHERE credential_id = NEW.id);
END;
CREATE TRIGGER effective_runner_move AFTER UPDATE OF credential_id ON runners
WHEN OLD.credential_id IS NOT NEW.credential_id BEGIN
  DELETE FROM runner_effective_caps WHERE runner_id = NEW.id;
  INSERT INTO runner_effective_caps SELECT * FROM runner_effective_cap_source WHERE runner_id = NEW.id;
END;

-- A webhook only needs to know whether any ticket in a home names the pushed repo.
-- Index both keys so it can stop at the first match, even if every ticket names it.
ALTER TABLE ticket_repositories ADD COLUMN repository_id TEXT NOT NULL DEFAULT '';
UPDATE ticket_repositories SET repository_id = (SELECT repository_id FROM tickets WHERE id = ticket_id);
DROP INDEX ticket_repositories_reverse;
CREATE INDEX ticket_repositories_reverse ON ticket_repositories(repository_key, repository_id, ticket_id);
DROP TRIGGER matching_tickets_insert;
DROP TRIGGER matching_tickets_update;
CREATE TRIGGER matching_tickets_insert AFTER INSERT ON tickets BEGIN
  INSERT OR IGNORE INTO ticket_repositories (ticket_id, repository_key, repository_id)
  SELECT NEW.id, lower(value), NEW.repository_id FROM json_each(NEW.repos);
END;
CREATE TRIGGER matching_tickets_update AFTER UPDATE OF repos, repository_id ON tickets
WHEN OLD.repos IS NOT NEW.repos OR OLD.repository_id IS NOT NEW.repository_id BEGIN
  DELETE FROM ticket_repositories WHERE ticket_id = NEW.id;
  INSERT OR IGNORE INTO ticket_repositories (ticket_id, repository_key, repository_id)
  SELECT NEW.id, lower(value), NEW.repository_id FROM json_each(NEW.repos);
END;
