-- Unknown Kicks — run in Supabase SQL Editor
-- Project: https://fepxpoystmqllibfmgie.supabase.co

CREATE TABLE IF NOT EXISTS admin_users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  sort_order INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  price NUMERIC(10,2) NOT NULL,
  category_id BIGINT REFERENCES categories(id),
  sold_out BOOLEAN DEFAULT FALSE,
  size_chart_json JSONB DEFAULT '[]'::jsonb,
  shipping_info TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_images (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  sort_order INT DEFAULT 0,
  is_hover BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS product_variants (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size TEXT NOT NULL,
  color TEXT NOT NULL,
  sku TEXT,
  stock INT NOT NULL DEFAULT 0,
  UNIQUE(product_id, size, color)
);

CREATE TABLE IF NOT EXISTS site_content (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS barbers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  commission_rate NUMERIC(5,2) DEFAULT 10,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  status TEXT DEFAULT 'pending',
  payment_status TEXT DEFAULT 'pending',
  stripe_session_id TEXT,
  customer_id BIGINT REFERENCES customers(id),
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT,
  shipping_json JSONB NOT NULL,
  referral_code_id BIGINT,
  barber_id BIGINT REFERENCES barbers(id),
  referral_code_text TEXT,
  subtotal NUMERIC(10,2) NOT NULL,
  total NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL,
  variant_id BIGINT NOT NULL,
  product_name TEXT NOT NULL,
  size TEXT NOT NULL,
  color TEXT NOT NULL,
  quantity INT NOT NULL,
  unit_price NUMERIC(10,2) NOT NULL,
  line_total NUMERIC(10,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS referral_codes (
  id BIGSERIAL PRIMARY KEY,
  barber_id BIGINT NOT NULL REFERENCES barbers(id),
  code TEXT NOT NULL UNIQUE,
  used_at TIMESTAMPTZ,
  order_id BIGINT REFERENCES orders(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_referral_code_id_fkey;
ALTER TABLE orders
  ADD CONSTRAINT orders_referral_code_id_fkey
  FOREIGN KEY (referral_code_id) REFERENCES referral_codes(id);

CREATE TABLE IF NOT EXISTS commissions (
  id BIGSERIAL PRIMARY KEY,
  barber_id BIGINT NOT NULL REFERENCES barbers(id),
  order_id BIGINT NOT NULL UNIQUE REFERENCES orders(id),
  amount NUMERIC(10,2) NOT NULL,
  rate_percent NUMERIC(5,2) NOT NULL,
  status TEXT DEFAULT 'unpaid',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_referral_code ON referral_codes(code);
CREATE INDEX IF NOT EXISTS idx_commissions_barber ON commissions(barber_id);
