-- Clear existing placeholder unit costs
DELETE FROM product_unit_costs;

-- Per-jar costs from spreadsheet data
-- ingredients = raw material cost per jar
-- labor = wages per jar ($2.73 standard)
-- packaging = jar ($0.53) + lid ($0.33) + label ($0.02) = $0.88

INSERT INTO product_unit_costs (sku, ingredients, labor, packaging, updated_at) VALUES
  -- Whipped tallow balms (from costing sheets)
  -- Natural: total $3.08 (ing $0.47, labor $2.73, pkg $0.88) — was $4.36 with old label
  ('Balm-VR60', 0.74, 2.73, 0.88, now()),       -- Vanilla Rose 60ml: $4.35
  ('Balm-VR120', 1.48, 2.73, 0.88, now()),       -- Vanilla Rose 120ml: ~double ingredients
  ('F250', 0.63, 2.73, 0.88, now()),             -- Frankincense 250ml
  ('Balm-PG-VM120', 0.51, 2.73, 0.88, now()),   -- Vanilla Manuka 120ml
  ('trio-VVV-120', 2.22, 8.19, 2.64, now()),     -- Trio VVV (3x Vanilla Rose)
  ('balm-trio-VFL120', 2.02, 8.19, 2.64, now()), -- Trio VFL (Vanilla + Frank + Lav)
  ('trio-VVL-120', 2.13, 8.19, 2.64, now()),     -- Trio VVL (2x Vanilla + Lav)
  ('shampoo', 0, 0, 0, now()),                   -- Shampoo bar — fill in
  ('shampoo-bottle', 0, 2.73, 0.88, now()),      -- Liquid shampoo bottle — fill ingredients
  ('eye-c', 0, 2.73, 0.88, now()),               -- Eye cream — fill ingredients
  ('day-night-duo', 1.36, 5.46, 1.76, now()),    -- Sunset Glow + Midnight Mousse duo
  ('reviana-night', 0, 2.73, 0.88, now()),       -- Reviana night cream — fill ingredients
  ('reviana-complexion', 0, 8.19, 2.64, now())   -- Reviana complexion bundle — fill ingredients
ON CONFLICT (sku) DO UPDATE SET
  ingredients = EXCLUDED.ingredients,
  labor = EXCLUDED.labor,
  packaging = EXCLUDED.packaging,
  updated_at = now();
