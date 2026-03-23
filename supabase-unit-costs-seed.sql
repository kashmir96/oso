-- Clear existing placeholder unit costs
DELETE FROM product_unit_costs;

-- Per-jar costs derived from ingredient costing sheets
-- Packaging per jar: jar $0.53 + lid $0.33 + label $0.02 = $0.88
-- Labor per jar: $2.73
-- 120ml = 2x ingredients of 60ml, 250ml = 4.17x ingredients of 60ml
-- Trios = 3 jars (3x labor, 3x packaging)
-- Duos = 2 jars (2x labor, 2x packaging)

INSERT INTO product_unit_costs (sku, ingredients, labor, packaging, updated_at) VALUES
  -- Vanilla Rose 60ml: ing $0.74
  ('Balm-VR60', 0.74, 2.73, 0.88, now()),
  -- Vanilla Rose 120ml: ing $1.48 (2x)
  ('Balm-VR120', 1.48, 2.73, 0.88, now()),
  -- Frankincense 250ml: ing $2.63 (4.17x of $0.63)
  ('F250', 2.63, 2.73, 0.88, now()),
  -- Vanilla Manuka 120ml: ing $1.02 (2x of $0.51)
  ('Balm-PG-VM120', 1.02, 2.73, 0.88, now()),
  -- Trio VVV 120ml: 3x Vanilla Rose 120ml = ing $4.44, 3x labor, 3x pkg
  ('trio-VVV-120', 4.44, 8.19, 2.64, now()),
  -- Trio VFL 120ml: VR $1.48 + Frank $1.26 + Lav $1.30 = $4.04
  ('balm-trio-VFL120', 4.04, 8.19, 2.64, now()),
  -- Trio VVL 120ml: 2x VR $2.96 + Lav $1.30 = $4.26
  ('trio-VVL-120', 4.26, 8.19, 2.64, now()),
  -- Shampoo bar: no costing sheet yet
  ('shampoo', 0, 0, 0, now()),
  -- Liquid Shampoo 500ml: no per-bottle costing yet
  ('shampoo-bottle', 0, 2.73, 0.88, now()),
  -- Eye Cream: Reviana eye cream, no costing yet
  ('eye-c', 0, 2.73, 0.88, now()),
  -- Day n Night Duo: Sunset Glow $0.80 + Midnight Mousse $0.56 = $1.36
  ('day-night-duo', 1.36, 5.46, 1.76, now()),
  -- Reviana Night Cream: no costing yet
  ('reviana-night', 0, 2.73, 0.88, now()),
  -- Reviana Complexion Bundle: no costing yet
  ('reviana-complexion', 0, 8.19, 2.64, now())
ON CONFLICT (sku) DO UPDATE SET
  ingredients = EXCLUDED.ingredients,
  labor = EXCLUDED.labor,
  packaging = EXCLUDED.packaging,
  updated_at = now();
