-- ============================================
-- Seed image inputs per product.
-- Adds a JSONB column on mktg_products keyed by slot:
--   { "front": { "path": "<storage_path>", "mime": "image/jpeg", "uploaded_at": "..." }, ... }
-- Slots: front, back, side1, side2, texture_pack, texture_skin, label
-- Binaries live in the existing mktg-uploads Storage bucket; this column
-- just records the slot → path mapping so generators can pull them later.
-- ============================================

ALTER TABLE mktg_products
  ADD COLUMN IF NOT EXISTS seed_images JSONB NOT NULL DEFAULT '{}'::jsonb;
