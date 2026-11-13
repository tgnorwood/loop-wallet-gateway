// Turns a recorded transaction into a plain sentence ("Sam sent 50 LIBBALL to ana@example.com") from what the
// request stored. Pure: lookups for token, collection and wallet names are passed in, so it can be tested.
import { fromBaseUnits } from "./chain-rules";

export type Lookup = {
  token: (address: string) => { symbol: string; name: string } | undefined;
  collection: (address: string) => { symbol: string; name: string } | undefined;
  /** Label for a wallet by id or by address (email, "user <id>", or nothing if unknown). */
  wallet: (idOrAddress: string) => string | undefined;
};

export type Described = { summary: string; amount: string | null; token: string | null; toToken: string | null; from: string | null; to: string | null };
type Row = { type: string; wallet_id?: string | null; request?: Record<string, unknown> | null; result?: Record<string, unknown> | null };

export const shortAddr = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

/** 18-decimal base units to "1,234.5". */
export function fmtAmount(raw: string | undefined | null) {
  if (!raw) return null;
  try {
    const s = fromBaseUnits(raw);
    const [whole, frac] = s.split(".");
    return whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (frac ? `.${frac}` : "");
  } catch { return null; }
}

export function describeTx(t: Row, L: Lookup): Described {
  const q = (t.request ?? {}) as Record<string, unknown>;
  const r = ((q["_r"] ?? {}) as Record<string, string | undefined>);
  const res = (t.result ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : undefined);

  const tok = (addr?: string) => (addr ? (L.token(addr)?.symbol ?? shortAddr(addr)) : null);
  const col = (addr?: string) => (addr ? (L.collection(addr)?.name ?? shortAddr(addr)) : "a collection");
  const who = (idOrAddr?: string | null) => (idOrAddr ? (L.wallet(idOrAddr) ?? (idOrAddr.startsWith("0x") ? shortAddr(idOrAddr) : "a wallet")) : null);
  const from = t.wallet_id ? who(t.wallet_id) : null;
  const to = r["toWalletId"] ? who(r["toWalletId"]) : r["to"] ? who(r["to"]) : null;
  const amount = fmtAmount(r["amountRaw"]);
  const sym = tok(r["token"]);
  const base = { amount, token: sym, toToken: null as string | null, from, to };
  const done = (summary: string, extra: Partial<Described> = {}): Described => ({ ...base, ...extra, summary });
  const nftId = str(q["tokenId"]) ?? str(r["tokenId"]) ?? str(res["tokenId"]);
  const nft = nftId ? `NFT #${nftId}` : "an NFT";

  switch (t.type) {
    case "token.create": return done(`Created token ${str(q["name"]) ?? r["name"] ?? ""} (${str(q["symbol"]) ?? r["symbol"] ?? ""}) with ${amount ?? "?"} supply`, { token: str(q["symbol"]) ?? r["symbol"] ?? null });
    case "token.mint": return done(`Minted ${amount ?? "?"} ${sym ?? "tokens"}`);
    case "token.distribute": return done(`Gave ${amount ?? "?"} ${sym ?? "tokens"} to ${to ?? "someone"}`);
    case "transfer": return done(`${from ?? "A wallet"} sent ${amount ?? "?"} ${sym ?? "tokens"} to ${to ?? "someone"}`);
    case "return": return done(`${from ?? "A wallet"} returned ${amount ?? "?"} ${sym ?? "tokens"} to the factory`);
    case "swap": {
      const a = tok(r["fromToken"]); const b = tok(r["toToken"]);
      return done(`${from ?? "A wallet"} swapped ${amount ?? "?"} ${a ?? "tokens"} for ${b ?? "another token"}`, { token: a, toToken: b });
    }
    case "collection.create": return done(`Created collection ${str(q["name"]) ?? r["name"] ?? ""} (${str(q["symbol"]) ?? r["symbol"] ?? ""})${Number(r["royaltyBps"]) > 0 ? ` with ${Number(r["royaltyBps"]) / 100}% royalties` : ""}`, { token: null });
    case "collection.royalty": return done(`Set ${Number(r["bps"]) / 100}% royalties on ${col(r["collection"])} to ${who(r["receiver"]) ?? "an address"}`);
    case "collection.freeze": return done(`Froze all metadata in ${col(r["collection"])}`);
    case "collection.minter.add": return done(`Allowed ${who(r["minter"]) ?? "an address"} to mint in ${col(r["collection"])}`);
    case "collection.minter.remove": return done(`Removed ${who(r["minter"]) ?? "an address"} as a minter in ${col(r["collection"])}`);
    case "nft.mint": return done(`Minted ${nft} in ${col(r["collection"])} to ${to ?? "someone"}`, { token: null });
    case "nft.update": return done(`Updated the details of ${nft} in ${col(r["collection"])}`, { token: null });
    case "nft.freeze": return done(`Froze ${nft} in ${col(r["collection"])}`, { token: null });
    case "nft.transfer": return done(`${from ?? "A wallet"} sent ${nft} (${col(r["collection"])}) to ${to ?? "someone"}`, { token: null });
    default: return done(t.type);
  }
}
