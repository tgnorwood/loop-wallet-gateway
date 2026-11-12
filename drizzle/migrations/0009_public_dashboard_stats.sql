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