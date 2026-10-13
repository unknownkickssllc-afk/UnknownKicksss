-- Private cost defaults and immutable-at-checkout cost snapshots.
-- Existing sales stay uncosted until an admin supplies their actual historical cost.
BEGIN;
CREATE TABLE IF NOT EXISTS public.os_product_costs (
  product_id BIGINT PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  unit_cost NUMERIC(12,2) CHECK (unit_cost >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.os_order_item_costs (
  order_item_id BIGINT PRIMARY KEY REFERENCES public.order_items(id) ON DELETE CASCADE,
  unit_cost NUMERIC(12,2) CHECK (unit_cost >= 0),
  source TEXT NOT NULL DEFAULT 'checkout' CHECK (source IN ('checkout', 'admin', 'historical_unknown')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.os_product_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.os_order_item_costs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.os_product_costs, public.os_order_item_costs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.os_product_costs, public.os_order_item_costs TO service_role;

CREATE SCHEMA IF NOT EXISTS os_private;
REVOKE ALL ON SCHEMA os_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA os_private TO service_role;
CREATE OR REPLACE FUNCTION os_private.snapshot_order_item_cost()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.os_order_item_costs(order_item_id, unit_cost, source)
  VALUES (NEW.id, (SELECT c.unit_cost FROM public.os_product_costs c WHERE c.product_id = NEW.product_id), 'checkout')
  ON CONFLICT (order_item_id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION os_private.snapshot_order_item_cost() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION os_private.snapshot_order_item_cost() TO service_role;
DROP TRIGGER IF EXISTS os_snapshot_order_item_cost ON public.order_items;
CREATE TRIGGER os_snapshot_order_item_cost AFTER INSERT ON public.order_items
FOR EACH ROW EXECUTE FUNCTION os_private.snapshot_order_item_cost();

INSERT INTO public.os_order_item_costs(order_item_id, unit_cost, source)
SELECT id, NULL, 'historical_unknown' FROM public.order_items
ON CONFLICT (order_item_id) DO NOTHING;
NOTIFY pgrst, 'reload schema';
COMMIT;
