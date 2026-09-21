-- ALTIV ADMIN - hardening da Fase 1

create schema if not exists private;

create or replace function private.is_altiv_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_profiles p
    where p.user_id = (select auth.uid())
      and p.is_active = true
      and p.role in ('owner','admin','support')
  );
$$;

drop policy if exists "admins read own admin profile" on public.admin_profiles;
drop policy if exists "admins manage customers" on public.customers;
drop policy if exists "admins manage plans" on public.plans;
drop policy if exists "admins manage licenses" on public.licenses;
drop policy if exists "admins manage devices" on public.devices;
drop policy if exists "admins manage license events" on public.license_events;

revoke all on function public.is_altiv_admin() from public, anon, authenticated;
drop function if exists public.is_altiv_admin();

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
revoke all on function private.is_altiv_admin() from public, anon;
grant execute on function private.is_altiv_admin() to authenticated;

create policy "admins read own admin profile"
on public.admin_profiles for select
to authenticated
using (
  user_id = (select auth.uid())
  or private.is_altiv_admin()
);

create policy "admins manage customers"
on public.customers for all
to authenticated
using (private.is_altiv_admin())
with check (private.is_altiv_admin());

create policy "admins manage plans"
on public.plans for all
to authenticated
using (private.is_altiv_admin())
with check (private.is_altiv_admin());

create policy "admins manage licenses"
on public.licenses for all
to authenticated
using (private.is_altiv_admin())
with check (private.is_altiv_admin());

create policy "admins manage devices"
on public.devices for all
to authenticated
using (private.is_altiv_admin())
with check (private.is_altiv_admin());

create policy "admins manage license events"
on public.license_events for all
to authenticated
using (private.is_altiv_admin())
with check (private.is_altiv_admin());

create index if not exists licenses_plan_id_idx
  on public.licenses(plan_id);

create index if not exists licenses_created_by_idx
  on public.licenses(created_by);

create index if not exists license_events_customer_id_idx
  on public.license_events(customer_id);

create index if not exists license_events_admin_user_id_idx
  on public.license_events(admin_user_id);
