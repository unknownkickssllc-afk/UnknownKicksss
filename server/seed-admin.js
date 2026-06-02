require("dotenv").config();
const bcrypt = require("bcryptjs");
const data = require("./data");

async function seedAdmin() {
  const email = String(process.env.ADMIN_EMAIL || "admin@hillwebworks.com")
    .trim()
    .toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "HillWebworks2026!";
  const hash = bcrypt.hashSync(password, 10);
  await data.upsertAdmin(email, hash);
  console.log(`Admin ready: ${email}`);
}

seedAdmin().catch((e) => {
  console.error("Failed to seed admin:", e.message);
  process.exit(1);
});
