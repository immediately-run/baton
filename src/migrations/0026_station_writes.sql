-- 0026_station_writes.sql — an accepted snapshot writes only the station rows that changed
-- (BATON_SPEC R-BTN-70, S-BTN-188). Every row in `ticket_stations` was placed by its
-- repository's latest snapshot to post stations (a live ticket that snapshot does not place is
-- cleared), so the observation that placed it is the repository's, recorded once here; a row's
-- own `observation` is the reading that last changed it. Before this, every post rewrote every
-- live ticket's station, next legs and bars, changed or not — about 1,600 rows for a 270-ticket
-- board — and a busy day's syncs spent the Workers Free plan's 100,000 rows written (R-BTN-2).
ALTER TABLE board_head ADD COLUMN stations_observation INTEGER;
