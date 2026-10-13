-- Upgrade existing Business OS tables after supabase/os_v1.sql has been applied.
-- Run in the Supabase SQL Editor as the database owner. No rows are changed.
-- service_role bypasses RLS and retains the backend read/write permissions.

-- Business OS is private to the Express admin session. Supabase Auth users do
-- not share that session, so neither client role receives table access or policies.
-- This block is safe to run repeatedly and changes permissions only.
-- Keep this block in sync with the security block in supabase/os_v1.sql.
DO $os_private$
DECLARE
  os_table TEXT;
  os_sequence TEXT;
BEGIN
  FOREACH os_table IN ARRAY ARRAY[
    'business_members',
    'funding_accounts',
    'inventory_deals',
    'deal_contributions',
    'inventory_assets',
    'consignment_positions',
    'budget_buckets',
    'operating_expenses',
    'expense_splits',
    'referral_programs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', os_table);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated', os_table);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', os_table);

    -- Grant the backend sequence access needed by BIGSERIAL inserts without
    -- assuming the sequence name or touching any storefront sequences.
    os_sequence := pg_get_serial_sequence(format('public.%I', os_table), 'id');
    IF os_sequence IS NOT NULL THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE %s FROM PUBLIC, anon, authenticated', os_sequence);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO service_role', os_sequence);
    END IF;
  END LOOP;
END;
$os_private$;
