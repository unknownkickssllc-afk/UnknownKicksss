require("dotenv").config();
const data = require("../data");
const { isSupabaseConfigured } = require("../lib/supabase");

async function main() {
  const before = await data.countProducts();
  await data.clearDemoData();
  const after = await data.countProducts();

  console.log("Demo data cleared.");
  console.log(`Products kept: ${after} (was ${before})`);
  console.log("Removed: orders, customers, barbers, referral codes, commissions, legacy admin users");
  console.log("Kept: products, images, variants, categories, homepage content (site_content)");
  if (isSupabaseConfigured()) {
    console.log("\nDatabase: Supabase");
  } else {
    console.log("\nDatabase: SQLite (data/shop.db)");
  }
}

main().catch((e) => {
  console.error("Clear failed:", e.message);
  process.exit(1);
});
