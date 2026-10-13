const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAnalytics, dateKey } = require("../server/services/businessAnalytics");
const now = new Date("2026-10-13T16:00:00Z");
function sale(overrides = {}) {
  return { id: 1, orderedAt: "2026-10-12T16:00:00Z", customerKey: "one", total: 100, commission: 5,
    items: [{ id: 1, productId: 1, productName: "Shirt", quantity: 2, lineTotal: 100, unitCost: 20 }], ...overrides };
}
test("totals use paid sales, item quantity, costs, expenses and recorded commissions", () => {
  const report = buildAnalytics({ now, orders: [sale()], expenses: [{ expense_date: "2026-10-11", category: "ads", amount: 10.25 }] });
  assert.equal(report.summary.revenue, 100);
  assert.equal(report.summary.grossProfit, 60);
  assert.equal(report.summary.grossMargin, 60);
  assert.equal(report.summary.units, 2);
  assert.equal(report.summary.trackedResult, 44.75);
  assert.equal(report.products[0].grossProfit, 60);
  assert.deepEqual(report.expenseCategories, [{ category: "ads", amount: 10.25 }]);
});
test("missing cost never creates a fictitious 100 percent margin; zero cost is real", () => {
  const missing = sale({ items: [{ productId: 1, productName: "Shirt", quantity: 1, lineTotal: 100, unitCost: null }] });
  const report = buildAnalytics({ now, orders: [missing] });
  assert.equal(report.summary.grossProfit, null);
  assert.equal(report.summary.grossMargin, null);
  assert.equal(report.summary.trackedResult, null);
  assert.equal(report.summary.costCoveragePercent, 0);
  assert.equal(report.products[0].grossProfit, null);
  assert.equal(report.daily.find(d => d.date === "2026-10-12").grossProfit, null);
  missing.items[0].unitCost = 0;
  assert.equal(buildAnalytics({ now, orders: [missing] }).summary.grossMargin, 100);
});
test("uses Eastern calendar dates across UTC midnight and DST, including empty days", () => {
  assert.equal(dateKey("2026-10-13T02:00:00Z"), "2026-10-12");
  assert.equal(dateKey("2026-01-13T04:59:00Z"), "2026-01-12");
  const report = buildAnalytics({ now, orders: [sale({ orderedAt: "2026-10-13T02:00:00Z" })] });
  assert.equal(report.period.start, "2026-09-14");
  assert.equal(report.period.previousStart, "2026-08-15");
  assert.equal(report.daily.length, 30);
  assert.equal(report.daily.at(-1).revenue, 0);
  assert.equal(report.daily.at(-2).revenue, 100);
});
test("growth compares equal adjacent periods and no earlier sales has no fake percentage", () => {
  const emptyBaseline = buildAnalytics({ now, orders: [sale()] });
  assert.equal(emptyBaseline.growth.revenuePercent, null);
  const prev = sale({ id: 2, orderedAt: "2026-09-13T12:00:00Z", total: 50, items: [{ productId: 1, productName: "Shirt", quantity: 1, lineTotal: 50, unitCost: 20 }] });
  const report = buildAnalytics({ now, orders: [sale(), prev] });
  assert.equal(report.previous.revenue, 50);
  assert.equal(report.growth.revenuePercent, 100);
  assert.equal(report.summary.returningCustomerRate, 100);
});
test("returning customers include repeat purchases in the same period without future purchases", () => {
  const report = buildAnalytics({ now, orders: [
    sale({ id: 1, customerKey: "repeat", orderedAt: "2026-10-02T12:00:00Z" }),
    sale({ id: 2, customerKey: "repeat", orderedAt: "2026-10-10T12:00:00Z" }),
    sale({ id: 3, customerKey: "new", orderedAt: "2026-10-11T12:00:00Z" }),
    sale({ id: 4, customerKey: "new", orderedAt: "2026-10-14T12:00:00Z" }),
  ] });
  assert.equal(report.summary.orders, 3);
  assert.equal(report.summary.returningCustomerRate, 50, "one of two period customers has returned by the period end");
});
test("previous period repeat-customer rate does not use purchases after that period", () => {
  const report = buildAnalytics({ now, orders: [
    sale({ id: 1, orderedAt: "2026-09-10T12:00:00Z" }),
    sale({ id: 2, orderedAt: "2026-10-10T12:00:00Z" }),
  ] });
  assert.equal(report.previous.returningCustomerRate, 0);
  assert.equal(report.summary.returningCustomerRate, 100);
});
test("negative margins remain negative; no-sale stock is an observation, not a loss", () => {
  const loss = sale({ total: 10, items: [{ productId: 1, productName: "Shirt", quantity: 1, lineTotal: 10, unitCost: 20 }] });
  const report = buildAnalytics({ now, orders: [loss], products: [{ id: 2, name: "Unsold", stock: 3 }] });
  assert.equal(report.summary.grossProfit, -10);
  assert.equal(report.summary.grossMargin, -100);
  assert.equal(report.products.find(p => p.id === 2).grossProfit, null);
  assert.ok(report.attention.some(a => a.title.includes("below recorded cost")));
});
test("item-total mismatches withhold period margin; no revenue has no AOV", () => {
  assert.equal(buildAnalytics({ now, orders: [sale({ total: 120 })] }).summary.grossProfit, null);
  const empty = buildAnalytics({ now });
  assert.equal(empty.summary.aov, null);
  assert.equal(empty.summary.grossMargin, null);
  assert.equal(empty.summary.returningCustomerRate, null);
  assert.throws(() => buildAnalytics({ now, days: 0 }), /Choose/);
});

test("unallocated order adjustments also withhold affected product margins", () => {
  const report = buildAnalytics({ now, orders: [sale({ total: 90,
    items: [{ productId: 1, productName: "Adjusted shirt", quantity: 1, lineTotal: 100, unitCost: 60 }] })] });
  assert.equal(report.summary.grossProfit, null);
  assert.equal(report.products[0].grossProfit, null);
  assert.equal(report.products[0].grossMargin, null);
});
test("expected consignment and available funding remain separate from revenue", () => {
  const report = buildAnalytics({ now, accounts: [{ available_to_business: 3000, business_balance: 500 }], consignments: [{ payout_status: "pending", expected_payout: 250 }, { payout_status: "active", expected_payout: 100 }, { payout_status: "paid", expected_payout: 900 }] });
  assert.equal(report.summary.revenue, 0);
  assert.deepEqual(report.finance, { recordCounts: { accounts: 1, consignments: 3 }, availableCapital: 3000, businessDebt: 500, consignmentPending: 250, consignmentActive: 100 });
});
