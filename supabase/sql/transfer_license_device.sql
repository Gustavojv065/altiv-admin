-- Executar no projeto ALTIV ADMIN antes de publicar a nova license-access.
-- Chamada permitida somente à service_role, dentro da Edge Function.
create or replace function public.transfer_license_device(
  p_license_id uuid,
  p_fingerprint_hash text,
  p_token_hash text,
  p_device_label text,
  p_app_version text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_license public.licenses%rowtype;
  v_existing uuid;
  v_replaced integer;
  v_now timestamptz := clock_timestamp();
begin
  -- Serializa ativações simultâneas da mesma licença.
  select * into v_license from public.licenses
  where id = p_license_id for update;
  if not found or v_license.status not in ('active', 'trial')
     or (v_license.expires_at is not null and v_license.expires_at <= v_now) then
    raise exception 'Licença indisponível para ativação.';
  end if;
  if length(p_fingerprint_hash) <> 64 or length(p_token_hash) <> 64 then
    raise exception 'Identificador de dispositivo inválido.';
  end if;

  select id into v_existing from public.devices
  where license_id = p_license_id and device_fingerprint_hash = p_fingerprint_hash;

  select count(*) into v_replaced from public.devices
  where license_id = p_license_id and is_active and device_fingerprint_hash <> p_fingerprint_hash;

  update public.devices set
    is_active = false,
    revoked_at = v_now,
    activation_token_hash = null,
    token_created_at = null
  where license_id = p_license_id and is_active;

  insert into public.devices (
    license_id, device_fingerprint_hash, device_label, app_version,
    first_seen_at, last_seen_at, is_active, revoked_at,
    activation_token_hash, token_created_at
  ) values (
    p_license_id, p_fingerprint_hash, p_device_label, p_app_version,
    v_now, v_now, true, null, p_token_hash, v_now
  ) on conflict (license_id, device_fingerprint_hash)
  do update set
    device_label = excluded.device_label,
    app_version = excluded.app_version,
    last_seen_at = excluded.last_seen_at,
    is_active = true,
    revoked_at = null,
    activation_token_hash = excluded.activation_token_hash,
    token_created_at = excluded.token_created_at;

  return jsonb_build_object('replacedCount', v_replaced, 'reactivated', v_existing is not null);
end;
$$;

revoke all on function public.transfer_license_device(uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.transfer_license_device(uuid,text,text,text,text) to service_role;
