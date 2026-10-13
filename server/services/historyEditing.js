const FIELDS = {
  references: ["section", "title", "value_text", "detail", "reported_on"],
  items: ["item", "size", "status", "quantity", "unitCost", "salePrice", "recordedProfit", "purchaseDate", "saleDate", "notes"],
  expenses: ["description", "amount", "date", "notes"],
};
const SECTIONS = ["capital", "deals", "consignment", "inventory", "expenses", "referrals"];
const STATUSES = ["inventory snapshot", "sale recorded", "zero value disposition"];
const MONEY = ["unitCost", "salePrice", "recordedProfit", "amount"];
const DATES = ["reported_on", "purchaseDate", "saleDate", "date"];
const FINANCIAL = ["unitCost", "salePrice", "quantity", "status"];
const own = (o, key) => Object.prototype.hasOwnProperty.call(o, key);
const finite = value => typeof value === "number" && Number.isFinite(value);
const cents = value => Math.round((value || 0) * 100);
function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function plain(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function validateRequest(kind, key, body) {
  if (!own(FIELDS, kind) || typeof key !== "string" || !key.trim() || key.length > 500) fail("Unknown history record", 404);
  if (!plain(body) || Object.keys(body).some(k => !["patch", "expectedUpdatedAt"].includes(k))) fail("Use patch and expectedUpdatedAt to save changes.");
  if (!own(body, "expectedUpdatedAt") || (body.expectedUpdatedAt !== null && (typeof body.expectedUpdatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(body.expectedUpdatedAt) || !Number.isFinite(Date.parse(body.expectedUpdatedAt))))) fail("Refresh the record before saving.");
  if (!plain(body.patch) || !Object.keys(body.patch).length) fail("No changes supplied.");
  const patch = {};
  for (const [field, value] of Object.entries(body.patch)) {
    if (!FIELDS[kind].includes(field)) fail("This field cannot be edited.");
    if (MONEY.includes(field)) {
      if (value !== null && (!finite(value) || Math.abs(value) > 100000000 || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001 || (field !== "recordedProfit" && value < 0))) fail("Amounts must be numbers with at most two decimal places, or blank.");
    } else if (DATES.includes(field)) {
      if (value !== null && (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) fail("Use a valid date, or leave it blank.");
    } else if (field === "quantity") {
      if (!Number.isInteger(value) || value < 1 || value > 100000) fail("Quantity must be a whole number from 1 to 100,000.");
    } else if (field === "section") {
      if (!SECTIONS.includes(value)) fail("Choose a valid business section.");
    } else if (field === "status") {
      if (!STATUSES.includes(value)) fail("Choose a valid item status.");
    } else {
      if (typeof value !== "string" || value.length > (["notes", "detail"].includes(field) ? 10000 : 1000)) fail("Text is missing or too long.");
      if (["title", "description"].includes(field) && !value.trim()) fail("A name is required.");
    }
    patch[field] = value;
  }
  return patch;
}
function overlayRow(kind, source, override) {
  const original = Object.fromEntries(FIELDS[kind].map(field => [field, source[field] ?? null]));
  const patch = Object.fromEntries(Object.entries(override?.patch || {}).filter(([key]) => FIELDS[kind].includes(key)));
  const changedFields = Object.keys(patch).filter(key => JSON.stringify(patch[key]) !== JSON.stringify(original[key]));
  return { ...source, ...patch, editing: { updatedAt: override?.updated_at || null, changedFields, original } };
}
function contribution(item) {
  const sold = item.status !== "inventory snapshot";
  return {
    revenue: sold && finite(item.salePrice) ? cents(item.salePrice) * item.quantity : 0,
    recordedProfit: sold && finite(item.recordedProfit) ? cents(item.recordedProfit) : 0,
    purchaseCost: finite(item.unitCost) ? cents(item.unitCost) * item.quantity : 0,
  };
}
function applyHistoryOverrides(history, overrides = []) {
  const lookup = new Map(overrides.map(row => [row.entity_type + ":" + row.source_key, row]));
  const records = history.records.map(row => overlayRow("references", row, lookup.get("references:" + row.source_key)));
  if (!history.sheet) return { ...history, records };
  const source = history.sheet;
  const items = (source.items || []).map(row => overlayRow("items", row, lookup.get("items:" + row.sourceKey)));
  const expenses = (source.expenses || []).map(row => overlayRow("expenses", row, lookup.get("expenses:" + row.sourceKey)));
  const hasEdits = items.some(row => row.editing.changedFields.length) || expenses.some(row => row.editing.changedFields.length);
  const periods = (source.periods || []).map(period => {
    const next = { ...period };
    for (let index = 0; index < items.length; index++) {
      if (items[index].period !== period.label || !items[index].editing.changedFields.length) continue;
      const before = contribution(source.items[index]), after = contribution(items[index]);
      for (const field of ["revenue", "recordedProfit", "purchaseCost"]) {
        if (finite(next[field])) next[field] = (cents(next[field]) + after[field] - before[field]) / 100;
      }
    }
    next.profitIncomplete = items.some(row => row.period === period.label && row.status !== "inventory snapshot" && !finite(row.recordedProfit));
    return next;
  });
  const totals = { revenue: 0, recordedProfit: 0, purchaseCost: 0, expenses: 0 };
  for (const field of ["revenue", "recordedProfit", "purchaseCost"]) totals[field] = periods.reduce((sum, row) => sum + cents(row[field]), 0) / 100;
  totals.expenses = expenses.reduce((sum, row) => sum + cents(row.amount), 0) / 100;
  totals.profitIncomplete = periods.some(row => row.profitIncomplete);
  totals.expensesIncomplete = expenses.some(row => !finite(row.amount));
  const notes = Array.isArray(source.notes) ? [...source.notes] : source.notes ? [source.notes] : [];
  if (hasEdits) notes.push("Owner corrections are included in these history charts. Original source rows and period totals are preserved. Unknown fees and missing profit remain unknown; history is separate from paid website orders and current balances.");
  return { ...history, records, sheet: { ...source, items, expenses, periods, originalPeriods: source.periods || [], hasEdits, totals, notes } };
}
async function saveHistoryOverride(sb, kind, key, body) {
  const patch = validateRequest(kind, key, body);
  const { loadBusinessHistory } = require("./businessHistory");
  const history = await loadBusinessHistory(sb);
  const rows = kind === "references" ? history.records : history.sheet?.[kind] || [];
  const current = rows.find(row => (kind === "references" ? row.source_key : row.sourceKey) === key);
  if (!current) fail("History record not found.", 404);
  const expected = body.expectedUpdatedAt;
  if (current.editing.updatedAt !== expected) fail("This record changed in another window. Refresh it before saving.", 409);
  if (kind === "items" && FINANCIAL.some(field => own(patch, field) && patch[field] !== current[field]) && !own(patch, "recordedProfit")) patch.recordedProfit = null;
  const merged = { ...current, ...patch };
  if (kind === "items") {
    if (merged.status === "inventory snapshot" && (merged.salePrice !== null || merged.recordedProfit !== null || merged.saleDate !== null)) fail("Inventory without a recorded sale must have blank sale price, profit, and sale date.");
    if (merged.status === "sale recorded" && !(merged.salePrice > 0)) fail("A recorded sale needs a positive sale price.");
    if (merged.status === "zero value disposition" && merged.salePrice !== 0) fail("A zero value disposition needs a sale price of zero.");
  }
  const combined = Object.fromEntries(FIELDS[kind].filter(field => JSON.stringify(merged[field] ?? null) !== JSON.stringify(current.editing.original[field])).map(field => [field, merged[field] ?? null]));
  // The timestamp predicate is part of the write: concurrent saves cannot overwrite each other.
  const updatedAt = new Date(Math.max(Date.now(), (Date.parse(expected) || 0) + 1)).toISOString();
  const payload = { entity_type: kind, source_key: key, patch: combined, updated_at: updatedAt };
  let result;
  if (expected === null) result = await sb.from("os_history_overrides").insert(payload).select("entity_type,source_key,patch,updated_at").single();
  else result = await sb.from("os_history_overrides").update({ patch: combined, updated_at: updatedAt }).eq("entity_type", kind).eq("source_key", key).eq("updated_at", expected).select("entity_type,source_key,patch,updated_at").maybeSingle();
  if (result.error?.code === "23505" || (!result.error && !result.data)) fail("This record changed in another window. Refresh it before saving.", 409);
  if (result.error) throw result.error;
  const originalRow = { ...current, ...current.editing.original };
  delete originalRow.editing;
  return { ok: true, row: overlayRow(kind, originalRow, result.data) };
}
module.exports = { FIELDS, validateRequest, overlayRow, applyHistoryOverrides, saveHistoryOverride };
