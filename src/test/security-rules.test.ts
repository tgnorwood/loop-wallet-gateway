import { describe, expect, it } from "vitest";
import {
  emailVerifiedEffective, isOperatorKey, isProofMethod, laneKey, laneOf, needsEmailProof, normalizeEmail, pickLane, queueFull, retryAfterForQueue, shouldEvictControllers,
} from "@/lib/wallet/rules";
import { publicTransactionStatus } from "@/lib/wallet/chain-rules";

describe("an app's 'email verified' claim", () => {
  it("is only believed for apps the admin trusts", () => {
    expect(emailVerifiedEffective(true, true)).toBe(true);
    expect(emailVerifiedEffective(true, false)).toBe(false);
    expect(emailVerifiedEffective(undefined, true)).toBe(false);
    expect(emailVerifiedEffective(false, true)).toBe(false);
  });
});

describe("removing earlier controllers once the real owner proves the email", () => {
  it("evicts when the email was never proven", () => expect(shouldEvictControllers({ email_verified_at: null, imported_from: null })).toBe(true));
  it("does nothing when the email was already proven", () => expect(shouldEvictControllers({ email_verified_at: "2026-01-01", imported_from: null })).toBe(false));
  it("never touches imported Loop Do wallets", () => {
    expect(shouldEvictControllers({ email_verified_at: null, imported_from: "loop-do" })).toBe(false);
    expect(shouldEvictControllers({ email_verified_at: null, imported_from: "loop-do-legacy" })).toBe(false);
  });
  it("only real proofs count", () => {
    for (const m of ["google", "email_code", "email_otp", "oauth"]) expect(isProofMethod(m)).toBe(true);
    for (const m of ["password", "admin_link", "other", ""]) expect(isProofMethod(m)).toBe(false);
  });
});

describe("existing account + new sign-up (the verification rule)", () => {
  const base = { walletExists: true, alreadyLinked: false, appTrustedGoogle: false };
  it("email+password must verify", () => expect(needsEmailProof({ ...base, method: "password" })).toBe(true));
  it("a new email needs nothing", () => expect(needsEmailProof({ ...base, walletExists: false, method: "password" })).toBe(false));
  it("a caller cannot make an unknown method skip the code, even on a trusted app", () => expect(needsEmailProof({ ...base, appTrustedGoogle: true, method: "other" })).toBe(true));
});

describe("email normalising (so case tricks can't dodge limits)", () => {
  it("lower-cases and trims", () => expect(normalizeEmail("  A@X.com ")).toBe("a@x.com"));
});

describe("operator lanes", () => {
  it("picks the least busy lane, lowest number on ties", () => {
    expect(pickLane([3, 1, 2])).toBe(1);
    expect(pickLane([2, 2, 2])).toBe(0);
    expect(pickLane([0])).toBe(0);
  });
  it("round-trips lane keys and ignores the old single key", () => {
    expect(laneKey("sepolia", 3)).toBe("operator:sepolia:3");
    expect(laneOf("operator:sepolia:3", "sepolia")).toBe(3);
    expect(laneOf("operator:sepolia", "sepolia")).toBe(null);
    expect(laneOf("operator:mainnet:2", "sepolia")).toBe(null);
    expect(isOperatorKey("operator:sepolia:0")).toBe(true);
    expect(isOperatorKey("wallet:abc")).toBe(false);
  });
});

describe("backpressure", () => {
  it("refuses an app once its cap is reached", () => {
    expect(queueFull(299, 300)).toBe(false);
    expect(queueFull(300, 300)).toBe(true);
  });
  it("Retry-After scales with depth and lanes, within bounds", () => {
    expect(retryAfterForQueue(0, 6)).toBe(5);
    expect(retryAfterForQueue(60, 6)).toBe(140);
    expect(retryAfterForQueue(100000, 6)).toBe(300);
  });
  it("a transaction being finalised looks submitted to apps", () => expect(publicTransactionStatus("finalizing", null)).toBe("submitted"));
});
