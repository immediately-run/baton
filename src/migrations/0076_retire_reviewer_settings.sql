-- B-285: only the old board sync wrote these settings; no Baton read uses them.
DROP TABLE reviewer_agents;
DELETE FROM baton_settings WHERE key IN ('reviewer_matrix', 'reviewer_catalog');
