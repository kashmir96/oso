-- Seed ingredients with known prices from costing sheets
-- All others default to 0 — update via stocktake UI

INSERT INTO ingredients (name, price_per_kg, category) VALUES
  ('Water', 0, 'Raw Material'),
  ('Aloe Vera Powder', 0, 'Raw Material'),
  ('Glycerine', 0, 'Raw Material'),
  ('Xanthan', 0, 'Raw Material'),
  ('Emulsifying Wax', 0, 'Raw Material'),
  ('Cetyl Alcohol', 0, 'Raw Material'),
  ('Cetearyl Alcohol', 0, 'Raw Material'),
  ('Beeswax', 0, 'Raw Material'),
  ('Almond Oil', 0, 'Raw Material'),
  ('Jojoba Oil', 44.85, 'Raw Material'),
  ('Argan Oil', 0, 'Raw Material'),
  ('GTCC', 0, 'Raw Material'),
  ('Olive Squalane', 0, 'Raw Material'),
  ('Tallow', 5.20, 'Raw Material'),
  ('Spectrastat', 0, 'Preservative'),
  ('Spectrastat G2', 0, 'Preservative'),
  ('Tocopherol', 0, 'Antioxidant'),
  ('Chamomile Flower Oil', 0, 'Essential Oil'),
  ('D-Panthenol', 0, 'Active'),
  ('Sodium Ascorbyl Phosphate', 0, 'Active'),
  ('Vitamin C', 0, 'Active'),
  ('Hyaluronic Acid', 0, 'Active'),
  ('Bisabolol', 0, 'Active'),
  ('Microcare DB', 0, 'Preservative'),
  ('Licorice Extract', 0, 'Active'),
  ('Brazilian Orange Essential Oil', 75, 'Essential Oil'),
  ('Sodium Citrate', 0, 'Raw Material'),
  ('Plantacare 1200', 0, 'Surfactant'),
  ('Stepanol', 0, 'Surfactant'),
  ('Citric Acid', 0, 'Raw Material'),
  ('Rose Geranium', 0, 'Essential Oil'),
  ('Vitamin E', 0, 'Antioxidant'),
  ('Sodium Chloride', 0, 'Raw Material'),
  ('Sunflower Oil', 0, 'Raw Material'),
  ('Coconut Oil', 0, 'Raw Material'),
  ('Sodium Cocoyl', 0, 'Surfactant'),
  ('Emulsifying Wax Olivem', 0, 'Raw Material'),
  ('Glyceryl', 0, 'Raw Material'),
  ('Castor Oil', 0, 'Raw Material'),
  ('Zinclear', 0, 'Active'),
  ('Sea Buckthorn', 227.20, 'Raw Material'),
  ('Ylang Ylang', 984.78, 'Essential Oil'),
  ('Manuka Honey', 15.50, 'Raw Material'),
  ('Chocolate Treat', 334.71, 'Fragrance'),
  ('Lavender', 220, 'Essential Oil'),
  ('Vanilla', 170, 'Essential Oil'),
  ('Rose Essential Oil', 475, 'Essential Oil'),
  ('Frankincense', 190, 'Essential Oil'),
  ('Blue Tansy', 4600, 'Essential Oil'),
  ('Sodium Hydroxide', 0, 'Raw Material'),
  ('Activated Charcoal', 0, 'Raw Material'),
  ('Tea Tree Oil', 0, 'Essential Oil'),
  ('Olive Oil', 0, 'Raw Material'),
  ('Shea Butter', 0, 'Raw Material'),
  ('Cocoa Butter', 0, 'Raw Material'),
  ('Oats', 0, 'Raw Material'),
  ('Niacinamide', 0, 'Active'),
  ('Dermofeel PA-3', 0, 'Active'),
  ('Lecigel', 0, 'Raw Material'),
  ('Squalane', 0, 'Raw Material'),
  ('Olivem 1000', 0, 'Raw Material'),
  ('Tetrahexyldecyl Ascorbate', 0, 'Active'),
  ('Kakadu Plum Extract', 0, 'Active'),
  ('Alpha-Bisabolol', 0, 'Active'),
  ('Dermofeel Toco 70', 0, 'Antioxidant'),
  ('Caffeine Powder', 0, 'Active'),
  ('Hexapeptide-8', 0, 'Active'),
  ('Cetiol CC', 0, 'Raw Material'),
  ('Bodyflux Ceramide NP', 0, 'Active'),
  ('Bakuchiol', 0, 'Active')
ON CONFLICT (name) DO NOTHING;

-- ═══════════════════════════════════════
-- Product formulations mapped to real SHOP SKUs
-- ═══════════════════════════════════════

