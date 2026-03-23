-- Master ingredient stocktake
CREATE TABLE IF NOT EXISTS ingredients (
  id serial PRIMARY KEY,
  name text UNIQUE NOT NULL,
  price_per_kg numeric DEFAULT 0,
  stock_kg numeric DEFAULT 0,
  supplier text DEFAULT '',
  reorder_point_kg numeric DEFAULT 0,
  category text DEFAULT 'Raw Material',
  notes text DEFAULT '',
  updated_at timestamptz DEFAULT now()
);

-- Product formulations: which ingredients go into which product
CREATE TABLE IF NOT EXISTS product_ingredients (
  id serial PRIMARY KEY,
  product_sku text NOT NULL,
  product_name text NOT NULL,
  ingredient_id int REFERENCES ingredients(id) ON DELETE CASCADE,
  percentage numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prod_ing_sku ON product_ingredients (product_sku);
CREATE INDEX IF NOT EXISTS idx_prod_ing_ingredient ON product_ingredients (ingredient_id);
