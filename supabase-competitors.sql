-- Competitor Tracking tables
-- Run this in Supabase SQL Editor

-- 1. Competitors list
create table if not exists competitors (
  id serial primary key,
  name text not null,
  url text not null,
  created_at timestamptz default now(),
  active boolean default true
);

alter table competitors enable row level security;
create policy "service_full_access" on competitors for all using (true) with check (true);

-- 2. Snapshots (latest stored per competitor, used for diffing)
create table if not exists competitor_snapshots (
  id serial primary key,
  competitor_id int references competitors(id) on delete cascade,
  checked_at timestamptz default now(),
  title text,
  meta_description text,
  product_count int,
  sitemap_pages text[],
  content_hash text,
  hero_text text,
  price_snippets text,
  raw_text text
);

alter table competitor_snapshots enable row level security;
create policy "service_full_access" on competitor_snapshots for all using (true) with check (true);

create index idx_comp_snap_competitor on competitor_snapshots(competitor_id);
create index idx_comp_snap_checked on competitor_snapshots(checked_at desc);

-- 3. Change log (only populated when changes detected)
create table if not exists competitor_changes (
  id serial primary key,
  competitor_id int references competitors(id) on delete cascade,
  detected_at timestamptz default now(),
  change_type text not null,
  summary text not null,
  old_value text,
  new_value text
);

alter table competitor_changes enable row level security;
create policy "service_full_access" on competitor_changes for all using (true) with check (true);

create index idx_comp_changes_competitor on competitor_changes(competitor_id);
create index idx_comp_changes_detected on competitor_changes(detected_at desc);