-- Vanilla Rose (used by Balm-VR60, Balm-VR120, trios)
INSERT INTO product_ingredients (product_sku, product_name, ingredient_id, percentage)
SELECT 'Balm-VR60', 'Tallow Balm - Vanilla Rose 60ml', id, v.pct FROM ingredients i
JOIN (VALUES
  ('Tallow', 97.62), ('Jojoba Oil', 1.38), ('Vanilla', 0.5), ('Rose Essential Oil', 0.5)
) AS v(ing_name, pct) ON i.name = v.ing_name;

INSERT INTO product_ingredients (product_sku, product_name, ingredient_id, percentage)
SELECT 'Balm-VR120', 'Tallow Balm - Vanilla Rose 120ml', id, v.pct FROM ingredients i
JOIN (VALUES
  ('Tallow', 97.62), ('Jojoba Oil', 1.38), ('Vanilla', 0.5), ('Rose Essential Oil', 0.5)
) AS v(ing_name, pct) ON i.name = v.ing_name;

-- Frankincense (F250)
INSERT INTO product_ingredients (product_sku, product_name, ingredient_id, percentage)
SELECT 'F250', 'Whipped Tallow Balm - Frankincense 250ml', id, v.pct FROM ingredients i
JOIN (VALUES
  ('Tallow', 97.62), ('Jojoba Oil', 1.38), ('Frankincense', 1.0)
) AS v(ing_name, pct) ON i.name = v.ing_name;

-- Vanilla Manuka (Balm-PG-VM120)
INSERT INTO product_ingredients (product_sku, product_name, ingredient_id, percentage)
SELECT 'Balm-PG-VM120', 'Tallow & Honey Balm - Manuka & Vanilla 120ml', id, v.pct FROM ingredients i
JOIN (VALUES
  ('Tallow', 97.38), ('Jojoba Oil', 1.38), ('Manuka Honey', 1.0), ('Vanilla', 0.24)
) AS v(ing_name, pct) ON i.name = v.ing_name;

-- Shampoo bar
INSERT INTO product_ingredients (product_sku, product_name, ingredient_id, percentage)
SELECT 'shampoo', 'Tallow Shampoo Bar', id, v.pct FROM ingredients i
JOIN (VALUES
  ('Tallow', 68.3), ('Sodium Hydroxide', 9.1), ('Sodium Chloride', 2.5),
  ('Water', 20.1)
) AS v(ing_name, pct) ON i.name = v.ing_name;

-- Liquid Shampoo (shampoo-bottle)
INSERT INTO product_ingredients (product_sku, product_name, ingredient_id, percentage)
SELECT 'shampoo-bottle', 'Tallow Shampoo - Fresh Geranium 500ml', id, v.pct FROM ingredients i
JOIN (VALUES
  ('Water', 54.95), ('Plantacare 1200', 17.0), ('Stepanol', 8.0), ('Glycerine', 5.0),
  ('Aloe Vera Powder', 0.05), ('Tallow', 0.1), ('Citric Acid', 0.3),
  ('Spectrastat', 2.0), ('Rose Geranium', 0.2), ('Vitamin E', 0.1), ('Sodium Chloride', 0.3)
) AS v(ing_name, pct) ON i.name = v.ing_name;

-- Eye Cream (eye-c) — Reviana Eye Cream recipe
INSERT INTO product_ingredients (product_sku, product_name, ingredient_id, percentage)
SELECT 'eye-c', 'Tallow Eye Cream', id, v.pct FROM ingredients i
JOIN (VALUES
  ('Water', 78.0), ('D-Panthenol', 0.5), ('Niacinamide', 2.0), ('Dermofeel PA-3', 0.1),
  ('Aloe Vera Powder', 0.1), ('Glycerine', 4.0), ('Hyaluronic Acid', 0.1),
  ('Lecigel', 2.0), ('GTCC', 3.0), ('Jojoba Oil', 2.0), ('Squalane', 2.0),
  ('Shea Butter', 1.0), ('Tallow', 0.5), ('Tetrahexyldecyl Ascorbate', 2.0),
  ('Hexapeptide-8', 1.0), ('Alpha-Bisabolol', 0.1), ('Dermofeel Toco 70', 0.1),
  ('Microcare DB', 1.0)
) AS v(ing_name, pct) ON i.name = v.ing_name;

-- Sunset Glow (part of day-night-duo)
INSERT INTO product_ingredients (product_sku, product_name, ingredient_id, percentage)
SELECT 'day-night-duo', 'Day n Night Duo - Sunset Glow', id, v.pct FROM ingredients i
JOIN (VALUES
  ('Tallow', 96.0), ('Jojoba Oil', 2.0), ('Sea Buckthorn', 0.8),
  ('Ylang Ylang', 0.2), ('Manuka Honey', 1.0)
) AS v(ing_name, pct) ON i.name = v.ing_name;

