-- Communications System tables
-- Run this in Supabase SQL Editor

-- 1. Connected Gmail accounts (multi-account, dynamic)
create table if not exists gmail_accounts (
  id serial primary key,
  email_address text not null unique,
  display_name text,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  connected_by int references staff(id),
  connected_at timestamptz default now(),
  active boolean default true,
  oauth_state text,
  state_created timestamptz
);

alter table gmail_accounts enable row level security;
create policy "service_full_access" on gmail_accounts for all using (true) with check (true);

-- 2. All email messages (synced inbound + sent outbound)
create table if not exists email_messages (
  id bigserial primary key,
  gmail_id text,
  thread_id text,
  account_id int references gmail_accounts(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  from_address text not null,
  to_address text not null,
  cc text default '',
  bcc text default '',
  subject text default '',
  body_html text default '',
  body_text text default '',
  snippet text default '',
  date timestamptz not null,
  is_read boolean default false,
  customer_email text,
  staff_id int references staff(id),
  staff_name text,
  send_type text default 'direct' check (send_type in ('direct', 'bulk', 'automated')),
  created_at timestamptz default now(),
  unique(gmail_id, account_id)
);

alter table email_messages enable row level security;
create policy "service_full_access" on email_messages for all using (true) with check (true);

create index idx_email_customer on email_messages(customer_email);
create index idx_email_thread on email_messages(thread_id);
create index idx_email_date on email_messages(date desc);
create index idx_email_account on email_messages(account_id);
create index idx_email_direction on email_messages(direction);
