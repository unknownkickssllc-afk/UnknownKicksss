-- Private dated reference records. These do not create current balances, stock,
-- paid orders, or expense postings, and must never be added to those totals.
CREATE TABLE IF NOT EXISTS public.os_historical_records (
  source_key TEXT PRIMARY KEY,
  section TEXT NOT NULL CHECK (section IN ('capital','deals','consignment','inventory','expenses','referrals')),
  title TEXT NOT NULL,
  reported_on DATE,
  confidence TEXT NOT NULL CHECK (confidence IN ('user_reported','prior_extraction','derived','proposal')),
  value_text TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  source_ref TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The compact display payload and original source cells are kept separately.
-- Raw cells/formulas are retained for audit, never returned by the dashboard API.
CREATE TABLE IF NOT EXISTS public.os_sheet_imports (
  source_key TEXT PRIMARY KEY,
  source_title TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_modified_at TIMESTAMPTZ,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  source_payload JSONB NOT NULL CHECK (jsonb_typeof(source_payload) = 'object')
);

ALTER TABLE public.os_historical_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.os_sheet_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.os_historical_records, public.os_sheet_imports FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.os_historical_records, public.os_sheet_imports TO service_role;
