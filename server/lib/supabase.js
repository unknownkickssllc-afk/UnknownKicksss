const { createClient } = require("@supabase/supabase-js");

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env"
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

let client;
function supabase() {
  if (!client) client = getSupabase();
  return client;
}

function isSupabaseConfigured() {
  if (process.env.USE_SQLITE === "true") return false;
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return !!(url && key && key.length > 20 && !key.includes("your-service-role"));
}

module.exports = { supabase, isSupabaseConfigured, getSupabase };
