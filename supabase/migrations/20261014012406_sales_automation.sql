BEGIN;
CREATE TABLE IF NOT EXISTS public.os_automation_connections (
  provider text PRIMARY KEY CHECK (provider IN ('google_sheets','instagram')),
  external_id text,
  enabled boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  secret_ciphertext text,
  last_received_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.os_sheet_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_hash text NOT NULL UNIQUE CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  source_id text NOT NULL CHECK (length(source_id) BETWEEN 1 AND 500),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  captured_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS os_sheet_snapshots_received_idx ON public.os_sheet_snapshots(received_at DESC);
CREATE TABLE IF NOT EXISTS public.os_sale_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL CHECK (source IN ('instagram','manual')),
  account_id text NOT NULL CHECK (length(account_id) BETWEEN 1 AND 300),
  external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 500),
  conversation_id text,
  source_at timestamptz,
  source_text text NOT NULL DEFAULT '' CHECK (length(source_text) <= 6000),
  draft jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(draft) = 'object'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','review','ignored','posted')),
  error_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  processing_until timestamptz,
  UNIQUE (source, account_id, external_id)
);
CREATE INDEX IF NOT EXISTS os_sale_inbox_pending_idx ON public.os_sale_inbox(status, created_at);
CREATE TABLE IF NOT EXISTS public.os_offsite_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inbox_id uuid NOT NULL UNIQUE REFERENCES public.os_sale_inbox(id),
  channel text NOT NULL CHECK (channel IN ('instagram','in_person')),
  item text NOT NULL CHECK (length(btrim(item)) BETWEEN 1 AND 500),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 100000),
  sale_total numeric(12,2) NOT NULL CHECK (sale_total > 0),
  cost_total numeric(12,2) CHECK (cost_total >= 0),
  fees_total numeric(12,2) CHECK (fees_total >= 0),
  sold_on date NOT NULL,
  payment_reference text UNIQUE CHECK (payment_reference IS NULL OR
    (length(payment_reference) BETWEEN 1 AND 200 AND payment_reference = lower(regexp_replace(btrim(payment_reference), '\s+', ' ', 'g')))),
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 6000),
  confirmed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS os_offsite_sales_date_idx ON public.os_offsite_sales(sold_on, channel);

ALTER TABLE public.os_automation_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.os_sheet_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.os_sale_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.os_offsite_sales ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.os_automation_connections, public.os_sheet_snapshots, public.os_sale_inbox, public.os_offsite_sales FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.os_automation_connections, public.os_sheet_snapshots, public.os_sale_inbox, public.os_offsite_sales TO service_role;

-- The row lock serializes confirmation against another confirmation or dismissal.
-- SECURITY INVOKER preserves the caller's table permissions; clients cannot call this RPC.
CREATE OR REPLACE FUNCTION public.os_confirm_offsite_sale(p_inbox_id uuid, p_expected_updated_at timestamptz, p_sale jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  inbox public.os_sale_inbox%ROWTYPE;
  saved public.os_offsite_sales%ROWTYPE;
  comparable jsonb;
BEGIN
  IF p_expected_updated_at IS NULL OR p_sale IS NULL OR jsonb_typeof(p_sale) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid confirmation';
  END IF;
  SELECT * INTO inbox FROM public.os_sale_inbox WHERE id = p_inbox_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Inbox record not found'; END IF;
  -- Different messages can describe one sale. Serialize the conversation as well
  -- as the individual message so two simultaneous confirmations cannot both pass.
  IF inbox.source = 'instagram' AND inbox.conversation_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('instagram:' || inbox.account_id || ':' || inbox.conversation_id, 0));
  END IF;
  SELECT * INTO saved FROM public.os_offsite_sales WHERE inbox_id = p_inbox_id;
  IF FOUND THEN
    comparable := to_jsonb(saved) - ARRAY['id','inbox_id','confirmed_at'];
    IF comparable = p_sale THEN RETURN jsonb_build_object('sale', to_jsonb(saved), 'alreadyPosted', true); END IF;
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Sale was already confirmed with different details';
  END IF;
  -- Owners can complete the validated review form even when AI preparation is unavailable.
  IF inbox.status NOT IN ('pending','review') OR inbox.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Inbox record changed; refresh before confirming';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_sale)) <> 9 OR NOT (p_sale ?& ARRAY['channel','item','quantity','sale_total','cost_total','fees_total','sold_on','payment_reference','notes']) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid sale fields';
  END IF;
  IF inbox.source = 'instagram' AND p_sale->>'channel' <> 'instagram' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Sale channel does not match its source';
  END IF;
  IF inbox.source = 'instagram' AND inbox.conversation_id IS NOT NULL AND p_sale->>'payment_reference' IS NULL
    AND EXISTS (
      SELECT 1 FROM public.os_offsite_sales s
      JOIN public.os_sale_inbox previous ON previous.id = s.inbox_id
      WHERE previous.source = 'instagram' AND previous.account_id = inbox.account_id
        AND previous.conversation_id = inbox.conversation_id
        AND s.sold_on = (p_sale->>'sold_on')::date
        AND s.sale_total = (p_sale->>'sale_total')::numeric
        AND lower(regexp_replace(btrim(s.item), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(p_sale->>'item'), '\s+', ' ', 'g'))
    ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'A matching conversation sale is already recorded; a separate sale needs a unique payment reference';
  END IF;
  INSERT INTO public.os_offsite_sales(inbox_id,channel,item,quantity,sale_total,cost_total,fees_total,sold_on,payment_reference,notes)
  VALUES(p_inbox_id,p_sale->>'channel',p_sale->>'item',(p_sale->>'quantity')::integer,(p_sale->>'sale_total')::numeric,
    (p_sale->>'cost_total')::numeric,(p_sale->>'fees_total')::numeric,(p_sale->>'sold_on')::date,p_sale->>'payment_reference',p_sale->>'notes')
  RETURNING * INTO saved;
  UPDATE public.os_sale_inbox SET status = 'posted', processing_until = NULL, error_code = NULL,
    updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond') WHERE id = p_inbox_id;
  RETURN jsonb_build_object('sale', to_jsonb(saved), 'alreadyPosted', false);
END;
$$;
REVOKE ALL ON FUNCTION public.os_confirm_offsite_sale(uuid,timestamptz,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.os_confirm_offsite_sale(uuid,timestamptz,jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
