-- 4F and G Trading Limited — Database Schema
-- Run this in the Supabase SQL Editor for your new project.
-- All monetary balances (bank, safe, AR) are computed from these tables — never stored as static numbers.
-- Safe to re-run: uses IF NOT EXISTS and drops policies before recreating them.

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sku text,
  category text,
  supplier_country text check (supplier_country in ('China','Kenya','Other')),
  unit text not null default 'piece',
  cost_price numeric(14,2) not null default 0,
  sale_price numeric(14,2) not null default 0,
  qty_on_hand numeric(14,2) not null default 0,
  reorder_level numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);

-- Every inventory change is recorded here (stock-in, order fulfillment, manual adjustments)
create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products(id) on delete cascade,
  type text not null check (type in ('in','out','adjustment')),
  qty numeric(14,2) not null,
  order_id uuid,
  supplier_note text,
  unit_cost numeric(14,2),
  notes text,
  date date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  business_name text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id),
  date date not null default current_date,
  status text not null default 'pending' check (status in ('pending','fulfilled','partially_paid','paid')),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  product_id uuid references products(id),
  qty numeric(14,2) not null,
  unit_price numeric(14,2) not null
);

-- Customer payments received (cash/mobile money/bank transfer/check)
-- destination: where the physical money ended up (bank account or cash safe)
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id),
  order_id uuid references orders(id),
  amount numeric(14,2) not null,
  method text not null check (method in ('cash','mobile_money','bank_transfer','check')),
  destination text not null check (destination in ('bank','safe')),
  date date not null default current_date,
  notes text,
  created_at timestamptz not null default now()
);

-- Manual ledger entries: supplier payments, expenses, transfers between bank and safe
create table if not exists cash_transactions (
  id uuid primary key default gen_random_uuid(),
  account text not null check (account in ('bank','safe')),
  type text not null check (type in ('in','out')),
  amount numeric(14,2) not null,
  reason text not null,
  date date not null default current_date,
  created_at timestamptz not null default now()
);

-- Enable Row Level Security
alter table products enable row level security;
alter table stock_movements enable row level security;
alter table customers enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table payments enable row level security;
alter table cash_transactions enable row level security;

-- Drop policies if they exist, then recreate (safe to re-run)
drop policy if exists "auth read products" on products;
drop policy if exists "auth write products" on products;
create policy "auth read products" on products for select using (auth.role() = 'authenticated');
create policy "auth write products" on products for all using (auth.role() = 'authenticated');

drop policy if exists "auth read stock_movements" on stock_movements;
drop policy if exists "auth write stock_movements" on stock_movements;
create policy "auth read stock_movements" on stock_movements for select using (auth.role() = 'authenticated');
create policy "auth write stock_movements" on stock_movements for all using (auth.role() = 'authenticated');

drop policy if exists "auth read customers" on customers;
drop policy if exists "auth write customers" on customers;
create policy "auth read customers" on customers for select using (auth.role() = 'authenticated');
create policy "auth write customers" on customers for all using (auth.role() = 'authenticated');

drop policy if exists "auth read orders" on orders;
drop policy if exists "auth write orders" on orders;
create policy "auth read orders" on orders for select using (auth.role() = 'authenticated');
create policy "auth write orders" on orders for all using (auth.role() = 'authenticated');

drop policy if exists "auth read order_items" on order_items;
drop policy if exists "auth write order_items" on order_items;
create policy "auth read order_items" on order_items for select using (auth.role() = 'authenticated');
create policy "auth write order_items" on order_items for all using (auth.role() = 'authenticated');

drop policy if exists "auth read payments" on payments;
drop policy if exists "auth write payments" on payments;
create policy "auth read payments" on payments for select using (auth.role() = 'authenticated');
create policy "auth write payments" on payments for all using (auth.role() = 'authenticated');

drop policy if exists "auth read cash_transactions" on cash_transactions;
drop policy if exists "auth write cash_transactions" on cash_transactions;
create policy "auth read cash_transactions" on cash_transactions for select using (auth.role() = 'authenticated');
create policy "auth write cash_transactions" on cash_transactions for all using (auth.role() = 'authenticated');
