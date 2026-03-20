-- Run this in Supabase SQL editor to create inventory, supplier orders, and abandoned checkout tables

-- ── Inventory Baselines ──
-- Manual stock counts per SKU. The most recent count is the baseline,
-- then manufactured-since and sold-since are applied on top.
CREATE TABLE inventory_baselines (
  id bigint generated always as identity primary key,
  sku text NOT NULL,
  quantity int NOT NULL,
  counted_at timestamptz NOT NULL DEFAULT now(),
  notes text
);
CREATE INDEX idx_inv_baseline_sku ON inventory_baselines (sku, counted_at DESC);

-- ── Inventory Reorder Points ──
-- Per-SKU thresholds for low stock alerts
CREATE TABLE inventory_reorder_points (
  sku text PRIMARY KEY,
  reorder_point int NOT NULL DEFAULT 10,
  reorder_qty int NOT NULL DEFAULT 50,
  alert_sent_at timestamptz
);

-- ── Supplier Orders ──
-- Staff request raw materials / packaging; admin tracks ordering + delivery
CREATE TABLE supplier_orders (
  id bigint generated always as identity primary key,
  item_name text NOT NULL,
  supplier_name text,
  quantity text,
  status text NOT NULL DEFAULT 'requested',
  requested_by text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  ordered_at timestamptz,
  tracking_number text,
  tracking_url text,
  expected_delivery date,
  received_at timestamptz,
  notes text,
  cost numeric(10,2)
);
CREATE INDEX idx_supplier_orders_status ON supplier_orders (status, requested_at DESC);

-- ── Abandoned Checkout Status ──
-- Tracks recovery status for expired Stripe checkout sessions
CREATE TABLE abandoned_checkout_status (
  stripe_session_id text PRIMARY KEY,
  status text NOT NULL DEFAULT 'new',
  contacted_at timestamptz,
  contacted_by text,
  notes text,
  updated_at timestamptz DEFAULT now()
);

-- ── RLS policies (service role full access) ──
ALTER TABLE inventory_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_reorder_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE abandoned_checkout_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_full_access" ON inventory_baselines FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_full_access" ON inventory_reorder_points FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_full_access" ON supplier_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_full_access" ON abandoned_checkout_status FOR ALL USING (true) WITH CHECK (true);
