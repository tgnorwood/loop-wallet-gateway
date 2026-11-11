# Loop Wallet Gateway

The central custodial wallet system for the Loop apps (Loop Do, Loop Fans, PressChain). Apps call one API to
create wallets and to create/mint/send/swap tokens and NFTs on Starknet; gas is sponsored.

**Live**: https://wallet.loop.fans (also https://loop-wallet-gateway.lovable.app)

- Partner API: `POST /api/public/v1/wallets` and the rest of `/api/public/v1/*` (see `/docs` on the live site, and `docs/connecting-services.md`)
- Popup sign-in ("Log in with Loop Wallet") and the portal at `/`
- Admin: `/dashboard` (transactions, tokens, collections, apps, security) and `/admin`
- Token Factory relay + paymaster proxy (separate project, Cloudflare Pages): https://token-factory-console.pages.dev

Built with [Lovable](https://lovable.dev) (TanStack Start on Cloudflare Workers + Lovable Cloud/Supabase). Commits to `main` sync to Lovable;
see `AGENTS.md` for the rules that apply (the database schema is changed through Lovable, not by hand).

## Development

```sh
npm i
npm run dev      # local dev server
npm test         # unit tests
npx tsc --noEmit # type check
```

Secrets are never kept in the repo; they live in Lovable's Secrets. Names and purposes are in `docs/operations.md`.
