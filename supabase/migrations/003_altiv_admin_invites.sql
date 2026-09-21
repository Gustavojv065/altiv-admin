-- ALTIV ADMIN - convite seguro do primeiro administrador

create table if not exists private.admin_invites (
  id uuid primary key default gen_random_uuid(),
  email_hash text not null unique,
  role text not null default 'admin'
    check (role in ('owner','admin','support')),
  is_active boolean not null default true,
  expires_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

revoke all on table private.admin_invites
  from public, anon, authenticated;

create or replace function private.handle_altiv_admin_signup()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  invite_record private.admin_invites%rowtype;
  user_email_hash text;
begin
  if new.email is null then
    return new;
  end if;

  user_email_hash :=
    encode(
      digest(lower(trim(new.email)), 'sha256'),
      'hex'
    );

  select *
    into invite_record
  from private.admin_invites
  where email_hash = user_email_hash
    and is_active = true
    and accepted_at is null
    and (expires_at is null or expires_at > now())
  limit 1;

  if found then
    insert into public.admin_profiles (
      user_id,
      full_name,
      role,
      is_active
    )
    values (
      new.id,
      coalesce(
        new.raw_user_meta_data ->> 'full_name',
        split_part(new.email, '@', 1)
      ),
      invite_record.role,
      true
    )
    on conflict (user_id) do update
      set role = excluded.role,
          is_active = true,
          updated_at = now();

    update private.admin_invites
       set accepted_at = now()
     where id = invite_record.id;
  end if;

  return new;
end;
$$;

revoke all on function private.handle_altiv_admin_signup()
  from public, anon, authenticated;

drop trigger if exists on_altiv_admin_signup
  on auth.users;

create trigger on_altiv_admin_signup
after insert on auth.users
for each row
execute function private.handle_altiv_admin_signup();
