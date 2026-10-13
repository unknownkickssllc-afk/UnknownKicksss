const express = require("express");
const { supabase } = require("../lib/supabase");
const { requireAdmin } = require("../middleware/auth");
const { buildAnalytics } = require("../services/businessAnalytics");
const router = express.Router();
router.use(requireAdmin);
const related = value => Array.isArray(value) ? value[0] : value;
const list = value => Array.isArray(value) ? value : value ? [value] : [];

// PostgREST defaults to 1,000 rows. Never silently truncate financial reports.
async function readRows(table, columns, filter = q => q) {
  const rows = [];
  for (let offset = 0; offset < 50000; offset += 500) {
    const { data, error } = await filter(supabase().from(table).select(columns)).order("id").range(offset, offset + 499);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 500) return rows;
  }
  throw new Error("This report needs a larger reporting query. No partial totals were returned.");
}
function apiError(res, error) {
  const missingSchema = ["42P01", "PGRST200", "PGRST205"].includes(error.code);
  res.status(missingSchema ? 503 : 500).json({ error: missingSchema
    ? "Analytics setup is not complete yet. Your existing store and Business OS are unchanged."
    : "Analytics could not be loaded. Please retry; no partial totals are shown." });
}
router.get("/", async (req, res) => {
  const days = Number(req.query.days || 30);
  if (![30, 90, 365].includes(days)) return res.status(400).json({ error: "Choose 30, 90, or 365 days" });
  try {
    const [orderRows, productRows, expenses, accounts, consignments] = await Promise.all([
      readRows("orders", "id,order_number,created_at,total,customer_id,barber_id,stripe_session_id,status,barbers(name),commissions(amount),order_items(id,product_id,product_name,quantity,line_total,os_order_item_costs(unit_cost))", q => q.eq("payment_status", "paid")),
      readRows("products", "id,name,product_variants(stock),os_product_costs(unit_cost)"),
      readRows("operating_expenses", "id,amount,category,expense_date"),
      readRows("funding_accounts", "id,available_to_business,business_balance"),
      readRows("consignment_positions", "id,payout_status,expected_payout"),
    ]);
    const orders = [], paymentRefs = new Set();
    let duplicatePayments = 0, cancelledPaidOrders = 0;
    for (const row of orderRows) {
      if (row.stripe_session_id && paymentRefs.has(row.stripe_session_id)) { duplicatePayments++; continue; }
      if (row.stripe_session_id) paymentRefs.add(row.stripe_session_id);
      if (row.status === "cancelled") cancelledPaidOrders++;
      orders.push({ id: row.id, orderNumber: row.order_number, orderedAt: row.created_at,
        customerKey: row.customer_id ? String(row.customer_id) : null,
        barberName: related(row.barbers)?.name || null, total: Number(row.total),
        commission: list(row.commissions).reduce((s, c) => s + Number(c.amount), 0),
        items: list(row.order_items).map(i => ({ id: i.id, productId: i.product_id, productName: i.product_name,
          quantity: Number(i.quantity), lineTotal: Number(i.line_total),
          unitCost: related(i.os_order_item_costs)?.unit_cost == null ? null : Number(related(i.os_order_item_costs).unit_cost) })) });
    }
    const products = productRows.map(p => ({ id: p.id, name: p.name,
      stock: list(p.product_variants).reduce((s, v) => s + Number(v.stock), 0) }));
    const report = buildAnalytics({ orders, products, expenses, accounts, consignments, days });
    if (duplicatePayments) report.attention.unshift({ severity: "warning", title: "Duplicate payment references need review", detail: `${duplicatePayments} extra paid order record(s) share a payment reference. They were excluded from totals to avoid counting a payment twice.` });
    if (cancelledPaidOrders) report.attention.unshift({ severity: "warning", title: "Cancelled orders with paid status", detail: `${cancelledPaidOrders} cancelled order(s) still show paid. Their revenue remains included until the payment records are reconciled. Refunds are not automatically reconciled by this report.` });
    const missingItems = orders.flatMap(o => o.items.filter(i => i.unitCost === null).map(i => ({ id: i.id,
      orderNumber: o.orderNumber, productName: i.productName, quantity: i.quantity, orderDate: o.orderedAt }))).reverse();
    report.costs = {
      products: productRows.map(p => ({ id: p.id, name: p.name, unitCost: related(p.os_product_costs)?.unit_cost == null ? null : Number(related(p.os_product_costs).unit_cost) })),
      missingItems: missingItems.slice(0, 200), missingItemCount: missingItems.length,
    };
    report.generatedAt = new Date().toISOString();
    res.json(report);
  } catch (error) { apiError(res, error); }
});

function costInput(req, res, allowNull) {
  if (!/^\d+$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id)) || Number(req.params.id) < 1) {
    res.status(400).json({ error: "Invalid item" }); return undefined;
  }
  const value = req.body.unitCost;
  if (allowNull && value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 9999999 || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) {
    res.status(400).json({ error: "Enter a cost of zero or more, with at most two decimal places" }); return undefined;
  }
  return value;
}
router.put("/product-costs/:id", async (req, res) => {
  const unitCost = costInput(req, res, true);
  if (unitCost === undefined) return;
  try {
    const { data: product, error: lookupError } = await supabase().from("products").select("id").eq("id", Number(req.params.id)).maybeSingle();
    if (lookupError) throw lookupError;
    if (!product) return res.status(404).json({ error: "Product not found" });
    const { error } = await supabase().from("os_product_costs").upsert({ product_id: product.id, unit_cost: unitCost, updated_at: new Date().toISOString() }, { onConflict: "product_id" });
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) { apiError(res, error); }
});
router.put("/item-costs/:id", async (req, res) => {
  const unitCost = costInput(req, res, false);
  if (unitCost === undefined) return;
  try {
    const { data: item, error: lookupError } = await supabase().from("order_items").select("id,orders(payment_status)").eq("id", Number(req.params.id)).maybeSingle();
    if (lookupError) throw lookupError;
    if (!item || related(item.orders)?.payment_status !== "paid") return res.status(404).json({ error: "Paid sale item not found" });
    const { error } = await supabase().from("os_order_item_costs").upsert({ order_item_id: item.id, unit_cost: unitCost, source: "admin", updated_at: new Date().toISOString() }, { onConflict: "order_item_id" });
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) { apiError(res, error); }
});
module.exports = router;
