-- ALTIV ADMIN - segurança de ativações e auditoria de tentativas

create table if not exists public.activation_attempts (
  id bigint generated always as identity primary key,
  device_fingerprint_hash text not null,
  source_hash text,
  license_key_last4 text,
  success boolean not null default false,
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists activation_attempts_device_created_idx
  on public.activation_attempts(device_fingerprint_hash, created_at desc);

create index if not exists activation_attempts_source_created_idx
  on public.activation_attempts(source_hash, created_at desc)
  where source_hash is not null;

create index if not exists activation_attempts_failed_created_idx
  on public.activation_attempts(created_at desc)
  where success = false;

alter table public.activation_attempts enable row level security;

drop policy if exists "admins read activation attempts"
  on public.activation_attempts;

create policy "admins read activation attempts"
on public.activation_attempts for select
to authenticated
using (private.is_altiv_admin());

revoke insert, update, delete on public.activation_attempts
  from anon, authenticated;
