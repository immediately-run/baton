-- R3-1269: the runner read models. Version writes share the source write's transaction.
ALTER TABLE board_head ADD COLUMN fleet_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE board_head ADD COLUMN course_data TEXT NOT NULL DEFAULT '{}';
ALTER TABLE claims ADD COLUMN course_advance_json TEXT;
ALTER TABLE tickets ADD COLUMN course_fields_json TEXT;
ALTER TABLE ticket_history ADD COLUMN rationale_json TEXT;
INSERT INTO baton_settings(key, value) VALUES ('instances_version', '0');

CREATE TABLE runner_reports (
  runner_id INTEGER NOT NULL REFERENCES runners(id) ON DELETE CASCADE,
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  claim_id INTEGER NOT NULL DEFAULT 0,
  key TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (runner_id, repository_id, claim_id, key)
);
CREATE INDEX runner_reports_repository ON runner_reports(repository_id, received_at);
CREATE INDEX runner_reports_received ON runner_reports(received_at);

CREATE TRIGGER runner_view_board AFTER UPDATE OF observation ON board_head
WHEN OLD.observation IS NOT NEW.observation BEGIN
  UPDATE board_head SET fleet_version = fleet_version + 1 WHERE repository_id = NEW.repository_id;
END;

CREATE TRIGGER runner_view_profile AFTER UPDATE OF settings_hash, credential_id ON runners
WHEN OLD.settings_hash IS NOT NEW.settings_hash OR OLD.credential_id IS NOT NEW.credential_id BEGIN
  UPDATE board_head SET fleet_version = fleet_version + 1 WHERE repository_id IN (
    SELECT substr(ticket_id, 1, instr(ticket_id, ':') - 1) FROM claims WHERE runner_id = NEW.id AND status = 'active'
  );
END;

CREATE TRIGGER runner_view_claims_insert AFTER INSERT ON claims BEGIN
  UPDATE board_head SET fleet_version = fleet_version + 1 WHERE repository_id = substr(NEW.ticket_id, 1, instr(NEW.ticket_id, ':') - 1);
END;

CREATE TRIGGER runner_view_claims_update AFTER UPDATE OF status, station, leg, course_advance_json, ticket_id ON claims
WHEN OLD.status IS NOT NEW.status OR OLD.station IS NOT NEW.station OR OLD.leg IS NOT NEW.leg
  OR OLD.course_advance_json IS NOT NEW.course_advance_json OR OLD.ticket_id IS NOT NEW.ticket_id BEGIN
  UPDATE board_head SET fleet_version = fleet_version + 1 WHERE repository_id = substr(NEW.ticket_id, 1, instr(NEW.ticket_id, ':') - 1);
END;

CREATE TRIGGER runner_view_runner_reports_insert AFTER INSERT ON runner_reports BEGIN
  UPDATE board_head SET fleet_version = fleet_version + 1 WHERE repository_id = NEW.repository_id;
END;

CREATE TRIGGER runner_view_runner_reports_update AFTER UPDATE ON runner_reports BEGIN
  UPDATE board_head SET fleet_version = fleet_version + 1 WHERE repository_id = NEW.repository_id;
END;

CREATE TRIGGER runner_view_owner_bars_insert AFTER INSERT ON owner_bars BEGIN
  UPDATE board_head SET fleet_version = fleet_version + 1 WHERE repository_id = NEW.repository_id;
END;

CREATE TRIGGER runner_view_owner_bars_update AFTER UPDATE ON owner_bars BEGIN
  UPDATE board_head SET fleet_version = fleet_version + 1 WHERE repository_id = NEW.repository_id;
END;

CREATE TRIGGER runner_view_owner_bars_delete AFTER DELETE ON owner_bars BEGIN
  UPDATE board_head SET fleet_version = fleet_version + 1 WHERE repository_id = OLD.repository_id;
END;

CREATE TRIGGER runner_view_leg_queues_insert AFTER INSERT ON leg_queues BEGIN
  UPDATE board_head SET fleet_version = fleet_version + 1 WHERE repository_id = NEW.repository_id;
END;

