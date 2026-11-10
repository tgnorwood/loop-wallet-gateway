import { describe, expect, it } from "vitest";
import { ec, stark, hash, CallData } from "starknet";
import { checkOtpUsable, isOriginAllowed, isSessionActive, resendWaitSeconds } from "@/lib/wallet/rules";
import { ACCOUNT_CLASS_HASH, LEGACY_REJECTED_CLASS_HASH, deriveAddress, generateWallet } from "@/lib/wallet/starknet";

const now = Date.parse("2026-11-09T12:00:00Z");
const iso = (ms: number) => new Date(now + ms).toISOString();

describe("email code rules", () => {
  it("code expires after 10 minutes", () => {
    expect(checkOtpUsable({ attempts: 0, expires_at: iso(1000), last_sent_at: iso(-1000), consumed_at: null }, now)).toBe("ok");
    expect(checkOtpUsable({ attempts: 0, expires_at: iso(-1), last_sent_at: iso(-600_000), consumed_at: null }, now)).toBe("expired");
  });
  it("locks after 5 wrong attempts", () => {
    expect(checkOtpUsable({ attempts: 4, expires_at: iso(60_000), last_sent_at: iso(0), consumed_at: null }, now)).toBe("ok");
    expect(checkOtpUsable({ attempts: 5, expires_at: iso(60_000), last_sent_at: iso(0), consumed_at: null }, now)).toBe("too_many_attempts");
  });
  it("resend allowed once per 60 seconds", () => {
    expect(resendWaitSeconds({ last_sent_at: iso(-30_000) }, now)).toBe(30);
    expect(resendWaitSeconds({ last_sent_at: iso(-60_000) }, now)).toBe(0);
  });
});

describe("sessions", () => {
  it("revoked token is rejected", () => {
    expect(isSessionActive({ expires_at: iso(60_000), revoked_at: iso(-1) }, now)).toBe(false);
    expect(isSessionActive({ expires_at: iso(60_000), revoked_at: null }, now)).toBe(true);
  });
  it("expired token is rejected", () => {
    expect(isSessionActive({ expires_at: iso(-1), revoked_at: null }, now)).toBe(false);
  });
});

describe("origins", () => {
  it("only exact registered websites are allowed", () => {
    expect(isOriginAllowed("https://loopfans.com", ["https://loopfans.com"])).toBe(true);
    expect(isOriginAllowed("https://evil-loopfans.com", ["https://loopfans.com"])).toBe(false);
    expect(isOriginAllowed(null, ["https://loopfans.com"])).toBe(false);
  });
});

describe("starknet account type", () => {
  it("new wallets use the SNIP-9 class, never the old OpenZeppelin one", () => {
    const w = generateWallet();
    expect(w.classHash).toBe("0x02b48623275dbaedb7f16ff5d0e7a4c722727d2a3e7c4477fa4650140834ba1f");
    expect(w.classHash).not.toBe(LEGACY_REJECTED_CLASS_HASH);
  });
  it("address = calldata [publicKey], salt publicKey, deployer 0", () => {
    const pk = stark.randomAddress();
    const pub = ec.starkCurve.getStarkKey(pk);
    const expected = hash.calculateContractAddressFromHash(pub, ACCOUNT_CLASS_HASH, CallData.compile([pub]), 0);
    expect(BigInt(deriveAddress(pub))).toBe(BigInt(expected));
  });
});

import { buildDeployment, buildTransaction } from "@/lib/wallet/paymaster";

describe("gas-free deploy payload", () => {
  const pub = "0x2ad51f18e78970e6678f776adf5d51861ef59c0202ba72fc7699097d501098e";
  const addr = deriveAddress(pub);
  it("uses the SNIP-9 class with salt and calldata = public key", () => {
    const d = buildDeployment(addr, pub, false)!;
    expect(BigInt(d.class_hash)).toBe(BigInt(ACCOUNT_CLASS_HASH));
    expect(BigInt(d.salt)).toBe(BigInt(pub));
    expect(d.calldata.map(BigInt)).toEqual([BigInt(pub)]);
  });
  it("deploys only while the account is not deployed", () => {
    expect(buildTransaction(addr, [], buildDeployment(addr, pub, false)).type).toBe("deploy_and_invoke");
    expect(buildDeployment(addr, pub, true)).toBeNull();
    expect(buildTransaction(addr, [], null).type).toBe("invoke");
  });
});

import { canAttachEmail, canRetireWallet } from "@/lib/wallet/rules";
describe("loop do email linking", () => {
  const w = { external_id: "u1", address: "0x042ae5", user_id: null, email: null };
  it("requires verified email", () => expect(canAttachEmail(w, { user_id: "u1", address: "0x42ae5", email_verified: false })).toBe("unverified"));
  it("requires matching user id and address", () => {
    expect(canAttachEmail(w, { user_id: "u2", address: "0x42ae5", email_verified: true })).toBe("mismatch");
    expect(canAttachEmail(w, { user_id: "u1", address: "0x99", email_verified: true })).toBe("mismatch");
    expect(canAttachEmail(w, { user_id: "u1", address: "0x42ae5", email_verified: true })).toBe("ok");
  });
  it("claims once", () => expect(canAttachEmail({ ...w, user_id: "x" }, { user_id: "u1", address: "0x42ae5", email_verified: true })).toBe("already_claimed"));
  it("never retires a wallet holding anything", () => {
    const hub = { imported_from: null, deployed: false };
    expect(canRetireWallet(hub, { tokens: 0, nfts: 0, strkRaw: 0n })).toBe(true);
    expect(canRetireWallet(hub, { tokens: 1, nfts: 0, strkRaw: 0n })).toBe(false);
    expect(canRetireWallet(hub, { tokens: 0, nfts: 0, strkRaw: 5n })).toBe(false);
    expect(canRetireWallet({ ...hub, deployed: true }, { tokens: 0, nfts: 0, strkRaw: 0n })).toBe(false);
    expect(canRetireWallet({ imported_from: "loop-do", deployed: false }, { tokens: 0, nfts: 0, strkRaw: 0n })).toBe(false);
  });
});

import { needsEmailProof } from "@/lib/wallet/rules";
describe("email proof before reusing a wallet", () => {
  const base = { walletExists: true, alreadyLinked: false, appTrustedGoogle: false };
  it("new email needs no code", () => expect(needsEmailProof({ ...base, walletExists: false, method: "password" })).toBe(false));
  it("already linked needs no code", () => expect(needsEmailProof({ ...base, alreadyLinked: true, method: "password" })).toBe(false));
  it("password sign-in needs a code", () => expect(needsEmailProof({ ...base, method: "password" })).toBe(true));
  it("hub Google skips", () => expect(needsEmailProof({ ...base, method: "google", isHubGoogle: true })).toBe(false));
  it("Google via untrusted app still needs a code", () => expect(needsEmailProof({ ...base, method: "google" })).toBe(true));
  it("Google via trusted app skips", () => expect(needsEmailProof({ ...base, method: "google", appTrustedGoogle: true })).toBe(false));
  it("unknown method needs a code even if trusted", () => expect(needsEmailProof({ ...base, method: "other", appTrustedGoogle: true })).toBe(true));
});
