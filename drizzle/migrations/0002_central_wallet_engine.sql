alter table public.wallets alter column email drop not null;
alter table public.wallets add column if not exists app_id uuid;
alter table public.wallets add column if not exists external_id text;
alter table public.wallets add column if not exists kind text not null default 'user';
alter table public.wallets add column if not exists label text;
alter table public.wallets add column if not exists key_version int not null default 1;
alter table public.wallets add column if not exists imported_from text;
create unique index if not exists wallets_app_network_external on public.wallets(app_id, network, external_id) where external_id is not null;

alter table public.registered_apps add column if not exists webhook_url text;
alter table public.registered_apps add column if not exists webhook_secret text;
alter table public.registered_apps add column if not exists rate_limit_per_min int not null default 60;
alter table public.registered_apps add column if not exists daily_mint_cap numeric;
alter table public.registered_apps add column if not exists daily_distribute_cap numeric;
alter table public.registered_apps add column if not exists mainnet_enabled boolean not null default false;

create table public.tokens (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null,
  network text not null default 'sepolia',
  address text,
  name text not null,
  symbol text not null,
  decimals int not null default 18,
  swappable boolean not null default false,
  is_test boolean not null default false,
  created_tx uuid,
  created_at timestamptz not null default now()
);
create unique index tokens_network_address on public.tokens(network, address) where address is not null;
grant select on public.tokens to authenticated; grant all on public.tokens to service_role;
alter table public.tokens enable row level security;
create policy "admin reads tokens" on public.tokens for select to authenticated using (public.has_role(auth.uid(),'admin'));

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null,
  network text not null default 'sepolia',
  address text,
  name text not null,
  symbol text not null,
  owner_wallet_id uuid not null,
  royalty_receiver text,
  royalty_bps int not null default 0,
  frozen boolean not null default false,
  is_test boolean not null default false,
  created_tx uuid,
  created_at timestamptz not null default now()
);
create unique index collections_network_address on public.collections(network, address) where address is not null;
grant select on public.collections to authenticated; grant all on public.collections to service_role;
alter table public.collections enable row level security;
create policy "admin reads collections" on public.collections for select to authenticated using (public.has_role(auth.uid(),'admin'));

create table public.nfts (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  token_id text not null,
  owner_address text not null,
  owner_wallet_id uuid,
  token_uri text,
  attributes jsonb not null default '[]',
  media jsonb not null default '[]',
  frozen boolean not null default false,
  minted_tx uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (collection_id, token_id)
);
grant select on public.nfts to authenticated; grant all on public.nfts to service_role;
alter table public.nfts enable row level security;
create policy "admin reads nfts" on public.nfts for select to authenticated using (public.has_role(auth.uid(),'admin'));

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null,
  network text not null default 'sepolia',
  type text not null,
  status text not null default 'queued',
  idempotency_key text not null,
  request jsonb not null default '{}',
  request_hash text not null,
  result jsonb,
  signer_key text not null,
  wallet_id uuid,
  tx_hash text,
  error_code text,
  error_message text,
  attempts int not null default 0,
  next_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  unique (app_id, idempotency_key)
);
create unique index transactions_one_inflight_per_signer on public.transactions(signer_key) where status in ('processing','submitted');
create index transactions_queue on public.transactions(status, created_at);
create index transactions_app on public.transactions(app_id, created_at desc);
grant select on public.transactions to authenticated; grant all on public.transactions to service_role;
alter table public.transactions enable row level security;
create policy "admin reads transactions" on public.transactions for select to authenticated using (public.has_role(auth.uid(),'admin'));

create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null,
  transaction_id uuid not null,
  event text not null,
  payload jsonb not null,
  attempts int not null default 0,
  status text not null default 'pending',
  last_error text,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index webhook_pending on public.webhook_deliveries(status, next_attempt_at);
grant select on public.webhook_deliveries to authenticated; grant all on public.webhook_deliveries to service_role;
alter table public.webhook_deliveries enable row level security;
create policy "admin reads webhooks" on public.webhook_deliveries for select to authenticated using (public.has_role(auth.uid(),'admin'));

-- Claim the oldest queued transaction for each signer that has nothing in flight.
create or replace function public.claim_transactions(_max int default 10)
returns setof public.transactions
language plpgsql
security definer
set search_path = public
as $$
declare r record; claimed public.transactions;
begin
  for r in
    select distinct on (t.signer_key) t.id
    from public.transactions t
    where t.status = 'queued'
      and (t.next_attempt_at is null or t.next_attempt_at <= now())
      and not exists (select 1 from public.transactions s where s.signer_key = t.signer_key and s.status in ('processing','submitted'))
    order by t.signer_key, t.created_at
    limit _max
  loop
    begin
      update public.transactions set status = 'processing', started_at = now(), attempts = attempts + 1
        where id = r.id and status = 'queued'
        returning * into claimed;
      if found then return next claimed; end if;
    exception when unique_violation then
      null;
    end;
  end loop;
end $$;
revoke all on function public.claim_transactions(int) from public, anon, authenticated;
grant execute on function public.claim_transactions(int) to service_role;