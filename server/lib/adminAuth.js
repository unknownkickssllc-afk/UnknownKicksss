const DEFAULT_ADMIN_PIN = "0000";

function getAdminPin() {
  return String(process.env.ADMIN_PIN || DEFAULT_ADMIN_PIN).trim();
}

function normalizePin(code) {
  return String(code || "").replace(/\D/g, "").slice(0, 4);
}

function authenticateAdminPin(code) {
  const pin = normalizePin(code);
  if (!pin || pin.length !== 4) {
    return { ok: false, error: "Enter your 4-digit access code", status: 400 };
  }
  if (pin !== getAdminPin()) {
    return { ok: false, error: "Invalid access code", status: 401 };
  }
  return { ok: true };
}

module.exports = {
  authenticateAdminPin,
  getAdminPin,
  normalizePin,
};
