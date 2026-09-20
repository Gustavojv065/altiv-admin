-- ALTIV ADMIN - Fase 1
-- Base segura para administração comercial e licenciamento.

create extension if not exists pgcrypto;

create table if not exists public.admin_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'admin' check (role in ('owner','admin','support')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  duration_days integer,
  max_devices integer not null default 1 check (max_devices > 0),
  is_lifetime boolean not null default false,
  price_cents integer check (price_cents is null or price_cents >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plans_duration_check check (
    is_lifetime = true or (duration_days is not null and duration_days > 0)
  )
);

create table if not exists public.licenses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete set null,
  plan_id uuid references public.plans(id) on delete set null,
  license_key_hash text not null unique,
  license_key_last4 text not null,
  status text not null default 'active' check (status in ('active','blocked','cancelled')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  max_devices integer not null default 1 check (max_devices > 0),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  device_fingerprint_hash text not null,
  device_label text,
  app_version text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  is_active boolean not null default true,
  revoked_at timestamptz,
  unique (license_id, device_fingerprint_hash)
);

create table if not exists public.license_events (
  id bigint generated always as identity primary key,
  license_id uuid references public.licenses(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  admin_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists licenses_customer_id_idx on public.licenses(customer_id);
create index if not exists licenses_status_idx on public.licenses(status);
create index if not exists licenses_expires_at_idx on public.licenses(expires_at);
create index if not exists devices_license_id_idx on public.devices(license_id);
create index if not exists license_events_license_id_idx on public.license_events(license_id);
create index if not exists license_events_created_at_idx on public.license_events(created_at desc);

create or replace function public.is_altiv_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_profiles p
    where p.user_id = auth.uid()
      and p.is_active = true
      and p.role in ('owner','admin','support')
  );
$$;

revoke all on function public.is_altiv_admin() from public;
grant execute on function public.is_altiv_admin() to authenticated;

alter table public.admin_profiles enable row level security;
alter table public.customers enable row level security;
alter table public.plans enable row level security;
alter table public.licenses enable row level security;
alter table public.devices enable row level security;
alter table public.license_events enable row level security;

create policy "admins read own admin profile"
on public.admin_profiles for select
to authenticated
using (user_id = auth.uid() or public.is_altiv_admin());

create policy "admins manage customers"
on public.customers for all
to authenticated
using (public.is_altiv_admin())
with check (public.is_altiv_admin());

create policy "admins manage plans"
on public.plans for all
to authenticated
using (public.is_altiv_admin())
with check (public.is_altiv_admin());

create policy "admins manage licenses"
on public.licenses for all
to authenticated
using (public.is_altiv_admin())
with check (public.is_altiv_admin());

create policy "admins manage devices"
on public.devices for all
to authenticated
using (public.is_altiv_admin())
with check (public.is_altiv_admin());

create policy "admins manage license events"
on public.license_events for all
to authenticated
using (public.is_altiv_admin())
with check (public.is_altiv_admin());

insert into public.plans (name, duration_days, max_devices, is_lifetime)
values
  ('Teste 7 dias', 7, 1, false),
  ('Mensal 30 dias', 30, 1, false),
  ('Trimestral 90 dias', 90, 1, false),
  ('Anual 365 dias', 365, 1, false),
  ('Vitalícia', null, 1, true)
on conflict (name) do nothing;
