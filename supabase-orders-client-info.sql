-- Add client info columns to orders table
-- Run this in Supabase SQL Editor

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS client_browser text DEFAULT '',
  ADD COLUMN IF NOT EXISTS client_device text DEFAULT '',
  ADD COLUMN IF NOT EXISTS client_os text DEFAULT '',
  ADD COLUMN IF NOT EXISTS client_screen integer DEFAULT 0;
