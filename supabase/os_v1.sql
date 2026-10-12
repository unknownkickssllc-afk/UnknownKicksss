-- Unknown Kickss OS v1
-- Additive schema for capital, inventory ownership, consignment, budgets, expenses, and referral planning.
-- Run after supabase/schema.sql.

CREATE TABLE IF NOT EXISTS business_members (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'partner',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS funding_accounts (
  id BIGSERIAL PRIMARY KEY,
  member_id BIGINT REFERENCES business_members(id),
  label TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'cash'
    CHECK (account_type IN ('cash','credit','bank','business_cash','other')),
  purpose TEXT NOT NULL DEFAULT 'mixed'
    CHECK (purpose IN ('inventory','operations','mixed','legacy','other')),
  available_to_business NUMERIC(12,2) NOT NULL DEFAULT 0,
  business_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  credit_limit NUMERIC(12,2),
  apr_percent NUMERIC(7,3),
  promo_apr_percent NUMERIC(7,3),
  promo_expires DATE,
  legacy BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_deals (
  id BIGSERIAL PRIMARY KEY,
  deal_code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  ownership_type TEXT NOT NULL DEFAULT 'joint'
    CHECK (ownership_type IN ('individual','joint','consignment_in','legacy','other')),
  total_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  purchased_at DATE,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','active','partially_sold','sold','cancelled')),
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deal_contributions (
  id BIGSERIAL PRIMARY KEY,
  deal_id BIGINT NOT NULL REFERENCES inventory_deals(id) ON DELETE CASCADE,
  member_id BIGINT NOT NULL REFERENCES business_members(id),
  funding_account_id BIGINT REFERENCES funding_accounts(id),
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ownership_percent NUMERIC(7,3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_assets (
  id BIGSERIAL PRIMARY KEY,
  deal_id BIGINT REFERENCES inventory_deals(id) ON DELETE SET NULL,
  product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
  variant_id BIGINT REFERENCES product_variants(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  sku TEXT,
  quantity INT NOT NULL DEFAULT 1,
  unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  list_price NUMERIC(12,2),
  location TEXT NOT NULL DEFAULT 'in_hand'
    CHECK (location IN ('in_hand','website','consigned_out','sold','other')),
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available','reserved','sold','returned','removed')),
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS consignment_positions (
  id BIGSERIAL PRIMARY KEY,
  inventory_asset_id BIGINT REFERENCES inventory_assets(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'outbound'
    CHECK (direction IN ('outbound','inbound')),
  partner_name TEXT,
  original_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  list_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  fee_percent NUMERIC(7,3),
  expected_payout NUMERIC(12,2) NOT NULL DEFAULT 0,
  payout_received_amount NUMERIC(12,2),
  payout_status TEXT NOT NULL DEFAULT 'active'
    CHECK (payout_status IN ('active','pending','paid','retrieved','void')),
  lock_until DATE,
  pull_date DATE,
  sold_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS budget_buckets (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  allocated_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  period_start DATE,
  period_end DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS operating_expenses (
  id BIGSERIAL PRIMARY KEY,
  budget_bucket_id BIGINT REFERENCES budget_buckets(id) ON DELETE SET NULL,
  funding_account_id BIGINT REFERENCES funding_accounts(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  recurring BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS expense_splits (
  id BIGSERIAL PRIMARY KEY,
  expense_id BIGINT NOT NULL REFERENCES operating_expenses(id) ON DELETE CASCADE,
  member_id BIGINT NOT NULL REFERENCES business_members(id),
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  split_percent NUMERIC(7,3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referral_programs (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  customer_discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  referrer_reward NUMERIC(12,2) NOT NULL DEFAULT 0,
  min_pre_promo_profit NUMERIC(12,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_funding_accounts_member ON funding_accounts(member_id);
CREATE INDEX IF NOT EXISTS idx_deal_contributions_deal ON deal_contributions(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_contributions_member ON deal_contributions(member_id);
CREATE INDEX IF NOT EXISTS idx_inventory_assets_deal ON inventory_assets(deal_id);
CREATE INDEX IF NOT EXISTS idx_inventory_assets_status ON inventory_assets(status);
CREATE INDEX IF NOT EXISTS idx_consignment_status ON consignment_positions(payout_status);
CREATE INDEX IF NOT EXISTS idx_operating_expenses_date ON operating_expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_expense_splits_expense ON expense_splits(expense_id);

INSERT INTO business_members (name, role)
VALUES ('Jahson', 'partner'), ('Jamal', 'partner')
ON CONFLICT (name) DO NOTHING;
