const { timingSafeEqual } = require("crypto");
const DEFAULT_ADMIN_PIN = "0000";

function isDeployed() {
  return process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL_ENV);
}

function adminConfigurationError() {
  if (!isDeployed()) return null;
  const pin = String(process.env.ADMIN_PIN || "").trim();
  const secret = String(process.env.SESSION_SECRET || "").trim();
  if (!/^\d{4}$/.test(pin) || pin === DEFAULT_ADMIN_PIN || !secret ||
      ["unknown-kicks-dev-secret-change-me", "change-this-to-a-long-random-string"].includes(secret)) {
    return "Admin sign-in is not configured. Contact the site owner.";
  }
  return null;
}

function getAdminPin() {
  return String(process.env.ADMIN_PIN || (isDeployed() ? "" : DEFAULT_ADMIN_PIN)).trim();
}

function normalizePin(code) {
  return typeof code === "string" ? code.trim() : "";
}

function authenticateAdminPin(code) {
  const error = adminConfigurationError();
  if (error) return { ok: false, error, status: 503 };
  const pin = normalizePin(code);
  if (!/^\d{4}$/.test(pin)) {
    return { ok: false, error: "Enter your 4-digit access code", status: 400 };
  }
  const expected = getAdminPin();
  if (pin.length !== expected.length || !timingSafeEqual(Buffer.from(pin), Buffer.from(expected))) {
    return { ok: false, error: "Invalid access code", status: 401 };
  }
  return { ok: true };
}

module.exports = {
  adminConfigurationError,
  isDeployed,
  authenticateAdminPin,
  getAdminPin,
  normalizePin,
};
