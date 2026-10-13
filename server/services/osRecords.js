class RecordEditError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const fail = (message, status = 400) => { throw new RecordEditError(status, message); };
const text = (required = false, max = 5000) => (value, field) => {
  if (typeof value !== "string") fail(`${field} must be text.`);
  const clean = value.trim();
  if (required && !clean) fail(`${field} is required.`);
  if (clean.length > max) fail(`${field} is too long.`);
  return clean;
};
const nullable = (parse) => (value, field) => value === null ? null : parse(value, field);
const number = (decimals = 2, max = 9999999999.99, positive = false) => (value, field) => {
  if (!["number", "string"].includes(typeof value) || !/^\d+(?:\.\d+)?$/.test(String(value).trim())) {
    fail(`${field} must be a valid nonnegative number.`);
  }
  const clean = Number(value);
  const places = String(value).trim().split(".")[1]?.length || 0;
  if (!Number.isFinite(clean) || clean > max || places > decimals || (positive && clean <= 0)) {
    fail(`${field} must be ${positive ? "positive" : "zero or greater"}, with at most ${decimals} decimal places.`);
  }
  return clean;
};
const enumValue = (...values) => (value, field) => {
  if (!values.includes(value)) fail(`${field} is not a supported option.`);
  return value;
};
const boolean = (value, field) => {
  if (typeof value !== "boolean") fail(`${field} must be true or false.`);
  return value;
};
const date = (value, field) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) ||
      new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    fail(`${field} must be a valid date.`);
  }
  return value;
};

const recordTypes = {
  "funding-accounts": {
    table: "funding_accounts", timestamp: true,
    fields: {
      label: text(true, 200), account_type: enumValue("cash", "credit", "bank", "business_cash", "other"),
      purpose: enumValue("inventory", "operations", "mixed", "legacy", "other"),
      available_to_business: number(), business_balance: number(), credit_limit: nullable(number()),
      apr_percent: nullable(number(3, 9999.999)), promo_apr_percent: nullable(number(3, 9999.999)),
      promo_expires: nullable(date), legacy: boolean, notes: text(),
    },
  },
  deals: {
    table: "inventory_deals", timestamp: true,
    fields: {
      deal_code: text(true, 100), title: text(true, 300), total_cost: number(), purchased_at: nullable(date),
      status: enumValue("planned", "active", "partially_sold", "sold", "cancelled"), notes: text(),
    },
    dependent: { field: "total_cost", table: "deal_contributions", key: "deal_id", label: "partner contributions" },
  },
  consignments: {
    table: "consignment_positions", guard: ["inventory_asset_id", "sold_at", "paid_at"],
    fields: {
      item_name: text(true, 300), direction: enumValue("outbound", "inbound"), partner_name: nullable(text(false, 200)),
      original_cost: number(), list_price: number(), fee_percent: nullable(number(3, 100)),
      expected_payout: number(), payout_received_amount: nullable(number()),
      payout_status: enumValue("active", "pending", "paid", "retrieved", "void"),
      lock_until: nullable(date), pull_date: nullable(date), notes: text(),
    },
  },
  expenses: {
    table: "operating_expenses", guard: ["budget_bucket_id", "funding_account_id"],
    fields: {
      category: text(true, 100), description: text(true, 500), amount: number(2, 9999999999.99, true),
      expense_date: date, recurring: boolean, notes: text(),
    },
    dependent: { field: "amount", table: "expense_splits", key: "expense_id", label: "partner splits" },
  },
  "referral-programs": {
    table: "referral_programs", timestamp: true,
    fields: {
      name: text(true, 200), customer_discount: number(), referrer_reward: number(),
      min_pre_promo_profit: number(), active: boolean, notes: text(),
    },
  },
};

function positiveId(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) fail("Choose a valid record.");
  return Number(value);
}

function sameValue(left, right) {
  if (left === null || right === null || left === undefined || right === undefined) return left === right;
  return typeof left === "boolean" || typeof right === "boolean" ? left === right : String(left) === String(right);
}

function validateEdit(kind, id, body) {
  const config = recordTypes[kind];
  if (!config) fail("This record type cannot be edited.");
  positiveId(id);
  if (!body || typeof body !== "object" || Array.isArray(body)) fail("Send the fields you want to change.");
  const changes = {};
  for (const [field, value] of Object.entries(body)) {
    if (["expected_updated_at", "expected"].includes(field)) continue;
    if (!Object.hasOwn(config.fields, field)) fail(`${field} cannot be changed here.`);
    changes[field] = config.fields[field](value, field);
  }
  if (!Object.keys(changes).length) fail("Choose at least one field to change.");
  if (config.timestamp) {
    if (typeof body.expected_updated_at !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(body.expected_updated_at) ||
        !Number.isFinite(Date.parse(body.expected_updated_at))) fail("Refresh this record before saving.");
  } else {
    if (!body.expected || typeof body.expected !== "object" || Array.isArray(body.expected)) fail("Refresh this record before saving.");
    for (const field of [...Object.keys(config.fields), ...(config.guard || [])]) {
      if (!Object.hasOwn(body.expected, field)) fail("Refresh this record before saving.");
    }
  }
  return { config, changes, id: positiveId(id) };
}

async function updateRecord(sb, kind, recordId, body) {
  const { config, changes, id } = validateEdit(kind, recordId, body);
  const { data: current, error: readError } = await sb.from(config.table).select("*").eq("id", id).maybeSingle();
  if (readError) throw readError;
  if (!current) fail("This record no longer exists. Refresh the page.", 404);
  const guards = config.timestamp ? ["updated_at"] : [...Object.keys(config.fields), ...(config.guard || [])];
  const expected = config.timestamp ? { updated_at: body.expected_updated_at } : body.expected;
  for (const field of guards) {
    if (!sameValue(current[field], expected[field])) fail("This record changed since you opened it. Refresh and review the latest version.", 409);
  }
  const dependent = config.dependent;
  if (dependent && Object.hasOwn(changes, dependent.field) && !sameValue(changes[dependent.field], current[dependent.field])) {
    const { data, error } = await sb.from(dependent.table).select("id").eq(dependent.key, id).limit(1);
    if (error) throw error;
    if (data?.length) fail(`This total has ${dependent.label}. Keep the total unchanged until those are reconciled.`, 409);
  }
  if (config.timestamp) {
    // Always advance the version even when two edits arrive in the same millisecond.
    changes.updated_at = new Date(Math.max(Date.now(), Date.parse(current.updated_at) + 1)).toISOString();
  }
  let query = sb.from(config.table).update(changes).eq("id", id);
  for (const field of guards) query = current[field] === null ? query.is(field, null) : query.eq(field, current[field]);
  const { data, error } = await query.select("*").maybeSingle();
  if (error) throw error;
  if (!data) fail("This record changed while saving. Refresh and review the latest version.", 409);
  return data;
}

module.exports = { recordTypes, RecordEditError, validateEdit, updateRecord };
