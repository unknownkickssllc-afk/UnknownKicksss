const express = require("express");
const { supabase } = require("../lib/supabase");
const { requireAdmin } = require("../middleware/auth");
const { loadBusinessHistory } = require("../services/businessHistory");
const { saveHistoryOverride, validateRequest } = require("../services/historyEditing");

const router = express.Router();
router.use(requireAdmin);
router.use('/assistant', require('./ownerAssistant'));
router.use(require('./osRecords'));

router.get("/history", async (_req, res) => {
  try { res.json(await loadBusinessHistory(supabase())); }
  catch (error) {
    const missingSchema = ["42P01", "PGRST200", "PGRST205"].includes(error.code);
    res.status(missingSchema ? 503 : 500).json({ error: missingSchema
      ? "Business history is still being prepared. Your existing records are unchanged."
      : "Business history could not be loaded. Please refresh." });
  }
});

for (const kind of ["references", "items", "expenses"]) {
  router.patch(`/history/${kind}/:sourceKey`, async (req, res) => {
    try {
      validateRequest(kind, req.params.sourceKey, req.body);
      res.json(await saveHistoryOverride(supabase(), kind, req.params.sourceKey, req.body));
    } catch (error) {
      const missingSchema = ["42P01", "PGRST200", "PGRST205"].includes(error.code);
      res.status(error.status || (missingSchema ? 503 : 500)).json({ error: error.status ? error.message : missingSchema
        ? "History editing is being prepared. Your records are unchanged."
        : "Changes could not be saved. Please refresh and try again." });
    }
  });
}

async function table(name) {
  return supabase().from(name);
}

