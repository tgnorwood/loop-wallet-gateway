import { afterEach, describe, expect, it, vi } from "vitest";
import { relay } from "@/lib/wallet/core/core";
import { publicTransactionStatus, submissionNeedsReconciliation } from "@/lib/wallet/chain-rules";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("relay submission safety", () => {
  it("requests wait:false and accepts a submitted hash without requiring confirmation", async () => {
    vi.stubEnv("RELAY_API_KEY", "test-only-key");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true, transactionHash: "0x123", status: "submitted", confirmed: false }));
    vi.stubGlobal("fetch", fetcher);
    const result = await relay("sepolia", "distribute", { amount: "1000000000000000000" }, "request-123");
    expect(JSON.parse(fetcher.mock.calls[0]?.[1].body).wait).toBe(false);
    expect(result["transactionHash"]).toBe("0x123");
  });
  it("a timeout is unknown, not a failed or retryable submission", async () => {
    vi.stubEnv("RELAY_API_KEY", "test-only-key");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("Timed out", "TimeoutError")));
    await expect(relay("sepolia", "distribute", {})).rejects.toMatchObject({ code: "SUBMISSION_UNKNOWN" });
    expect(submissionNeedsReconciliation("SUBMISSION_UNKNOWN", false)).toBe(true);
    expect(publicTransactionStatus("processing", "SUBMISSION_UNKNOWN")).toBe("unknown");
  });
  it("missing hash and receipt warnings cannot produce false confirmation", async () => {
    vi.stubEnv("RELAY_API_KEY", "test-only-key");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: true, confirmed: false, warning: "receipt unavailable" })));
    await expect(relay("sepolia", "distribute", {})).rejects.toMatchObject({ code: "SUBMISSION_UNKNOWN" });
    expect(publicTransactionStatus("submitted", "SUBMISSION_UNKNOWN")).toBe("unknown");
  });
  it("only definite errors may fail while network errors require reconciliation", () => {
    expect(submissionNeedsReconciliation(undefined, true)).toBe(true);
    expect(submissionNeedsReconciliation("REVERTED", false)).toBe(false);
  });
});