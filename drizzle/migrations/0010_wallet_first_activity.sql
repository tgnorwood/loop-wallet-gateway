create or replace function public.wallet_first_activity()
returns table(wallet_id uuid, address text, first_block bigint)
language sql stable security definer set search_path = public as $$
  with ev as (
    select to_address a, block_number b from chain_events
    union all
    select from_address, block_number from chain_events
  )
  select w.id, w.address, min(ev.b)
  from wallets w join ev on ev.a = w.address
  where w.imported_from like 'loop-do%'
  group by w.id, w.address;
$$;

revoke all on function public.wallet_first_activity() from public, anon, authenticated;
grant execute on function public.wallet_first_activity() to service_role;