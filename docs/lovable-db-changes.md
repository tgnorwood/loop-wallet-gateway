# Database changes to ask Lovable to apply

The repo's rules say Lovable owns the schema, so these go in as one Lovable chat message. **The code already
shipped works without any of them** (each has a fallback), so they can be applied in any order, but the first
one matters most for bursts of traffic.

Paste this to Lovable:

> Please apply this database migration exactly as written, then confirm it ran without errors.

```sql
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
```

After it is applied, check in the dashboard that the Wallets count and sign-in still work. If anything that reads
wallets as a signed-in user breaks, tell me the error; the grant list above is every column except
`encrypted_private_key`.

## Second migration: public dashboard statistics (optional but recommended)

The public Dashboard works without this (it falls back to simple queries and hides the block-range chart). This
function makes it exact and fast. Paste to Lovable the same way:

```sql
create or replace function public.public_dashboard_stats() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'totals', jsonb_build_object(
      'wallets',           (select count(*) from wallets where retired_at is null),
      'accounts_deployed', (select count(*) from wallets where deployed and retired_at is null),
      'tokens',            (select count(*) from tokens where not is_test),
      'collections',       (select count(*) from collections where not is_test),
      'nfts',              (select count(*) from nfts),
      'transfers',         (select count(*) from chain_events),
      'holders',           (select count(distinct address) from token_holders where balance > 0),
      'sponsored_tx',      (select count(*) from transactions where status = 'confirmed')
                           + (select count(*) from audit_logs where action = 'executed_transaction'),
      'apps',              (select count(*) from registered_apps where revoked_at is null and not sandbox)
    ),
    'wallets_by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'n', n) order by d), '[]'::jsonb)
                       from (select created_at::date d, count(*) n from wallets group by 1) x),
    'tx_by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'type', t, 'n', n) order by d), '[]'::jsonb)
                  from (select created_at::date d, type t, count(*) n from transactions
                        where status = 'confirmed' and created_at > now() - interval '60 days' group by 1, 2) x),
    'transfers_by_bucket', (select coalesce(jsonb_agg(jsonb_build_object('bucket', b, 'n', n) order by b), '[]'::jsonb)
                            from (select (block_number / 10000) b, count(*) n from chain_events group by 1) x)
  );
$$;
revoke all on function public.public_dashboard_stats() from public, anon, authenticated;
grant execute on function public.public_dashboard_stats() to service_role;
```

## Other settings (not SQL)

- **Per-app API rate limit**: the default is 60 calls a minute per app, which a busy app will hit. Raise it for
  each app on Dashboard → Apps (rate limit per minute, up to 10 000), e.g. 600 for each of Loop Do, Loop Fans and
  PressChain.
- **Supabase Auth → "Confirm email"**: see the note in the pull request / chat about auto-confirm. The code is safe
  either way, but leaving confirmation ON for the wallet portal is the safer default.
- **Secrets** to add: `OPERATOR_LANES` (optional), `ALERT_EMAIL`, `PAYMASTER_API_KEY` (when the proxy is locked).
  To delete: `LOOP_WALLET_MIGRATION_KEY`, `WALLET_MASTER_KEY`, `LOOPDO_WALLET_DERIVATION_SECRET`.
