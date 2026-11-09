create type public.app_role as enum ('admin','user');
create table public.user_roles (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade not null, role app_role not null, unique(user_id, role));
grant select on public.user_roles to authenticated; grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;
create or replace function public.has_role(_user_id uuid, _role app_role) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.user_roles where user_id=_user_id and role=_role) $$;
create policy "own roles" on public.user_roles for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));

-- first signed-up user becomes admin
create or replace function public.handle_first_admin() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if not exists (select 1 from public.user_roles where role='admin') then
    insert into public.user_roles(user_id, role) values (new.id,'admin');
  end if;
  return new;
end $$;
create trigger on_auth_user_first_admin after insert on auth.users for each row execute function public.handle_first_admin();

create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  user_id uuid unique,
  address text not null unique,
  public_key text not null,
  encrypted_private_key text not null,
  class_hash text not null,
  network text not null default 'sepolia',
  deployed boolean not null default false,
  verified boolean not null default false,
  verified_method text,
  created_by_app uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.wallets to authenticated; grant all on public.wallets to service_role;
alter table public.wallets enable row level security;
create policy "owner or admin reads wallet" on public.wallets for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));

create table public.registered_apps (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key_prefix text not null,
  key_hash text not null unique,
  allowed_origins text[] not null default '{}',
  popup_enabled boolean not null default true,
  api_enabled boolean not null default true,
  trusted_oauth boolean not null default false,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
grant select on public.registered_apps to authenticated; grant all on public.registered_apps to service_role;
alter table public.registered_apps enable row level security;
create policy "admin reads apps" on public.registered_apps for select to authenticated using (public.has_role(auth.uid(),'admin'));

create table public.wallet_sessions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  app_id uuid references public.registered_apps(id) on delete set null,
  token_hash text not null unique,
  ip text,
  user_agent text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
grant select on public.wallet_sessions to authenticated; grant all on public.wallet_sessions to service_role;
alter table public.wallet_sessions enable row level security;
create policy "owner or admin reads sessions" on public.wallet_sessions for select to authenticated using (exists(select 1 from public.wallets w where w.id = wallet_id and w.user_id = auth.uid()) or public.has_role(auth.uid(),'admin'));

create table public.wallet_verifications (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  app_id uuid references public.registered_apps(id) on delete set null,
  code_hash text not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  last_sent_at timestamptz not null default now(),
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
grant all on public.wallet_verifications to service_role;
alter table public.wallet_verifications enable row level security;

create table public.app_connections (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  app_id uuid not null references public.registered_apps(id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique(wallet_id, app_id)
);
grant select, update on public.app_connections to authenticated; grant all on public.app_connections to service_role;
alter table public.app_connections enable row level security;
create policy "owner reads connections" on public.app_connections for select to authenticated using (exists(select 1 from public.wallets w where w.id = wallet_id and w.user_id = auth.uid()) or public.has_role(auth.uid(),'admin'));

create table public.auth_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  app_id uuid not null references public.registered_apps(id) on delete cascade,
  code_challenge text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
grant all on public.auth_codes to service_role;
alter table public.auth_codes enable row level security;

create table public.app_assets (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  app_id uuid references public.registered_apps(id) on delete set null,
  kind text not null default 'points',
  name text not null,
  amount numeric not null default 0,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
grant select on public.app_assets to authenticated; grant all on public.app_assets to service_role;
alter table public.app_assets enable row level security;
create policy "owner reads assets" on public.app_assets for select to authenticated using (exists(select 1 from public.wallets w where w.id = wallet_id and w.user_id = auth.uid()) or public.has_role(auth.uid(),'admin'));

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid references public.wallets(id) on delete set null,
  app_id uuid references public.registered_apps(id) on delete set null,
  action text not null,
  method text,
  ip text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
grant select on public.audit_logs to authenticated; grant all on public.audit_logs to service_role;
alter table public.audit_logs enable row level security;
create policy "owner or admin reads audit" on public.audit_logs for select to authenticated using (public.has_role(auth.uid(),'admin') or exists(select 1 from public.wallets w where w.id = wallet_id and w.user_id = auth.uid()));
create index on public.audit_logs(created_at desc);
create index on public.wallet_sessions(wallet_id);

create table public.rate_limits (
  key text primary key,
  count int not null default 0,
  window_start timestamptz not null default now()
);
grant all on public.rate_limits to service_role;
alter table public.rate_limits enable row level security;