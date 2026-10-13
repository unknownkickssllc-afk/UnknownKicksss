-- Corrections are separate from immutable source imports and are only accessed by the admin server.
CREATE TABLE IF NOT EXISTS public.os_history_overrides (
  entity_type text NOT NULL CHECK (entity_type IN ('references', 'items', 'expenses')),
  source_key text NOT NULL CHECK (length(source_key) BETWEEN 1 AND 500),
  patch jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(patch) = 'object' AND octet_length(patch::text) <= 65536),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, source_key)
);
ALTER TABLE public.os_history_overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.os_history_overrides FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.os_history_overrides TO service_role;
COMMENT ON TABLE public.os_history_overrides IS 'Private owner corrections; never overwrites imported source records or creates current financial transactions.';
