CREATE TABLE public.wallet_app_links (
  app_id uuid NOT NULL REFERENCES public.registered_apps(id),
  network text NOT NULL DEFAULT 'sepolia',
  external_id text NOT NULL,
  wallet_id uuid NOT NULL REFERENCES public.wallets(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, network, external_id)
);
CREATE INDEX wallet_app_links_wallet ON public.wallet_app_links(wallet_id);
GRANT SELECT ON public.wallet_app_links TO authenticated;
GRANT ALL ON public.wallet_app_links TO service_role;
ALTER TABLE public.wallet_app_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin reads wallet links" ON public.wallet_app_links FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));