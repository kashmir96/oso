-- Product unit costs for COGS calculation
-- Run this in Supabase SQL editor

CREATE TABLE product_unit_costs (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku             text          NOT NULL UNIQUE,
  ingredients     numeric(10,2) NOT NULL DEFAULT 0,
  labor           numeric(10,2) NOT NULL DEFAULT 0,
  packaging       numeric(10,2) NOT NULL DEFAULT 0,
  updated_at      timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE product_unit_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access" ON product_unit_costs
  FOR ALL USING (true) WITH CHECK (true);
