const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const migration = fs.readFileSync(path.join(__dirname, "../supabase/migrations/20261013171539_automatic_business_analytics.sql"), "utf8");

test("database snapshots preserve historical margins and private role access", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE products(id BIGINT PRIMARY KEY);
      CREATE TABLE order_items(id BIGINT PRIMARY KEY, product_id BIGINT NOT NULL);
      GRANT USAGE ON SCHEMA public TO service_role;
      GRANT ALL ON products, order_items TO service_role;
      INSERT INTO products VALUES(1),(2); INSERT INTO order_items VALUES(1,1);`);
    await db.exec(migration);
    await db.exec(migration);
    assert.equal((await db.query("SELECT unit_cost FROM os_order_item_costs WHERE order_item_id=1")).rows[0].unit_cost, null, "never guess earlier sale costs");
    await db.exec("SET ROLE service_role; INSERT INTO os_product_costs(product_id,unit_cost) VALUES(1,20); INSERT INTO order_items VALUES(2,1),(3,2);");
    assert.equal(Number((await db.query("SELECT unit_cost FROM os_order_item_costs WHERE order_item_id=2")).rows[0].unit_cost), 20);
    assert.equal((await db.query("SELECT unit_cost FROM os_order_item_costs WHERE order_item_id=3")).rows[0].unit_cost, null);
    await db.exec("UPDATE os_product_costs SET unit_cost=30 WHERE product_id=1; INSERT INTO order_items VALUES(4,1);");
    assert.equal(Number((await db.query("SELECT unit_cost FROM os_order_item_costs WHERE order_item_id=2")).rows[0].unit_cost), 20, "changing future defaults never rewrites a historical snapshot");
    assert.equal(Number((await db.query("SELECT unit_cost FROM os_order_item_costs WHERE order_item_id=4")).rows[0].unit_cost), 30);
    await db.exec("UPDATE os_order_item_costs SET unit_cost=19,source='admin' WHERE order_item_id=2; RESET ROLE;");
    const permissions = await db.query(`SELECT relrowsecurity AS rls, has_table_privilege('anon',oid,'SELECT') AS anon_read,
      has_table_privilege('authenticated',oid,'SELECT') AS client_read,
      has_table_privilege('service_role',oid,'INSERT') AS server_write
      FROM pg_class WHERE relname IN ('os_product_costs','os_order_item_costs') ORDER BY relname;`);
    assert.equal(permissions.rows.length, 2);
    for (const p of permissions.rows) assert.deepEqual(p, { rls: true, anon_read: false, client_read: false, server_write: true });
    await db.exec("SET ROLE anon;");
    await assert.rejects(db.query("SELECT * FROM public.os_product_costs"), /permission denied/);
    await assert.rejects(db.query("SELECT * FROM public.os_order_item_costs"), /permission denied/);
    await db.exec("RESET ROLE;");
    const fn = await db.query("SELECT prosecdef FROM pg_proc JOIN pg_namespace ON pg_namespace.oid=pronamespace WHERE nspname='os_private' AND proname='snapshot_order_item_cost'");
    assert.equal(fn.rows[0].prosecdef, false, "trigger must use caller privileges");
    await assert.rejects(db.exec("INSERT INTO os_product_costs(product_id,unit_cost) VALUES(2,-1)"), /check constraint/);
  } finally { await db.close(); }
});
