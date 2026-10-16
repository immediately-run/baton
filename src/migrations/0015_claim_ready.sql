-- 0015_claim_ready.sql — R3-1248 (BATON_SPEC §2d, the course record; review gate round 2,
-- 2-r2-2): when the leg a claim was offered had been ready since, so a ticket's first wait — from
-- its leg turning ready to its first claim — is on record, not only the waits between claims.
-- And an index for the record's per-ticket history (2-r2-0): the claims of a ticket in order.
ALTER TABLE claims ADD COLUMN offered_ready_since INTEGER;
CREATE INDEX claims_by_ticket ON claims(ticket_id, claimed_at, id);
