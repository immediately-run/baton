-- 0030_capacity_seats.sql — (0029 is B-145's repository-policies on main; B-107's unmerged 0028 holds its number) a capability with a capacity has that many seats (BATON_SPEC §6.11
-- R-BTN-178, B-106): the tenant's capacities, an administrator's statement, and the seats the
-- claims hold for the legs they started — written at a claim for the leg it is for and at each
-- advance for the leg it starts, deleted at the claim's end, at a reap that is not
-- fence-pending, and, for a fence-pending reap (R-BTN-19), at `fence-cleared` or the fence
-- deadline: until then a reaped incarnation that may still be driving the device keeps its seat.

-- The tenant's capacities (R-BTN-178): a capability with no row has unlimited seats. A lower
-- capacity never takes back a held seat — it applies to the next claim or advance. `set_by`
-- names the administrator's key that set it.
CREATE TABLE capability_capacity (
  capability TEXT PRIMARY KEY,
  capacity   INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 64),
  set_by     TEXT NOT NULL,
  set_at     INTEGER NOT NULL
);

-- The seats a claim holds (R-BTN-178): one row per capability with a capacity in rule 4's set
-- for the leg the claim started. The rows are the seats counted, across every repository of the
-- tenant (R-BTN-137) — one pool, one name, whatever holds them.
CREATE TABLE claim_seats (
  claim_id   INTEGER NOT NULL REFERENCES claims(id),
  capability TEXT NOT NULL,
  PRIMARY KEY (claim_id, capability)
) WITHOUT ROWID;
CREATE INDEX seats_by_capability ON claim_seats(capability, claim_id);
