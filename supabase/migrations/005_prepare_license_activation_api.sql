-- ALTIV ADMIN - preparação da API de ativação do ALTIV CODE MOBILE

alter table public.devices
  add column if not exists activation_token_hash text,
  add column if not exists token_created_at timestamptz;

create unique index if not exists devices_activation_token_hash_uidx
  on public.devices(activation_token_hash)
  where activation_token_hash is not null;

create index if not exists devices_fingerprint_idx
  on public.devices(device_fingerprint_hash);

create index if not exists devices_active_license_idx
  on public.devices(license_id, is_active);

comment on column public.devices.activation_token_hash is
  'Hash SHA-256 do token opaco retornado ao aplicativo após ativação. O token em texto puro nunca é persistido.';

comment on column public.devices.token_created_at is
  'Data de criação/rotação do token de ativação do dispositivo.';
