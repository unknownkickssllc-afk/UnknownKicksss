const TIME_ZONE = "America/New_York";
const dateFormat = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const cents = n => Math.round(Number(n || 0) * 100);
const dollars = n => n / 100;
const round = n => Math.round(n * 100) / 100;
function dateKey(value) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  const parts = Object.fromEntries(dateFormat.formatToParts(d).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function offsetDate(day, offset) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
const validCost = n => n !== null && n !== undefined && n !== "" && Number.isFinite(Number(n)) && Number(n) >= 0;
function orderAmounts(order) {
  const items = order.items || [];
  const revenue = cents(order.total);
  const complete = items.length > 0 && items.every(i => validCost(i.unitCost)) &&
    Math.abs(items.reduce((s, i) => s + cents(i.lineTotal), 0) - revenue) <= 1;
  const cogs = items.reduce((s, i) => s + (validCost(i.unitCost) ? cents(i.unitCost) * Number(i.quantity) : 0), 0);
  return { revenue, cogs, complete, profit: complete ? revenue - cogs : null };
}
function buildAnalytics({ orders = [], products = [], expenses = [], accounts = [], consignments = [], days = 30, now = new Date() }) {
  if (![30, 90, 365].includes(Number(days))) throw new Error("Choose 30, 90, or 365 days");
  days = Number(days);
  const end = dateKey(now), start = offsetDate(end, 1 - days);
  const previousEnd = offsetDate(start, -1), previousStart = offsetDate(start, -days);
  const dated = orders.map(o => ({ ...o, day: dateKey(o.orderedAt), amounts: orderAmounts(o) })).filter(o => o.day);
  const inPeriod = (day, a, b) => day >= a && day <= b;
  function summarize(a, b) {
    const selected = dated.filter(o => inPeriod(o.day, a, b));
    const revenue = selected.reduce((s, o) => s + o.amounts.revenue, 0);
    const known = selected.filter(o => o.amounts.complete);
    const knownRevenue = known.reduce((s, o) => s + o.amounts.revenue, 0);
    const cogs = known.reduce((s, o) => s + o.amounts.cogs, 0);
    const costComplete = selected.every(o => o.amounts.complete);
    const expenseTotal = expenses.filter(e => inPeriod(e.expense_date, a, b)).reduce((s, e) => s + cents(e.amount), 0);
    const commissions = selected.reduce((s, o) => s + cents(o.commission), 0);
    const customers = new Set(selected.map(o => o.customerKey).filter(Boolean));
    const priorCustomers = new Set(dated.filter(o => o.day < a).map(o => o.customerKey).filter(Boolean));
    const returning = [...customers].filter(c => priorCustomers.has(c)).length;
    const profit = costComplete && selected.length ? revenue - cogs : null;
    return {
      revenue: dollars(revenue), orders: selected.length,
      units: selected.reduce((s, o) => s + o.items.reduce((n, i) => n + Number(i.quantity), 0), 0),
      aov: selected.length ? round(dollars(revenue) / selected.length) : null,
      knownCostRevenue: dollars(knownRevenue), cogs: dollars(cogs), knownGrossProfit: dollars(knownRevenue - cogs),
      grossProfit: profit === null ? null : dollars(profit),
      grossMargin: profit === null || !revenue ? null : round(100 * profit / revenue),
      costCoveragePercent: revenue > 0 ? round(100 * knownRevenue / revenue) : selected.length ? round(100 * known.length / selected.length) : 100,
      operatingExpenses: dollars(expenseTotal), referralCommissions: dollars(commissions),
      trackedResult: profit === null ? null : dollars(profit - expenseTotal - commissions),
      allCostsKnown: costComplete,
      returningCustomerRate: customers.size ? round(100 * returning / customers.size) : null,
    };
  }
  const summary = summarize(start, end), previous = summarize(previousStart, previousEnd);
  const percentChange = (a, b) => a !== null && b > 0 ? round(100 * (a - b) / b) : null;
  const selected = dated.filter(o => inPeriod(o.day, start, end));
  const daily = Array.from({ length: days }, (_, i) => {
    const date = offsetDate(start, i), rows = selected.filter(o => o.day === date);
    return { date, revenue: dollars(rows.reduce((s, o) => s + o.amounts.revenue, 0)),
      grossProfit: rows.every(o => o.amounts.complete) ? dollars(rows.reduce((s, o) => s + o.amounts.profit, 0)) : null,
      orders: rows.length, expenses: dollars(expenses.filter(e => e.expense_date === date).reduce((s, e) => s + cents(e.amount), 0)) };
  });
  const productMap = new Map(products.map(p => [String(p.id), { id: p.id, name: p.name, stock: Number(p.stock || 0), units: 0, revenue: 0, cost: 0, missingCostUnits: 0, lastSaleDate: null }]));
  for (const order of dated) for (const item of order.items) {
    const key = String(item.productId);
    if (!productMap.has(key)) productMap.set(key, { id: item.productId, name: item.productName, stock: 0, units: 0, revenue: 0, cost: 0, missingCostUnits: 0, lastSaleDate: null });
    const p = productMap.get(key);
    if (order.day <= end && (!p.lastSaleDate || order.day > p.lastSaleDate)) p.lastSaleDate = order.day;
    if (!inPeriod(order.day, start, end)) continue;
    p.units += Number(item.quantity); p.revenue += cents(item.lineTotal);
    if (validCost(item.unitCost)) p.cost += cents(item.unitCost) * Number(item.quantity);
    else p.missingCostUnits += Number(item.quantity);
  }
  const productRows = [...productMap.values()].map(p => ({ id: p.id, name: p.name, stock: p.stock, units: p.units,
    revenue: dollars(p.revenue), grossProfit: p.units && !p.missingCostUnits ? dollars(p.revenue - p.cost) : null,
    grossMargin: p.revenue && !p.missingCostUnits ? round(100 * (p.revenue - p.cost) / p.revenue) : null,
    missingCostUnits: p.missingCostUnits, lastSaleDate: p.lastSaleDate })).sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));
  const referralMap = new Map();
  for (const o of selected) {
    const name = o.barberName || "No referral";
    if (!referralMap.has(name)) referralMap.set(name, { name, orders: 0, revenue: 0, commission: 0 });
    const r = referralMap.get(name); r.orders++; r.revenue += cents(o.total); r.commission += cents(o.commission);
  }
  const referrals = [...referralMap.values()].map(r => ({ ...r, revenue: dollars(r.revenue), commission: dollars(r.commission), netBeforeCosts: dollars(r.revenue - r.commission) })).sort((a, b) => b.revenue - a.revenue);
  const categories = new Map();
  for (const e of expenses.filter(e => inPeriod(e.expense_date, start, end))) categories.set(e.category || "other", (categories.get(e.category || "other") || 0) + cents(e.amount));
  const finance = {
    availableCapital: dollars(accounts.reduce((s, a) => s + cents(a.available_to_business), 0)),
    businessDebt: dollars(accounts.reduce((s, a) => s + cents(a.business_balance), 0)),
    consignmentPending: dollars(consignments.filter(c => c.payout_status === "pending").reduce((s, c) => s + cents(c.expected_payout), 0)),
    consignmentActive: dollars(consignments.filter(c => c.payout_status === "active").reduce((s, c) => s + cents(c.expected_payout), 0)),
  };
  const attention = [];
  const incomplete = selected.filter(o => !o.amounts.complete).length;
  if (incomplete) attention.push({ severity: "warning", title: "Complete your sale costs", detail: `${incomplete} paid order(s) need cost details or item-total review before the period margin can be calculated.` });
  const losses = productRows.filter(p => p.grossProfit !== null && p.grossProfit < 0);
  if (losses.length) attention.push({ severity: "warning", title: "Products selling below recorded cost", detail: losses.slice(0, 4).map(p => p.name).join(", ") + ". Review pricing and purchase costs." });
  const lowStock = productRows.filter(p => p.units > 0 && p.stock <= 2);
  if (lowStock.length) attention.push({ severity: "info", title: "Selling products with low stock", detail: lowStock.slice(0, 4).map(p => `${p.name} (${p.stock} left)`).join(", ") + ". Check margin before restocking." });
  const noSales = productRows.filter(p => p.stock > 0 && p.units === 0);
  if (noSales.length) attention.push({ severity: "info", title: "Stock without website sales this period", detail: `${noSales.length} product(s) have stock and no paid website sales in this date range. Offsite sales are not included.` });
  if (finance.consignmentPending > 0) attention.push({ severity: "info", title: "Consignment money pending", detail: "Recorded expected payouts are waiting to be received. They are not cash in the bank." });
  if (!selected.length) attention.push({ severity: "info", title: "Waiting for website sales", detail: "Paid website orders will appear here automatically. Historical spreadsheet sales have not been imported." });
  return { period: { days, start, end, previousStart, previousEnd, timeZone: TIME_ZONE }, summary, previous,
    growth: { revenuePercent: percentChange(summary.revenue, previous.revenue), ordersPercent: percentChange(summary.orders, previous.orders), aovPercent: percentChange(summary.aov, previous.aov), grossMarginPoints: summary.grossMargin === null || previous.grossMargin === null ? null : round(summary.grossMargin - previous.grossMargin) },
    daily, products: productRows, referrals,
    expenseCategories: [...categories].map(([category, amount]) => ({ category, amount: dollars(amount) })).sort((a, b) => b.amount - a.amount), attention, finance };
}
module.exports = { buildAnalytics, dateKey };
