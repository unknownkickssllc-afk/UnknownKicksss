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
]);
let databaseCalls = 0;

function from(name) {
  databaseCalls += 1;
  if (!tables.has(name)) throw new Error(`Unexpected test database table: ${name}`);
  let result = tables.get(name);
  let single = false;
  const query = {
    select() { return query; },
    eq(column, value) {
      result = result.filter((row) => row[column] === value);
      return query;
    },
    order() { return query; },
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
    then(resolve, reject) {
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
