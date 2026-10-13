const test = require("node:test");
const assert = require("node:assert/strict");
const { validateRequest, applyHistoryOverrides, saveHistoryOverride } = require("../server/services/historyEditing");
const { loadBusinessHistory } = require("../server/services/businessHistory");

function fixture() {
  return {
    records: [{ source_key: "capacity", section: "capital", title: "Prior capacity", value_text: "$100–$200", detail: "Unknown cash share", reported_on: null, confidence: "user_reported", source_ref: "Synthetic source", sort_order: 1 }],
    sheet: {
      sourceTitle: "Synthetic sheet", periods: [{ label: "June and July", revenue: 120, recordedProfit: 25, purchaseCost: 200, rowCount: 3 }],
      items: [
        { sourceKey: "sold", period: "June and July", item: "Fixture shirt", size: "M", status: "sale recorded", quantity: 2, unitCost: 30, salePrice: 50, recordedProfit: 25, purchaseDate: null, saleDate: null, notes: "Fees recorded in source only", sourceRow: "A2:L2" },
        { sourceKey: "missing", period: "June and July", item: "Fixture hat", size: "", status: "sale recorded", quantity: 1, unitCost: 10, salePrice: 20, recordedProfit: null, purchaseDate: null, saleDate: null, notes: "Missing original profit", sourceRow: "A3:L3" },
        { sourceKey: "inventory", period: "June and July", item: "Fixture shoes", size: "8", status: "inventory snapshot", quantity: 1, unitCost: 130, salePrice: null, recordedProfit: null, purchaseDate: null, saleDate: null, notes: "Availability unverified", sourceRow: "A4:L4" },
      ], expenses: [{ sourceKey: "expense", description: "Shipping supplies", amount: 5, date: null, notes: "No exact date", sourceRow: "A2:E2" }], notes: ["Original source period is combined"],
    },
  };
}
function database() {
  const source = fixture();
  const tables = new Map([
    ["os_historical_records", source.records],
    ["os_sheet_imports", [{ source_key: "primary-reselling-sheet", source_title: source.sheet.sourceTitle, payload: source.sheet, source_payload: { secretRawArchive: "must never be selected" } }]],
    ["os_history_overrides", []],
  ]);
  const selected = [];
  return { tables, selected, from(name) {
    let filters = [], operation = "read", values, range, single = false;
    const query = {
      select(columns) { selected.push({ name, columns }); return query; },
      eq(field, value) { filters.push(row => row[field] === value); return query; },
      order() { return query; }, range(start, end) { range = [start, end]; return query; },
      insert(value) { operation = "insert"; values = value; return query; },
      update(value) { operation = "update"; values = value; return query; },
      single() { single = true; return query; }, maybeSingle() { single = true; return query; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          let result = tables.get(name).filter(row => filters.every(filter => filter(row)));
          if (operation === "insert") {
            if (tables.get(name).some(row => row.entity_type === values.entity_type && row.source_key === values.source_key)) return { data: null, error: { code: "23505" } };
            const inserted = structuredClone(values); tables.get(name).push(inserted); result = [inserted];
          } else if (operation === "update") for (const row of result) Object.assign(row, structuredClone(values));
          if (range) result = result.slice(range[0], range[1] + 1);
          return { data: structuredClone(single ? result[0] || null : result), error: null };
        }).then(resolve, reject);
      },
    };
    return query;
  } };
}
const body = (patch, expectedUpdatedAt = null) => ({ patch, expectedUpdatedAt });

test("history validation rejects unknown fields, malformed values, and missing concurrency tokens", () => {
  for (const patch of [{ sourceKey: "other" }, { sourceUrl: "https://elsewhere.invalid" }, { salePrice: "100" }, { unitCost: -2 }, { quantity: 0 }, { quantity: 1.5 }, { salePrice: 1.234 }, { saleDate: "2026-02-30" }, { saleDate: "tomorrow" }, { status: "paid" }, { notes: {} }]) {
    assert.throws(() => validateRequest("items", "sold", body(patch)), error => error.status === 400);
  }
  assert.throws(() => validateRequest("items", "sold", { patch: { notes: "Edited" } }), /Refresh/);
  assert.deepEqual(validateRequest("items", "sold", body({ recordedProfit: -12.34, saleDate: null })), { recordedProfit: -12.34, saleDate: null });
});

