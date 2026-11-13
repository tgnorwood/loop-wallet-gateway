import { describe, expect, it } from "vitest";
import { publicTransactionStatus, reconcileDecision } from "@/lib/wallet/chain-rules";

const SINCE = "2026-11-13T01:28:11Z";
const after = "2026-11-13T02:00:00Z";
const before = "2026-11-12T01:14:00Z";

describe("recovering a transaction whose reply was lost", () => {
  it("follows the real transaction when the relay recorded its hash", () => {
    expect(reconcileDecision({ createdAt: after, attempts: 1, lookup: { found: true, status: "submitted", transactionHash: "0xabc", trackingSince: SINCE } })).toEqual({ action: "attach", txHash: "0xabc" });
  });
  it("marks it failed when the relay rejected it before sending", () => {
    expect(reconcileDecision({ createdAt: after, attempts: 1, lookup: { found: true, status: "failed", error: "u256_sub Overflow", definite: true, trackingSince: SINCE } })).toEqual({ action: "fail", message: "u256_sub Overflow" });
  });
  it("waits while the relay is still working on it (never resends)", () => {
    expect(reconcileDecision({ createdAt: after, attempts: 1, lookup: { found: true, status: "pending", transactionHash: null, trackingSince: SINCE } }).action).toBe("wait");
  });
  it("resends ONLY when the relay proves it never started a request made after logging began", () => {
    expect(reconcileDecision({ createdAt: after, attempts: 1, lookup: { found: false, trackingSince: SINCE } })).toEqual({ action: "requeue" });
  });
  it("never resends a request from before logging existed, because 'not found' proves nothing", () => {
    expect(reconcileDecision({ createdAt: before, attempts: 1, lookup: { found: false, trackingSince: SINCE } }).action).toBe("wait");
  });
  it("never resends when the relay did not say since when it keeps a log", () => {
    expect(reconcileDecision({ createdAt: after, attempts: 1, lookup: { found: false } }).action).toBe("wait");
  });
  it("stops resending after the retry limit", () => {
    expect(reconcileDecision({ createdAt: after, attempts: 3, lookup: { found: false, trackingSince: SINCE } }).action).toBe("wait");
  });
});

describe("how the unknown status looks to apps", () => {
  it("is reported as unknown, and no longer looks like it is still running", () => {
    expect(publicTransactionStatus("unknown", "SUBMISSION_UNKNOWN")).toBe("unknown");
    expect(publicTransactionStatus("processing", null)).toBe("queued");
  });
});
