ALTER TABLE public.tokens
  ADD COLUMN IF NOT EXISTS imported_from text,
  ADD COLUMN IF NOT EXISTS creator_ref text,
  ADD COLUMN IF NOT EXISTS sync_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS synced_block bigint,
  ADD COLUMN IF NOT EXISTS sync_target_block bigint,
  ADD COLUMN IF NOT EXISTS sync_continuation text,
  ADD COLUMN IF NOT EXISTS synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS sync_error text,
  ADD COLUMN IF NOT EXISTS total_supply numeric(78,0),
  ADD COLUMN IF NOT EXISTS holder_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS event_count integer NOT NULL DEFAULT 0;

CREATE TABLE public.chain_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id uuid NOT NULL REFERENCES public.tokens(id) ON DELETE CASCADE,
  tx_hash text NOT NULL,
  ordinal integer NOT NULL,
  block_number bigint NOT NULL,
  from_address text NOT NULL,
  to_address text NOT NULL,
  amount numeric(78,0) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (token_id, tx_hash, ordinal)
);
CREATE INDEX chain_events_token_block ON public.chain_events (token_id, block_number DESC);
GRANT SELECT ON public.chain_events TO authenticated;
GRANT ALL ON public.chain_events TO service_role;
ALTER TABLE public.chain_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read chain events" ON public.chain_events FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.token_holders (
  token_id uuid NOT NULL REFERENCES public.tokens(id) ON DELETE CASCADE,
  address text NOT NULL,
  balance numeric(78,0) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (token_id, address)
);
CREATE INDEX token_holders_balance ON public.token_holders (token_id, balance DESC);
GRANT SELECT ON public.token_holders TO authenticated;
GRANT ALL ON public.token_holders TO service_role;
ALTER TABLE public.token_holders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read token holders" ON public.token_holders FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.recompute_token_holders(_token uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE zero text := '0x' || repeat('0', 64);
BEGIN
  DELETE FROM public.token_holders WHERE token_id = _token;
  INSERT INTO public.token_holders (token_id, address, balance)
  SELECT _token, addr, sum(delta) FROM (
    SELECT to_address AS addr, amount AS delta FROM public.chain_events WHERE token_id = _token
    UNION ALL
    SELECT from_address, -amount FROM public.chain_events WHERE token_id = _token
  ) d WHERE addr <> zero GROUP BY addr HAVING sum(delta) > 0;
  UPDATE public.tokens SET
    holder_count = (SELECT count(*) FROM public.token_holders WHERE token_id = _token),
    total_supply = (SELECT coalesce(sum(balance), 0) FROM public.token_holders WHERE token_id = _token),
    event_count = (SELECT count(*) FROM public.chain_events WHERE token_id = _token)
  WHERE id = _token;
END $$;
REVOKE EXECUTE ON FUNCTION public.recompute_token_holders(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_token_holders(uuid) TO service_role;