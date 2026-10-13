const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const migration = fs.readFileSync(path.join(__dirname, "../supabase/migrations/20261013191734_import_business_history.sql"), "utf8");
const overridesMigration = fs.readFileSync(path.join(__dirname, "../supabase/migrations/20261013203019_add_history_overrides.sql"), "utf8");

test("history corrections have private RLS, stable keys, and atomic version predicates", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; GRANT USAGE ON SCHEMA public TO service_role;");
    await db.exec(overridesMigration);
    await db.exec(overridesMigration);
    const security = (await db.query("SELECT relrowsecurity AS rls, has_table_privilege('anon',oid,'SELECT') AS anon_read, has_table_privilege('authenticated',oid,'UPDATE') AS client_write FROM pg_class WHERE relname = 'os_history_overrides'")).rows[0];
    assert.deepEqual(security, { rls: true, anon_read: false, client_write: false });
    await db.exec("SET ROLE service_role;");
    await db.exec("INSERT INTO os_history_overrides(entity_type, source_key, patch, updated_at) VALUES ('items', 'fixture-item', '{\"notes\":\"Original edit\"}', '2026-01-01T00:00:00.000Z')");
    await assert.rejects(db.exec("INSERT INTO os_history_overrides(entity_type, source_key) VALUES ('items', 'fixture-item')"), /duplicate key/);
    const first = await db.query("UPDATE os_history_overrides SET patch = '{\"notes\":\"First save\"}', updated_at = '2026-01-01T00:00:00.001Z' WHERE entity_type = 'items' AND source_key = 'fixture-item' AND updated_at = '2026-01-01T00:00:00.000Z' RETURNING patch");
    const stale = await db.query("UPDATE os_history_overrides SET patch = '{\"notes\":\"Stale save\"}' WHERE entity_type = 'items' AND source_key = 'fixture-item' AND updated_at = '2026-01-01T00:00:00.000Z' RETURNING patch");
    assert.equal(first.rows.length, 1);
    assert.equal(stale.rows.length, 0);
    await db.exec("RESET ROLE; SET ROLE anon;");
    await assert.rejects(db.query("SELECT * FROM os_history_overrides"), /permission denied/);
  } finally { await db.close(); }
});

test("history imports are private, preserve uncertainty, and are idempotent by source key", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; GRANT USAGE ON SCHEMA public TO service_role;");
    await db.exec(migration);
    await db.exec(migration);
    await db.exec("SET ROLE service_role;");
    const insert = `INSERT INTO os_historical_records(source_key,section,title,confidence,value_text,source_ref)
      VALUES('fixture','capital','Unconfirmed capacity','user_reported','$120–$180','Synthetic source')
      ON CONFLICT(source_key) DO UPDATE SET value_text=excluded.value_text;`;
    await db.exec(insert); await db.exec(insert);
    const rows = (await db.query("SELECT reported_on,value_text FROM os_historical_records")).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].reported_on, null, "unknown date must not become today");
    assert.equal(rows[0].value_text, "$120–$180");
    await db.exec(`INSERT INTO os_sheet_imports(source_key,source_title,source_url,payload,source_payload)
      VALUES('primary-reselling-sheet','Fixture','https://example.com','{"periods":[{"label":"June and July","recordedProfit":null}]}','{"originalCells":{"I3":null}}');`);
    assert.equal((await db.query("SELECT payload->'periods'->0->>'recordedProfit' AS profit FROM os_sheet_imports")).rows[0].profit, null);
    await db.exec("RESET ROLE;");
    const permissions = (await db.query(`SELECT relrowsecurity AS rls,
      has_table_privilege('anon',oid,'SELECT') AS anon_read,
      has_table_privilege('authenticated',oid,'SELECT') AS client_read,
      has_table_privilege('service_role',oid,'INSERT') AS server_write
      FROM pg_class WHERE relname IN ('os_historical_records','os_sheet_imports')`)).rows;
    assert.equal(permissions.length, 2);
    for (const p of permissions) assert.deepEqual(p, { rls: true, anon_read: false, client_read: false, server_write: true });
    await db.exec("SET ROLE anon;");
    for (const table of ["os_historical_records", "os_sheet_imports"]) await assert.rejects(db.query(`SELECT * FROM ${table}`), /permission denied/);
  } finally { await db.close(); }
});
