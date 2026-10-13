// Real HTTP server with only the database boundary replaced. No test reaches Supabase.
const tables = new Map([
  ["business_members", [{ id: 1, name: "Test partner", active: true }]],
  ["funding_accounts", []],
  ["inventory_deals", []],
  ["inventory_assets", []],
  ["consignment_positions", []],
  ["budget_buckets", []],
  ["operating_expenses", []],
  ["referral_programs", []],
  ["products", [{ id: 1, name: "Fixture shirt", product_variants: [{ stock: 3 }], os_product_costs: { unit_cost: 20 } }]],
  ["orders", [
    { id: 1, order_number: "FIXTURE-PAID", stripe_session_id: "pi_fixture", created_at: new Date().toISOString(), payment_status: "paid", total: 100, customer_id: 1, commissions: [{ amount: 5 }], order_items: [{ id: 1, product_id: 1, product_name: "Fixture shirt", quantity: 2, line_total: 100, os_order_item_costs: { unit_cost: 20 } }] },
    { id: 2, order_number: "FIXTURE-PENDING", created_at: new Date().toISOString(), payment_status: "pending", total: 9999, order_items: [] },
    { id: 3, order_number: "FIXTURE-DUPLICATE", stripe_session_id: "pi_fixture", created_at: new Date().toISOString(), payment_status: "paid", total: 100, order_items: [] },
  ]],
  ["order_items", [{ id: 1, orders: { payment_status: "paid" } }]],
  ["os_product_costs", []],
  ["os_order_item_costs", []],
  ["os_historical_records", [{ source_key: "fixture-capacity", section: "capital", title: "Prior capacity", reported_on: "2026-06-01", confidence: "user_reported", value_text: "$120–$180", detail: "Historical buying capacity, not cash", source_ref: "Synthetic fixture", sort_order: 1 }]],
  ["os_history_overrides", []],
  ["os_sheet_imports", [{ source_key: "primary-reselling-sheet", imported_at: "2026-10-01T12:00:00Z", source_title: "Fixture sheet", source_url: "https://docs.google.com/spreadsheets/d/fixture/edit", payload: { periods: [{ label: "June and July", revenue: 200, recordedProfit: 30, purchaseCost: 1400, rowCount: 4 }], items: [], expenses: [], notes: ["Period only; exact sale dates missing"] } }]],
]);
let databaseCalls = 0;

function from(name) {
  databaseCalls += 1;
  if (!tables.has(name)) throw new Error(`Unexpected test database table: ${name}`);
  let result = tables.get(name);
  let single = false;
  let updatePayload;
  const query = {
    select() { return query; },
    eq(column, value) {
      result = result.filter((row) => row[column] === value);
      return query;
    },
    order() { return query; },
    update(payload) { updatePayload = payload; return query; },
    range(start, end) { result = result.slice(start, end + 1); return query; },
    insert(payload) {
      const rows = (Array.isArray(payload) ? payload : [payload]).map((row) => ({
        id: tables.get(name).length + 1,
        ...row,
      }));
      tables.get(name).push(...rows);
      result = rows;
      return query;
    },
    single() { single = true; return query; },
    maybeSingle() { single = true; return query; },
    upsert(payload, { onConflict }) {
      const existing = tables.get(name).find(row => row[onConflict] === payload[onConflict]);
      if (existing) Object.assign(existing, payload);
      else tables.get(name).push({ ...payload });
      result = [payload];
      return query;
    },
    then(resolve, reject) {
      if (updatePayload) result.forEach(row => Object.assign(row, updatePayload));
      return Promise.resolve({ data: single ? result[0] : result, error: null })
        .then(resolve, reject);
    },
  };
  return query;
}

const supabaseModule = require("../../server/lib/supabase");
supabaseModule.supabase = () => ({ from });
supabaseModule.getSupabase = supabaseModule.supabase;
// A regression must fail locally instead of ever calling a real external API.
global.fetch = async () => { throw new Error("External network is disabled in auth tests"); };

const app = require("../../server.js");
const server = app.listen(0, "127.0.0.1", () => {
  process.send({ type: "ready", port: server.address().port });
});
process.on("message", (message) => {
  if (message.type === "stats") {
    process.send({ type: "stats", id: message.id, databaseCalls });
  }
});
process.on("disconnect", () => server.close(() => process.exit(0)));
