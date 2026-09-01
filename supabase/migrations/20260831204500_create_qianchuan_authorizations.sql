create table if not exists public.qianchuan_authorizations (
  customer_key text primary key,
  advertiser_ids jsonb not null default '[]'::jsonb,
  access_token text not null,
  refresh_token text not null,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  authorized_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint qianchuan_customer_key_format check (customer_key ~ '^[A-Za-z0-9_-]{1,64}$'),
  constraint qianchuan_advertiser_ids_array check (jsonb_typeof(advertiser_ids) = 'array')
);

alter table public.qianchuan_authorizations enable row level security;

revoke all on table public.qianchuan_authorizations from anon, authenticated;
grant all on table public.qianchuan_authorizations to service_role;

comment on table public.qianchuan_authorizations is
  'Server-only storage for Qianchuan OAuth tokens. No anon or authenticated policies are defined.';