CREATE TRIGGER runner_view_leg_queues_update AFTER UPDATE ON leg_queues BEGIN
  UPDATE board_head SET fleet_version = fleet_version + 1 WHERE repository_id = NEW.repository_id;
END;

CREATE TRIGGER runner_view_leg_queues_delete AFTER DELETE ON leg_queues BEGIN
  UPDATE board_head SET fleet_version = fleet_version + 1 WHERE repository_id = OLD.repository_id;
END;

CREATE TRIGGER runner_view_runner_grants_insert AFTER INSERT ON runner_grants BEGIN
  UPDATE board_head SET fleet_version = fleet_version + 1 WHERE repository_id = NEW.repository_id;
END;

CREATE TRIGGER runner_view_runner_grants_update AFTER UPDATE ON runner_grants BEGIN
  UPDATE board_head SET fleet_version = fleet_version + 1 WHERE repository_id = NEW.repository_id;
END;

CREATE TRIGGER runner_view_runner_grants_delete AFTER DELETE ON runner_grants BEGIN
  UPDATE board_head SET fleet_version = fleet_version + 1 WHERE repository_id = OLD.repository_id;
END;

CREATE TRIGGER runner_view_resource_instances_insert AFTER INSERT ON resource_instances BEGIN
  UPDATE baton_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'instances_version';
END;

CREATE TRIGGER runner_view_resource_instances_update AFTER UPDATE ON resource_instances BEGIN
  UPDATE baton_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'instances_version';
END;

CREATE TRIGGER runner_view_resource_instances_delete AFTER DELETE ON resource_instances BEGIN
  UPDATE baton_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'instances_version';
END;

CREATE TRIGGER runner_view_instance_readings_insert AFTER INSERT ON instance_readings BEGIN
  UPDATE baton_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'instances_version';
END;

CREATE TRIGGER runner_view_instance_readings_update AFTER UPDATE ON instance_readings BEGIN
  UPDATE baton_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'instances_version';
END;

CREATE TRIGGER runner_view_instance_readings_delete AFTER DELETE ON instance_readings BEGIN
  UPDATE baton_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'instances_version';
END;

CREATE TRIGGER runner_view_instance_serves_insert AFTER INSERT ON instance_serves BEGIN
  UPDATE baton_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'instances_version';
END;

CREATE TRIGGER runner_view_instance_serves_update AFTER UPDATE ON instance_serves BEGIN
  UPDATE baton_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'instances_version';
END;

CREATE TRIGGER runner_view_instance_serves_delete AFTER DELETE ON instance_serves BEGIN
  UPDATE baton_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'instances_version';
END;

CREATE TRIGGER runner_view_capability_capacity_insert AFTER INSERT ON capability_capacity BEGIN
  UPDATE baton_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'instances_version';
END;

CREATE TRIGGER runner_view_capability_capacity_update AFTER UPDATE ON capability_capacity BEGIN
  UPDATE baton_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'instances_version';
END;

CREATE TRIGGER runner_view_capability_capacity_delete AFTER DELETE ON capability_capacity BEGIN
  UPDATE baton_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'instances_version';
END;

CREATE TRIGGER runner_view_claim_seats_insert AFTER INSERT ON claim_seats BEGIN
  UPDATE baton_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'instances_version';
END;

CREATE TRIGGER runner_view_claim_seats_update AFTER UPDATE ON claim_seats BEGIN
  UPDATE baton_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'instances_version';
END;

CREATE TRIGGER runner_view_claim_seats_delete AFTER DELETE ON claim_seats BEGIN
  UPDATE baton_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'instances_version';
END;

CREATE TRIGGER runner_view_seat_holder AFTER UPDATE OF status, leg, fence_pending, ticket_id ON claims
WHEN (OLD.status IS NOT NEW.status OR OLD.leg IS NOT NEW.leg OR OLD.fence_pending IS NOT NEW.fence_pending OR OLD.ticket_id IS NOT NEW.ticket_id)
 AND EXISTS (SELECT 1 FROM claim_seats WHERE claim_id = NEW.id) BEGIN
  UPDATE baton_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'instances_version';
END;