test("history overlays preserve originals, source periods, unknown dates, and original totals when unchanged", () => {
  const original = fixture(), frozen = JSON.stringify(original);
  const unchanged = applyHistoryOverrides(original);
  assert.equal(unchanged.sheet.periods[0].recordedProfit, 25);
  assert.equal(unchanged.sheet.hasEdits, false);
  assert.equal(unchanged.sheet.periods[0].profitIncomplete, true);
  const corrected = applyHistoryOverrides(original, [{ entity_type: "items", source_key: "sold", patch: { unitCost: 35, salePrice: 60, recordedProfit: 35 }, updated_at: "2026-10-13T12:00:00.000Z" }, { entity_type: "expenses", source_key: "expense", patch: { amount: 7.50 }, updated_at: "2026-10-13T12:01:00.000Z" }]);
  assert.deepEqual(corrected.sheet.totals, { revenue: 140, recordedProfit: 35, purchaseCost: 210, expenses: 7.5, profitIncomplete: true, expensesIncomplete: false });
  assert.equal(corrected.sheet.originalPeriods[0].revenue, 120);
  assert.equal(corrected.sheet.items[0].editing.original.unitCost, 30);
  assert.equal(corrected.sheet.items[0].saleDate, null);
  assert.equal(corrected.sheet.items[0].sourceRow, "A2:L2");
  assert.equal(corrected.sheet.hasEdits, true);
  assert.match(corrected.sheet.notes.at(-1), /Owner corrections/);
  assert.equal(JSON.stringify(original), frozen, "overlays cannot mutate original imports");
});

test("saves corrections separately, clears stale profit, preserves source, and returns editing metadata", async () => {
  const sb = database();
  const original = JSON.stringify([...sb.tables]);
  const saved = await saveHistoryOverride(sb, "items", "sold", body({ unitCost: 35 }));
  assert.equal(saved.row.recordedProfit, null, "a cost correction cannot silently retain stale profit");
  assert.deepEqual(saved.row.editing.changedFields.sort(), ["recordedProfit", "unitCost"]);
  assert.equal(saved.row.editing.original.recordedProfit, 25);
  assert.equal(sb.tables.get("os_sheet_imports")[0].payload.items[0].unitCost, 30);
  assert.notEqual(JSON.stringify([...sb.tables]), original);
  const loaded = await loadBusinessHistory(sb);
  assert.equal(loaded.sheet.items[0].unitCost, 35);
  assert.equal(loaded.sheet.periods[0].recordedProfit, 0);
  assert.equal(loaded.sheet.periods[0].profitIncomplete, true);
  assert.ok(sb.selected.every(query => !query.columns?.includes("source_payload")));
  await assert.rejects(saveHistoryOverride(sb, "items", "unknown", body({ notes: "No source" })), error => error.status === 404);
  await assert.rejects(saveHistoryOverride(sb, "items", "inventory", body({ salePrice: 40 })), /blank sale price/);
});

test("first-save and subsequent concurrent writes each accept only one version", async () => {
  const sb = database();
  const first = await Promise.allSettled([
    saveHistoryOverride(sb, "references", "capacity", body({ value_text: "$150" })),
    saveHistoryOverride(sb, "references", "capacity", body({ value_text: "$175" })),
  ]);
  assert.equal(first.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(first.find(result => result.status === "rejected").reason.status, 409);
  const timestamp = first.find(result => result.status === "fulfilled").value.row.editing.updatedAt;
  const second = await Promise.allSettled([
    saveHistoryOverride(sb, "references", "capacity", body({ detail: "First editor" }, timestamp)),
    saveHistoryOverride(sb, "references", "capacity", body({ detail: "Second editor" }, timestamp)),
  ]);
  assert.equal(second.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(second.find(result => result.status === "rejected").reason.status, 409);
  assert.equal(sb.tables.get("os_history_overrides").length, 1);
  assert.equal(sb.tables.get("os_historical_records")[0].value_text, "$100–$200");
});

test("clearing corrections restores originals without deleting provenance or concurrency version", async () => {
  const sb = database();
  const saved = await saveHistoryOverride(sb, "expenses", "expense", body({ amount: 9, date: "2026-10-12" }));
  const restored = await saveHistoryOverride(sb, "expenses", "expense", body({ amount: 5, date: null }, saved.row.editing.updatedAt));
  assert.deepEqual(restored.row.editing.changedFields, []);
  assert.ok(restored.row.editing.updatedAt);
  assert.equal((await loadBusinessHistory(sb)).sheet.hasEdits, false);
});