-- Reviana Night Cream
INSERT INTO product_ingredients (product_sku, product_name, ingredient_id, percentage)
SELECT 'reviana-night', 'Night Cream 50ml - Reviana', id, v.pct FROM ingredients i
JOIN (VALUES
  ('Water', 67.2), ('D-Panthenol', 0.5), ('Niacinamide', 2.0), ('Dermofeel PA-3', 0.1),
  ('Aloe Vera Powder', 0.1), ('Glycerine', 4.0), ('Hyaluronic Acid', 0.05),
  ('Lecigel', 0.8), ('GTCC', 3.0), ('Jojoba Oil', 2.0), ('Cetiol CC', 3.0),
  ('Squalane', 2.0), ('Shea Butter', 1.0), ('Tallow', 2.5), ('Bodyflux Ceramide NP', 0.05),
  ('Cetearyl Alcohol', 2.0), ('Olivem 1000', 4.0), ('Tetrahexyldecyl Ascorbate', 2.0),
  ('Kakadu Plum Extract', 1.0), ('Bakuchiol', 1.0), ('Alpha-Bisabolol', 0.1),
  ('Dermofeel Toco 70', 0.1), ('Microcare DB', 1.0)
) AS v(ing_name, pct) ON i.name = v.ing_name;

-- Also seed standalone formulation references for the other recipes
-- (Baby Butter, Serum, Body Oil, Conditioner, Cleanser, Liquid Soap, Liquid Lotion, Summer Balm)
-- These don't have SHOP SKUs yet but are useful for the formulation viewer

INSERT INTO product_ingredients (product_sku, product_name, ingredient_id, percentage)
SELECT 'baby-butter', 'Baby Butter', id, v.pct FROM ingredients i
JOIN (VALUES
  ('Water', 58.2), ('Aloe Vera Powder', 0.2), ('Glycerine', 6.0), ('Xanthan', 0.4),
  ('Emulsifying Wax', 5.5), ('Cetyl Alcohol', 4.0), ('Beeswax', 2.0), ('Almond Oil', 5.0),
  ('Jojoba Oil', 2.0), ('Argan Oil', 1.0), ('GTCC', 5.0), ('Olive Squalane', 1.0),
  ('Tallow', 7.0), ('Spectrastat', 2.0), ('Tocopherol', 0.5), ('Chamomile Flower Oil', 0.2)
) AS v(ing_name, pct) ON i.name = v.ing_name;

INSERT INTO product_ingredients (product_sku, product_name, ingredient_id, percentage)
SELECT 'serum', 'Serum', id, v.pct FROM ingredients i
JOIN (VALUES
  ('Water', 87.6), ('Aloe Vera Powder', 0.1), ('D-Panthenol', 0.5),
  ('Sodium Ascorbyl Phosphate', 1.0), ('Vitamin C', 1.0), ('Glycerine', 6.0),
  ('Hyaluronic Acid', 1.0), ('Bisabolol', 0.3), ('Olive Squalane', 0.1),
  ('Tallow', 0.2), ('Microcare DB', 1.0), ('Tocopherol', 0.1),
  ('Licorice Extract', 0.5), ('Brazilian Orange Essential Oil', 0.1), ('Sodium Citrate', 0.5)
) AS v(ing_name, pct) ON i.name = v.ing_name;

INSERT INTO product_ingredients (product_sku, product_name, ingredient_id, percentage)
SELECT 'body-oil', 'Body Oil', id, v.pct FROM ingredients i
JOIN (VALUES
  ('GTCC', 58.4), ('Jojoba Oil', 16.3), ('Almond Oil', 10.0), ('Sunflower Oil', 8.0),
  ('Argan Oil', 5.0), ('Olive Squalane', 1.0), ('Tallow', 0.5), ('Vitamin E', 0.5),
  ('Lavender', 0.3)
) AS v(ing_name, pct) ON i.name = v.ing_name;

INSERT INTO product_ingredients (product_sku, product_name, ingredient_id, percentage)
SELECT 'conditioner', 'Conditioner', id, v.pct FROM ingredients i
JOIN (VALUES
  ('Water', 68.6), ('Aloe Vera Powder', 0.1), ('Glycerine', 4.0), ('Xanthan', 0.5),
  ('Emulsifying Wax', 3.0), ('Cetearyl Alcohol', 4.0), ('Cetyl Alcohol', 2.5),
  ('Almond Oil', 2.0), ('Coconut Oil', 1.0), ('Tallow', 12.0),
  ('Spectrastat G2', 2.0), ('Tocopherol', 0.1), ('Rose Geranium', 0.2)
) AS v(ing_name, pct) ON i.name = v.ing_name;

