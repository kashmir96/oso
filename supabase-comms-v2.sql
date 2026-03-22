-- Comms V2: Contacts, Prompts, Suppliers, Wholesalers, Supplier Orders
-- Run this in Supabase SQL Editor

-- 1. Contacts registry (links emails to supplier/wholesaler/customer type)
create table if not exists contacts (
  id serial primary key,
  email text unique not null,
  name text,
  company text,
  type text not null default 'customer',  -- 'supplier' | 'wholesaler' | 'customer'
  created_at timestamptz default now()
);
alter table contacts enable row level security;
create policy "service_full_access" on contacts for all using (true) with check (true);
create index if not exists idx_contacts_email on contacts(email);
create index if not exists idx_contacts_type on contacts(type);

-- 2. Email prompts (admin flags an email for a staff member to see)
create table if not exists email_prompts (
  id serial primary key,
  email_message_id bigint references email_messages(id) on delete cascade,
  thread_id text,
  from_staff_id int references staff(id),
  to_staff_id int references staff(id),
  note text default '',
  seen boolean default false,
  seen_at timestamptz,
  created_at timestamptz default now()
);
alter table email_prompts enable row level security;
create policy "service_full_access" on email_prompts for all using (true) with check (true);
create index if not exists idx_prompts_to_staff on email_prompts(to_staff_id, seen);
create index if not exists idx_prompts_thread on email_prompts(thread_id);

-- 3. Suppliers
create table if not exists suppliers (
  id serial primary key,
  name text not null,
  contact_name text default '',
  email text default '',
  phone text default '',
  website text default '',
  address text default '',
  payment_terms text default '',
  notes text default '',
  active boolean default true,
  created_at timestamptz default now()
);
alter table suppliers enable row level security;
create policy "service_full_access" on suppliers for all using (true) with check (true);

-- 4. Wholesalers
create table if not exists wholesalers (
  id serial primary key,
  name text not null,
  contact_name text default '',
  email text default '',
  phone text default '',
  website text default '',
  address text default '',
  payment_terms text default '',
  notes text default '',
  active boolean default true,
  created_at timestamptz default now()
);
alter table wholesalers enable row level security;
create policy "service_full_access" on wholesalers for all using (true) with check (true);

-- 5. Supplier orders (supply chain tracking)
create table if not exists supplier_orders (
  id serial primary key,
  supplier_id int references suppliers(id) on delete set null,
  requested_by int references staff(id),
  approved_by int references staff(id),
  items text not null default '[]',
  total decimal(10,2) default 0,
  status text default 'requested',
  tracking_info text default '',
  tracking_added_at timestamptz,
  order_date timestamptz,
  expected_date timestamptz,
  arrived_at timestamptz,
  error_notes text default '',
  notes text default '',
  created_at timestamptz default now()
);
alter table supplier_orders enable row level security;
create policy "service_full_access" on supplier_orders for all using (true) with check (true);
create index if not exists idx_supplier_orders_status on supplier_orders(status);
create index if not exists idx_supplier_orders_supplier on supplier_orders(supplier_id);

-- 6. Add order_flagged column to email_messages
alter table email_messages add column if not exists order_flagged boolean default false;
