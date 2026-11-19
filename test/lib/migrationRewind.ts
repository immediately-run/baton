// Rewinding a migrated database must remove views and cross-table triggers before their
// source tables. SQLite otherwise keeps an invalid view while older ALTER TABLEs run.
export function dropDerivedSchema(sql: SqlStorage): void {
  const objects = sql.exec("SELECT type, name FROM sqlite_master WHERE type IN ('view', 'trigger')").toArray() as { type: string; name: string }[];
  for (const o of objects) sql.exec(`DROP ${o.type.toUpperCase()} "${o.name.replaceAll('"', '""')}"`);
}
