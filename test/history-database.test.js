const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const migration = fs.readFileSync(path.join(__dirname, "../supabase/migrations/20261013191734_import_business_history.sql"), "utf8");

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
