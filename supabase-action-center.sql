-- ============================================
-- Action Center Schema for Primal Pantry Dashboard
-- Run this in the Supabase SQL Editor
-- ============================================

-- 1. User-editable threshold configuration
CREATE TABLE action_rule_config (
  id SERIAL PRIMARY KEY,
  config_key TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL,
  label TEXT NOT NULL,
  value NUMERIC NOT NULL,
  unit TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Rule definitions
CREATE TABLE action_rules (
  id SERIAL PRIMARY KEY,
  rule_key TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'P2',
  enabled BOOLEAN NOT NULL DEFAULT true,
  sms_on_trigger BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Triggered alerts
CREATE TABLE action_alerts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rule_key TEXT NOT NULL,
  category TEXT NOT NULL,
  priority TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  context JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'new',
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  sms_sent BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_action_alerts_status ON action_alerts(status, priority, created_at DESC);
CREATE INDEX idx_action_alerts_created ON action_alerts(created_at DESC);

-- 4. AI daily/weekly summaries
CREATE TABLE action_daily_summary (
  id SERIAL PRIMARY KEY,
  summary_date DATE NOT NULL,
  summary_type TEXT NOT NULL DEFAULT 'daily',
  summary_text TEXT NOT NULL,
  alert_snapshot JSONB DEFAULT '{}',
  generated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_action_summary_date_type ON action_daily_summary(summary_date, summary_type);

-- 5. RLS
ALTER TABLE action_rule_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_daily_summary ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_full_access" ON action_rule_config FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_full_access" ON action_rules FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_full_access" ON action_alerts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_full_access" ON action_daily_summary FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- Seed: Default threshold configuration
-- ============================================

INSERT INTO action_rule_config (config_key, category, label, value, unit) VALUES
  -- Ad Ops
  ('cpa_target', 'adops', 'CPA Target (NZD)', 30, '$'),
  ('cpa_kill_multiplier', 'adops', 'Kill CPA Multiplier', 2, 'x'),
  ('cpa_kill_days', 'adops', 'Kill CPA Window (days)', 3, 'days'),
  ('ctr_kill_floor', 'adops', 'Kill CTR Floor (%)', 0.5, '%'),
  ('ctr_kill_hours', 'adops', 'Kill CTR Window (hours)', 48, 'hours'),
  ('zero_conv_spend_multiplier', 'adops', 'Kill Zero-Conv Spend Multiplier', 2, 'x'),
  ('freq_kill_threshold', 'adops', 'Kill Frequency Threshold', 4.0, ''),
  ('freq_kill_days', 'adops', 'Kill Frequency Window (days)', 7, 'days'),
  ('cpa_scale_pct', 'adops', 'Scale CPA Below Target (%)', 70, '%'),
  ('cpa_scale_days', 'adops', 'Scale CPA Window (days)', 5, 'days'),
  ('roas_scale_threshold', 'adops', 'Scale ROAS Threshold', 3, 'x'),
  ('roas_scale_days', 'adops', 'Scale ROAS Window (days)', 7, 'days'),
  ('ctr_creative_floor', 'adops', 'New Creative CTR Floor (%)', 0.8, '%'),
  ('ctr_creative_days', 'adops', 'New Creative CTR Window (days)', 5, 'days'),
  ('freq_creative_threshold', 'adops', 'New Creative Frequency', 3.5, ''),
  ('anomaly_cpa_pct', 'adops', 'Anomaly CPA Change (%)', 30, '%'),
  ('anomaly_ctr_drop_pct', 'adops', 'Anomaly CTR Drop (%)', 40, '%'),
  ('anomaly_spend_pct', 'adops', 'Anomaly Spend Change (%)', 50, '%'),
  ('anomaly_conv_drop_pct', 'adops', 'Anomaly Conv Drop (%)', 35, '%'),
  ('anomaly_roas_drop_pct', 'adops', 'Anomaly ROAS Drop (%)', 25, '%'),
  ('anomaly_baseline_days', 'adops', 'Anomaly Baseline Window (days)', 14, 'days'),
  -- Inventory
  ('reorder_days_supply', 'inventory', 'Reorder Alert (days supply)', 45, 'days'),
  ('urgent_days_supply', 'inventory', 'Urgent Alert (days supply)', 14, 'days'),
  ('velocity_spike_pct', 'inventory', 'Velocity Spike Alert (%)', 30, '%'),
  ('overstock_pause_days', 'inventory', 'Overstock Pause (days)', 120, 'days'),
  ('overstock_bundle_days', 'inventory', 'Overstock Bundle Tier (days)', 90, 'days'),
  ('overstock_discount_days', 'inventory', 'Overstock Discount Tier (days)', 120, 'days'),
  ('overstock_clearance_days', 'inventory', 'Overstock Clearance Tier (days)', 180, 'days'),
  ('zero_sales_days', 'inventory', 'Zero Sales Alert (days)', 14, 'days'),
  ('sales_spike_pct', 'inventory', 'Sales Spike Threshold (%)', 50, '%'),
  ('sales_spike_days', 'inventory', 'Sales Spike Window (days)', 3, 'days');

-- ============================================
-- Seed: Rule definitions
-- ============================================

INSERT INTO action_rules (rule_key, category, name, description, priority, sms_on_trigger) VALUES
  -- Ad Ops: Kill
  ('adops_kill_cpa', 'adops', 'Kill Ad: CPA too high', 'CPA exceeds target multiplier for N rolling days', 'P1', true),
  ('adops_kill_ctr', 'adops', 'Kill Ad: CTR collapsed', 'CTR below floor for N hours', 'P1', true),
  ('adops_kill_zero_conv', 'adops', 'Kill Ad: Zero conversions', 'No conversions after spending > 2x CPA target', 'P1', true),
  ('adops_kill_frequency', 'adops', 'Flag Ad: Frequency too high', 'Ad frequency exceeds threshold in window', 'P2', false),
  -- Ad Ops: Scale
  ('adops_scale_cpa', 'adops', 'Scale Ad: CPA efficient', 'CPA below target % for N days — increase budget 20%', 'P2', false),
  ('adops_scale_roas', 'adops', 'Scale Ad: ROAS strong', 'ROAS above threshold for N days — increase budget 30%', 'P2', false),
  -- Ad Ops: Creatives
  ('adops_creative_ctr', 'adops', 'New Creatives: CTR low', 'CTR below threshold for N days — create new ad', 'P2', false),
  ('adops_creative_freq', 'adops', 'New Creatives: Frequency high', 'Frequency above threshold — audience fatigued', 'P2', false),
  -- Ad Ops: Anomalies
  ('adops_anomaly_cpa', 'adops', 'Anomaly: CPA spike', 'CPA changed significantly vs baseline', 'P1', true),
  ('adops_anomaly_ctr', 'adops', 'Anomaly: CTR drop', 'CTR dropped significantly vs baseline', 'P1', true),
  ('adops_anomaly_spend', 'adops', 'Anomaly: Spend change', 'Daily spend moved unexpectedly vs baseline', 'P1', true),
  ('adops_anomaly_conv', 'adops', 'Anomaly: Conversions drop', 'Conversions dropped significantly vs baseline', 'P1', true),
  ('adops_anomaly_roas', 'adops', 'Anomaly: ROAS drop', 'ROAS dropped significantly vs baseline', 'P1', true),
  -- Inventory
  ('inv_reorder', 'inventory', 'Reorder: Low stock', 'Stock below reorder threshold (days of supply)', 'P1', true),
  ('inv_urgent', 'inventory', 'Urgent: Critical stock', 'Stock below urgent threshold — emergency reorder', 'P1', true),
  ('inv_overstock_bundle', 'inventory', 'Overstock: Bundle tier', 'Stock 90-120 days — add to bundle, increase ad spend', 'P3', false),
  ('inv_overstock_discount', 'inventory', 'Overstock: Discount tier', 'Stock 120-180 days — run targeted discount', 'P2', false),
  ('inv_overstock_clearance', 'inventory', 'Overstock: Clearance tier', 'Stock 180+ days — clearance pricing', 'P1', false),
  ('inv_zero_sales', 'inventory', 'Anomaly: Zero sales', 'SKU had zero sales for N consecutive days', 'P2', false),
  ('inv_velocity_spike', 'inventory', 'Anomaly: Sales spike', 'Sales velocity spiked — check stock runway', 'P2', true);
