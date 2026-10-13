const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { once } = require("node:events");
const { validateEdit, updateRecord, recordTypes } = require("../server/services/osRecords");

const version = "2026-10-13T12:00:00.123456+00:00";
function fixture(kind, overrides = {}) {
  const fields = {};
  for (const key of Object.keys(recordTypes[kind].fields)) fields[key] = null;
  for (const key of recordTypes[kind].guard || []) fields[key] = null;
  return { id: 1, ...fields, updated_at: version, ...overrides };
}
function fakeDatabase(initial, options = {}) {
  const tables = structuredClone(initial);
  const calls = [];
  return {
    tables, calls,
    from(table) {
      let patch = null, filters = [], limit = Infinity;
      const query = {
        select() { return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        is(key, value) { filters.push([key, value]); return query; },
        limit(value) { limit = value; return query; },
        update(value) { patch = value; calls.push({ table, patch }); return query; },
        async maybeSingle() { return execute(true); },
        then(resolve, reject) { return Promise.resolve(execute(false)).then(resolve, reject); },
      };
      function execute(single) {
        if (patch && options.beforeUpdate) options.beforeUpdate(tables);
        if (options.error) return { data: null, error: options.error };
        const matches = (tables[table] || []).filter(row => filters.every(([key, value]) => row[key] === value)).slice(0, limit);
        if (patch) matches.forEach(row => Object.assign(row, patch));
        return { data: single ? structuredClone(matches[0] || null) : structuredClone(matches), error: null };
      }
      return query;
    },
  };
}

test("owner edits validate values and reject ownership, keys, blank money, and impossible dates", () => {
  for (const value of ["", " ", null, false, -1, Infinity, NaN, "1e2", "0x10", "12.345"]) {
    assert.throws(() => validateEdit("funding-accounts", 1, { business_balance: value, expected_updated_at: version }), /number|decimal/);
  }
  for (const id of ["-1", "0", "1.2", "01", "abc", "9007199254740993"]) {
    assert.throws(() => validateEdit("funding-accounts", id, { label: "Cash", expected_updated_at: version }), /valid record/);
  }
  for (const forbidden of ["id", "member_id", "ownership_type", "contributions", "created_at", "updated_at"]) {
    assert.throws(() => validateEdit("deals", 1, { [forbidden]: "changed", expected_updated_at: version }), /cannot be changed/);
  }
  assert.throws(() => validateEdit("deals", 1, { purchased_at: "2026-02-30", expected_updated_at: version }), /valid date/);
  assert.throws(() => validateEdit("deals", 1, { status: "closed", expected_updated_at: version }), /supported option/);
  assert.throws(() => validateEdit("referral-programs", 1, { active: "false", expected_updated_at: version }), /true or false/);
  assert.throws(() => validateEdit("consignments", 1, { fee_percent: 101, expected: {} }), /decimal/);
  assert.throws(() => validateEdit("expenses", 1, { amount: 0, expected: {} }), /positive/);
  assert.equal(validateEdit("funding-accounts", 1, { credit_limit: null, expected_updated_at: version }).changes.credit_limit, null);
});

test("a partial account edit preserves owner, balances, and untouched fields", async () => {
  const original = fixture("funding-accounts", { member_id: 2, label: "Business card", business_balance: 100, notes: "Original" });
  const sb = fakeDatabase({ funding_accounts: [original] });
  const result = await updateRecord(sb, "funding-accounts", "1", { label: "New card label", expected_updated_at: version });
  assert.equal(result.label, "New card label");
  assert.equal(result.member_id, 2);
  assert.equal(result.business_balance, 100);
  assert.equal(result.notes, "Original");
  assert.notEqual(result.updated_at, version);
  assert.deepEqual(Object.keys(sb.calls[0].patch).sort(), ["label", "updated_at"]);
});

test("all five record types support isolated updates", async () => {
  const cases = [
    ["funding-accounts", { available_to_business: "400.50" }],
    ["deals", { status: "partially_sold" }],
    ["consignments", { payout_status: "pending" }],
    ["expenses", { notes: "Receipt corrected" }],
    ["referral-programs", { active: false }],
  ];
  for (const [kind, changes] of cases) {
    const original = fixture(kind);
    const sb = fakeDatabase({ [recordTypes[kind].table]: [original] });
    const expected = recordTypes[kind].timestamp ? { expected_updated_at: version } : { expected: original };
    const saved = await updateRecord(sb, kind, 1, { ...changes, ...expected });
    const key = Object.keys(changes)[0];
    assert.equal(saved[key], kind === "funding-accounts" ? 400.5 : changes[key]);
  }
});

test("missing records and stale edits fail without overwriting another owner", async () => {
  await assert.rejects(updateRecord(fakeDatabase({}), "deals", 1, { title: "Missing", expected_updated_at: version }), { status: 404 });
  const original = fixture("deals", { title: "Original" });
  const stale = fakeDatabase({ inventory_deals: [{ ...original, updated_at: "2026-10-13T13:00:00.000Z" }] });
  await assert.rejects(updateRecord(stale, "deals", 1, { title: "Stale", expected_updated_at: version }), { status: 409 });
  assert.equal(stale.calls.length, 0);
  const race = fakeDatabase({ inventory_deals: [original] }, { beforeUpdate: tables => { tables.inventory_deals[0].updated_at = "2026-10-13T14:00:00.000Z"; } });
  await assert.rejects(updateRecord(race, "deals", 1, { title: "Race", expected_updated_at: version }), { status: 409 });
  assert.equal(race.tables.inventory_deals[0].title, "Original");
});

test("timestamp-less consignment and expense edits compare complete original fields atomically", async () => {
  for (const kind of ["consignments", "expenses"]) {
    const original = fixture(kind, { notes: "Original" });
    const table = recordTypes[kind].table;
    const stale = fakeDatabase({ [table]: [{ ...original, notes: "Other owner" }] });
    await assert.rejects(updateRecord(stale, kind, 1, { notes: "Overwrite", expected: original }), { status: 409 });
    assert.equal(stale.calls.length, 0);
    const race = fakeDatabase({ [table]: [original] }, { beforeUpdate: tables => { tables[table][0].notes = "Concurrent"; } });
    await assert.rejects(updateRecord(race, kind, 1, { notes: "Overwrite", expected: original }), { status: 409 });
    assert.equal(race.tables[table][0].notes, "Concurrent");
    assert.throws(() => validateEdit(kind, 1, { notes: "Partial snapshot", expected: { notes: "Original" } }), /Refresh/);
  }
});

test("changing totals cannot silently invalidate existing partner splits or contributions", async () => {
  for (const [kind, field, amount] of [["expenses", "amount", 100], ["deals", "total_cost", 100]]) {
    const config = recordTypes[kind];
    const original = fixture(kind, { [field]: amount });
    const sb = fakeDatabase({ [config.table]: [original], [config.dependent.table]: [{ id: 2, [config.dependent.key]: 1 }] });
    const expected = config.timestamp ? { expected_updated_at: version } : { expected: original };
    await assert.rejects(updateRecord(sb, kind, 1, { [field]: 200, ...expected }), { status: 409 });
    assert.equal(sb.calls.length, 0);
    const result = await updateRecord(sb, kind, 1, { [field]: amount, notes: "Description fixed", ...expected });
    assert.equal(result[field], amount);
  }
});

test("record edit routes enforce admin access, private caching, response shape, and safe failures", async () => {
  const oldPin = process.env.ADMIN_PIN, oldSecret = process.env.SESSION_SECRET;
  process.env.ADMIN_PIN = "1357";
  process.env.SESSION_SECRET = "unit-test-secret-that-is-long-enough";
  const { createRouter } = require("../server/routes/osRecords");
  const sb = fakeDatabase({ referral_programs: [fixture("referral-programs", { name: "Rule", active: true })] });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { if (req.headers["x-test-admin"] === "yes") req.session = { adminAuthenticated: true }; next(); });
  let databaseFailure = false;
  app.use("/api/os", createRouter(() => {
    if (databaseFailure) throw new Error("Internal database response with private credentials");
    return sb;
  }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/api/os`;
  try {
    for (const kind of Object.keys(recordTypes)) {
      const response = await fetch(`${base}/${kind}/1`, { method: "PATCH", headers: { "content-type": "application/json" }, body: "{}" });
      assert.equal(response.status, 401);
      assert.match(response.headers.get("cache-control"), /no-store/);
    }
    const saved = await fetch(`${base}/referral-programs/1`, {
      method: "PATCH", headers: { "content-type": "application/json", "x-test-admin": "yes" },
      body: JSON.stringify({ active: false, expected_updated_at: version }),
    });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).active, false);
    assert.match(saved.headers.get("cache-control"), /private, no-store/);
    const invalid = await fetch(`${base}/referral-programs/1`, {
      method: "PATCH", headers: { "content-type": "application/json", "x-test-admin": "yes" }, body: JSON.stringify({ id: 2 }),
    });
    assert.equal(invalid.status, 400);
    databaseFailure = true;
    const failure = await fetch(`${base}/referral-programs/1`, {
      method: "PATCH", headers: { "content-type": "application/json", "x-test-admin": "yes" },
      body: JSON.stringify({ active: true, expected_updated_at: version }),
    });
    assert.equal(failure.status, 500);
    assert.doesNotMatch(await failure.text(), /credentials|Internal database/);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    if (oldPin === undefined) delete process.env.ADMIN_PIN; else process.env.ADMIN_PIN = oldPin;
    if (oldSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = oldSecret;
  }
});
