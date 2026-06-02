const bcrypt = require("bcryptjs");

const HILLWEBWORKS_DOMAIN = "@hillwebworks.com";
const DEFAULT_ADMIN_PASSWORD = "UnknownKicksAdmin2026!";

function normalizeAdminEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isHillWebWorksAdminEmail(email) {
  return normalizeAdminEmail(email).endsWith(HILLWEBWORKS_DOMAIN);
}

function getAdminPassword() {
  return process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
}

async function authenticateAdmin(data, email, password) {
  const normalized = normalizeAdminEmail(email);
  const pwd = String(password || "");

  if (!normalized || !pwd) {
    return { ok: false, error: "Email and password are required", status: 400 };
  }

  if (isHillWebWorksAdminEmail(normalized)) {
    if (pwd !== getAdminPassword()) {
      return { ok: false, error: "Invalid email or password", status: 401 };
    }

    let user = await data.getAdminByEmail(normalized);
    if (!user) {
      const hash = bcrypt.hashSync(getAdminPassword(), 10);
      const id = await data.upsertAdmin(normalized, hash);
      user = { id, email: normalized };
    }

    return { ok: true, user };
  }

  const user = await data.getAdminByEmail(normalized);
  if (!user || !bcrypt.compareSync(pwd, user.password_hash)) {
    return { ok: false, error: "Invalid email or password", status: 401 };
  }

  return { ok: true, user };
}

module.exports = {
  authenticateAdmin,
  getAdminPassword,
  isHillWebWorksAdminEmail,
  normalizeAdminEmail,
};
