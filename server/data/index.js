const { isSupabaseConfigured } = require("../lib/supabase");

const data = isSupabaseConfigured() ? require("./supabase") : require("./sqlite");

if (isSupabaseConfigured()) {
  console.log("Database: Supabase (" + process.env.SUPABASE_URL + ")");
} else {
  console.log("Database: SQLite (local data/shop.db). Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for Supabase.");
}

module.exports = data;