INSERT INTO product_ingredients (product_sku, product_name, ingredient_id, percentage)
SELECT 'cleanser', 'Cleanser', id, v.pct FROM ingredients i
JOIN (VALUES
  ('Water', 58.45), ('Plantacare 1200', 17.0), ('Stepanol', 8.0), ('Glycerine', 5.0),
  ('Aloe Vera Powder', 0.05), ('Tallow', 5.0), ('Spectrastat', 2.0),
  ('Rose Geranium', 0.2), ('Citric Acid', 0.3)
) AS v(ing_name, pct) ON i.name = v.ing_name;

INSERT INTO product_ingredients (product_sku, product_name, ingredient_id, percentage)
SELECT 'liquid-soap', 'Liquid Soap', id, v.pct FROM ingredients i
JOIN (VALUES
  ('Water', 62.45), ('Aloe Vera Powder', 0.05), ('Sodium Cocoyl', 4.0), ('Glycerine', 3.0),
  ('Xanthan', 0.2), ('Emulsifying Wax Olivem', 2.7), ('Glyceryl', 2.0), ('Tallow', 11.0),
  ('Spectrastat G2', 2.0), ('Tocopherol', 0.5), ('Plantacare 1200', 12.0), ('Rose Geranium', 0.1)
) AS v(ing_name, pct) ON i.name = v.ing_name;

INSERT INTO product_ingredients (product_sku, product_name, ingredient_id, percentage)
SELECT 'liquid-lotion', 'Liquid Lotion', id, v.pct FROM ingredients i
JOIN (VALUES
  ('Water', 69.85), ('Aloe Vera Powder', 0.05), ('Glycerine', 5.0), ('Xanthan', 0.2),
  ('Emulsifying Wax', 2.5), ('Glyceryl', 2.5), ('Castor Oil', 2.0), ('Tallow', 15.0),
  ('Spectrastat G2', 2.0), ('Bisabolol', 0.3), ('Tocopherol', 0.5), ('Rose Geranium', 0.1)
) AS v(ing_name, pct) ON i.name = v.ing_name;

INSERT INTO product_ingredients (product_sku, product_name, ingredient_id, percentage)
SELECT 'summer-balm', 'Summer Balm', id, v.pct FROM ingredients i
JOIN (VALUES
  ('Tallow', 35.8), ('Jojoba Oil', 9.0), ('Olive Squalane', 13.73),
  ('Beeswax', 6.27), ('Zinclear', 35.0), ('Rose Geranium', 0.2)
) AS v(ing_name, pct) ON i.name = v.ing_name;

INSERT INTO product_ingredients (product_sku, product_name, ingredient_id, percentage)
SELECT 'sunset-glow', 'Sunset Glow', id, v.pct FROM ingredients i
JOIN (VALUES
  ('Tallow', 96.0), ('Jojoba Oil', 2.0), ('Sea Buckthorn', 0.8),
  ('Ylang Ylang', 0.2), ('Manuka Honey', 1.0)
) AS v(ing_name, pct) ON i.name = v.ing_name;

INSERT INTO product_ingredients (product_sku, product_name, ingredient_id, percentage)
SELECT 'midnight-mousse', 'Midnight Mousse', id, v.pct FROM ingredients i
JOIN (VALUES
  ('Tallow', 95.5), ('Jojoba Oil', 2.0), ('Chocolate Treat', 0.2),
  ('Brazilian Orange Essential Oil', 0.05), ('Manuka Honey', 2.0)
) AS v(ing_name, pct) ON i.name = v.ing_name;

INSERT INTO product_ingredients (product_sku, product_name, ingredient_id, percentage)
SELECT 'natural', 'Natural', id, v.pct FROM ingredients i
JOIN (VALUES
  ('Tallow', 98.62), ('Jojoba Oil', 1.38)
) AS v(ing_name, pct) ON i.name = v.ing_name;

INSERT INTO product_ingredients (product_sku, product_name, ingredient_id, percentage)
SELECT 'lavender', 'Lavender', id, v.pct FROM ingredients i
JOIN (VALUES
  ('Tallow', 97.62), ('Jojoba Oil', 1.38), ('Lavender', 1.0)
) AS v(ing_name, pct) ON i.name = v.ing_name;

INSERT INTO product_ingredients (product_sku, product_name, ingredient_id, percentage)
SELECT 'blue-tansy', 'Blue Tansy', id, v.pct FROM ingredients i
JOIN (VALUES
  ('Tallow', 97.56), ('Jojoba Oil', 1.38), ('Manuka Honey', 1.0), ('Blue Tansy', 0.067)
) AS v(ing_name, pct) ON i.name = v.ing_name;
