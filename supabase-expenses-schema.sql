-- Fixed/operational expenses not included in COGs
CREATE TABLE IF NOT EXISTS expenses (
  id serial PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'Other',
  amount numeric NOT NULL DEFAULT 0,
  frequency text NOT NULL DEFAULT 'monthly',  -- 'weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly', 'one-off'
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses (category);