router.get("/dashboard", async (_req, res) => {
  try {
    const sb = supabase();
    const [
      membersR,
      accountsR,
      dealsR,
      inventoryR,
      consignmentsR,
      budgetsR,
      expensesR,
      referralsR,
    ] = await Promise.all([
      sb.from("business_members").select("*").eq("active", true).order("id"),
      sb.from("funding_accounts").select("*, business_members(name)").order("id"),
      sb.from("inventory_deals").select("*").order("created_at", { ascending: false }),
      sb.from("inventory_assets").select("*").order("created_at", { ascending: false }),
      sb.from("consignment_positions").select("*").order("created_at", { ascending: false }),
      sb.from("budget_buckets").select("*").eq("active", true).order("id"),
      sb.from("operating_expenses").select("*").order("expense_date", { ascending: false }),
      sb.from("referral_programs").select("*").order("id"),
    ]);

    const firstError = [membersR, accountsR, dealsR, inventoryR, consignmentsR, budgetsR, expensesR, referralsR]
      .find((r) => r.error)?.error;
    if (firstError) throw firstError;

    const accounts = accountsR.data || [];
    const inventory = inventoryR.data || [];
    const consignments = consignmentsR.data || [];
    const expenses = expensesR.data || [];

    const totals = {
      buyingCapacity: accounts.reduce((s, a) => s + Number(a.available_to_business || 0), 0),
      businessDebt: accounts.reduce((s, a) => s + Number(a.business_balance || 0), 0),
      inventoryCost: inventory
        .filter((i) => !["sold", "removed"].includes(i.status))
        .reduce((s, i) => s + Number(i.unit_cost || 0) * Number(i.quantity || 1), 0),
      activeConsignmentPayout: consignments
        .filter((c) => c.payout_status === "active")
        .reduce((s, c) => s + Number(c.expected_payout || 0), 0),
      pendingConsignmentPayout: consignments
        .filter((c) => c.payout_status === "pending")
        .reduce((s, c) => s + Number(c.expected_payout || 0), 0),
      operatingExpenses: expenses.reduce((s, e) => s + Number(e.amount || 0), 0),
    };

    res.json({
      totals,
      members: membersR.data || [],
      accounts,
      deals: dealsR.data || [],
      inventory,
      consignments,
      budgets: budgetsR.data || [],
      expenses,
      referralPrograms: referralsR.data || [],
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/funding-accounts", async (req, res) => {
  try {
    const payload = {
      member_id: req.body.member_id || null,
      label: String(req.body.label || "").trim(),
      account_type: req.body.account_type || "cash",
      purpose: req.body.purpose || "mixed",
      available_to_business: Number(req.body.available_to_business || 0),
      business_balance: Number(req.body.business_balance || 0),
      credit_limit: req.body.credit_limit === "" || req.body.credit_limit == null ? null : Number(req.body.credit_limit),
      apr_percent: req.body.apr_percent === "" || req.body.apr_percent == null ? null : Number(req.body.apr_percent),
      promo_apr_percent: req.body.promo_apr_percent === "" || req.body.promo_apr_percent == null ? null : Number(req.body.promo_apr_percent),
      promo_expires: req.body.promo_expires || null,
      legacy: !!req.body.legacy,
      notes: req.body.notes || "",
      updated_at: new Date().toISOString(),
    };
    if (!payload.label) return res.status(400).json({ error: "Account label is required" });
    const { data, error } = await supabase().from("funding_accounts").insert(payload).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/deals", async (req, res) => {
  try {
    const sb = supabase();
    const contributions = Array.isArray(req.body.contributions) ? req.body.contributions : [];
    const dealRow = {
      deal_code: String(req.body.deal_code || "").trim(),
      title: String(req.body.title || "").trim(),
      ownership_type: req.body.ownership_type || "joint",
      total_cost: Number(req.body.total_cost || 0),
      purchased_at: req.body.purchased_at || null,
      status: req.body.status || "planned",
      notes: req.body.notes || "",
      updated_at: new Date().toISOString(),
    };
    if (!dealRow.deal_code || !dealRow.title) {
      return res.status(400).json({ error: "Deal code and title are required" });
    }
    const { data: deal, error } = await sb.from("inventory_deals").insert(dealRow).select().single();
    if (error) throw error;

    if (contributions.length) {
      const rows = contributions
        .filter((c) => Number(c.amount || 0) > 0)
        .map((c) => ({
          deal_id: deal.id,
          member_id: Number(c.member_id),
          funding_account_id: c.funding_account_id || null,
          amount: Number(c.amount || 0),
          ownership_percent: c.ownership_percent == null || c.ownership_percent === ""
            ? null
            : Number(c.ownership_percent),
        }));
      if (rows.length) {
        const { error: contribErr } = await sb.from("deal_contributions").insert(rows);
        if (contribErr) throw contribErr;
      }
    }

    res.json(deal);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/consignments", async (req, res) => {
  try {
    const payload = {
      inventory_asset_id: req.body.inventory_asset_id || null,
      item_name: String(req.body.item_name || "").trim(),
      direction: req.body.direction || "outbound",
      partner_name: req.body.partner_name || null,
      original_cost: Number(req.body.original_cost || 0),
      list_price: Number(req.body.list_price || 0),
      fee_percent: req.body.fee_percent === "" || req.body.fee_percent == null ? null : Number(req.body.fee_percent),
      expected_payout: Number(req.body.expected_payout || 0),
      payout_received_amount: req.body.payout_received_amount === "" || req.body.payout_received_amount == null
        ? null : Number(req.body.payout_received_amount),
      payout_status: req.body.payout_status || "active",
      lock_until: req.body.lock_until || null,
      pull_date: req.body.pull_date || null,
      notes: req.body.notes || "",
    };
    if (!payload.item_name) return res.status(400).json({ error: "Item name is required" });
    const { data, error } = await supabase().from("consignment_positions").insert(payload).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/expenses", async (req, res) => {
  try {
    const sb = supabase();
    const splits = Array.isArray(req.body.splits) ? req.body.splits : [];
    const payload = {
      budget_bucket_id: req.body.budget_bucket_id || null,
      funding_account_id: req.body.funding_account_id || null,
      category: String(req.body.category || "other"),
      description: String(req.body.description || "").trim(),
      amount: Number(req.body.amount || 0),
      expense_date: req.body.expense_date || new Date().toISOString().slice(0, 10),
      recurring: !!req.body.recurring,
      notes: req.body.notes || "",
    };
    if (!payload.description || payload.amount <= 0) {
      return res.status(400).json({ error: "Description and positive amount are required" });
    }
    const { data: expense, error } = await sb.from("operating_expenses").insert(payload).select().single();
    if (error) throw error;

    const splitRows = splits
      .filter((s) => Number(s.amount || 0) > 0)
      .map((s) => ({
        expense_id: expense.id,
        member_id: Number(s.member_id),
        amount: Number(s.amount),
        split_percent: s.split_percent == null || s.split_percent === "" ? null : Number(s.split_percent),
      }));
    if (splitRows.length) {
      const { error: splitErr } = await sb.from("expense_splits").insert(splitRows);
      if (splitErr) throw splitErr;
    }
    res.json(expense);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/referral-programs", async (req, res) => {
  try {
    const payload = {
      name: String(req.body.name || "").trim(),
      customer_discount: Number(req.body.customer_discount || 0),
      referrer_reward: Number(req.body.referrer_reward || 0),
      min_pre_promo_profit: Number(req.body.min_pre_promo_profit || 0),
      active: req.body.active !== false,
      notes: req.body.notes || "",
      updated_at: new Date().toISOString(),
    };
    if (!payload.name) return res.status(400).json({ error: "Program name is required" });
    const { data, error } = await supabase().from("referral_programs").upsert(payload, { onConflict: "name" }).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
