-- 1. Atomic rate limiter (used by the API and by every code check). Without it the app falls back to a slower
--    compare-and-set loop that can give spurious 429s under a big burst.
create or replace function public.rate_limit_hit(_key text, _max int, _window_ms int)
returns table(allowed boolean, retry_after int)
language plpgsql security definer set search_path = public as $$
declare r public.rate_limits; win interval := make_interval(secs => (_window_ms / 1000.0)::double precision);
begin
  insert into public.rate_limits as rl (key, count, window_start) values (_key, 1, now())
  on conflict (key) do update set
    count = case when rl.window_start < now() - win then 1 else rl.count + 1 end,
    window_start = case when rl.window_start < now() - win then now() else rl.window_start end
  returning * into r;
  return query select r.count <= _max, greatest(1, ceil(extract(epoch from (r.window_start + win - now())))::int);
end $$;
revoke all on function public.rate_limit_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;

-- 2. Signed-in users (and admins) must not be able to read the encrypted wallet keys through the public API.
--    The server uses the service role, which is unaffected.
revoke select on public.wallets from authenticated;
grant select (id, email, user_id, address, public_key, class_hash, network, deployed, verified, verified_method,
              created_by_app, created_at, updated_at, app_id, external_id, kind, label, key_version, imported_from,
              email_verified_at, retired_at, retired_email)
  on public.wallets to authenticated;

-- 3. The same email may have one wallet PER NETWORK (needed before mainnet), not one wallet in total.
alter table public.wallets drop constraint if exists wallets_email_key;
create unique index if not exists wallets_network_email on public.wallets (network, email) where email is not null;