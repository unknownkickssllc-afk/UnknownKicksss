require("dotenv").config();
const { supabase } = require("../lib/supabase");

const SQL = "ALTER TABLE orders ADD COLUMN IF NOT EXISTS billing_json JSONB;";

async function main() {
  const { error } = await supabase().from("orders").select("billing_json").limit(1);
  if (!error) {
    console.log("billing_json column already exists.");
    return;
  }
  if (!/billing_json/.test(error.message)) throw error;

  console.log("Column missing. Run this in Supabase SQL Editor:");
  console.log(SQL);
  console.log("\nhttps://supabase.com/dashboard/project/fepxpoystmqllibfmgie/sql/new");
  process.exit(1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
