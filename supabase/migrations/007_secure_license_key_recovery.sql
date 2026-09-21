-- ALTIV ADMIN - recuperação segura de chaves de licença
alter table public.licenses
  add column if not exists key_secret_id uuid;

create index if not exists licenses_key_secret_id_idx
  on public.licenses(key_secret_id)
  where key_secret_id is not null;

create or replace function private.is_altiv_key_manager()
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
      and p.role in ('owner','admin')
  );
$$;

revoke all on function private.is_altiv_key_manager()
  from public, anon;
grant execute on function private.is_altiv_key_manager()
  to authenticated;

create or replace function public.store_license_recovery_key(
  p_license_id uuid,
  p_plaintext_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, private, vault, extensions
as $$
declare
  v_license public.licenses%rowtype;
  v_normalized text;
  v_hash text;
  v_secret_id uuid;
begin
  if not private.is_altiv_key_manager() then
    raise exception 'Acesso não autorizado';
  end if;

  v_normalized := upper(trim(p_plaintext_key));
  if v_normalized = '' then
    raise exception 'Chave inválida';
  end if;

  select *
    into v_license
  from public.licenses
  where id = p_license_id
  for update;

  if not found then
    raise exception 'Licença não encontrada';
  end if;

  v_hash := encode(
    extensions.digest(v_normalized, 'sha256'),
    'hex'
  );

  if v_hash <> v_license.license_key_hash then
    raise exception 'A chave informada não corresponde à licença';
  end if;

  if v_license.key_secret_id is not null then
    return v_license.key_secret_id;
  end if;

  v_secret_id := vault.create_secret(
    v_normalized,
    'altiv_license_' || p_license_id::text,
    'Chave recuperável da licença ALTIV ' || p_license_id::text
  );

  update public.licenses
  set key_secret_id = v_secret_id,
      updated_at = now()
  where id = p_license_id;

  return v_secret_id;
end;
$$;

revoke all on function public.store_license_recovery_key(uuid, text)
  from public, anon;
grant execute on function public.store_license_recovery_key(uuid, text)
  to authenticated;

create or replace function public.reveal_license_key(
  p_license_id uuid
)
returns text
language plpgsql
security definer
set search_path = public, private, vault
as $$
declare
  v_secret_id uuid;
  v_key text;
begin
  if not private.is_altiv_key_manager() then
    raise exception 'Acesso não autorizado';
  end if;

  select key_secret_id
    into v_secret_id
  from public.licenses
  where id = p_license_id;

  if not found then
    raise exception 'Licença não encontrada';
  end if;

  if v_secret_id is null then
    return null;
  end if;

  select decrypted_secret
    into v_key
  from vault.decrypted_secrets
  where id = v_secret_id;

  insert into public.license_events (
    license_id,
    customer_id,
    admin_user_id,
    event_type,
    metadata
  )
  select
    l.id,
    l.customer_id,
    auth.uid(),
    'license_key_revealed',
    jsonb_build_object('last4', l.license_key_last4)
  from public.licenses l
  where l.id = p_license_id;

  return v_key;
end;
$$;

revoke all on function public.reveal_license_key(uuid)
  from public, anon;
grant execute on function public.reveal_license_key(uuid)
  to authenticated;
