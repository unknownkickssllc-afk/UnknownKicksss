function normalizeAddress(addr = {}) {
  return {
    line1: String(addr.line1 || "").trim().toLowerCase(),
    line2: String(addr.line2 || "").trim().toLowerCase(),
    city: String(addr.city || "").trim().toLowerCase(),
    state: String(addr.state || "").trim().toLowerCase(),
    zip: String(addr.zip || "").trim().toLowerCase(),
    country: String(addr.country || "US").trim().toUpperCase(),
  };
}

function addressesEqual(a, b) {
  const left = normalizeAddress(a);
  const right = normalizeAddress(b);
  return (
    left.line1 === right.line1 &&
    left.line2 === right.line2 &&
    left.city === right.city &&
    left.state === right.state &&
    left.zip === right.zip &&
    left.country === right.country
  );
}

function resolveBillingForStorage({ shipping, billing, billingSame }) {
  if (billingSame === true || billingSame === "on") return null;
  if (!billing?.line1 || !billing?.city || !billing?.zip) return null;
  if (addressesEqual(shipping, billing)) return null;
  return {
    line1: billing.line1,
    line2: billing.line2 || "",
    city: billing.city,
    state: billing.state || "",
    zip: billing.zip,
    country: billing.country || "US",
  };
}

module.exports = {
  addressesEqual,
  normalizeAddress,
  resolveBillingForStorage,
};
