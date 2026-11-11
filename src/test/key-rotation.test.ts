import { describe, expect, it } from "vitest";
import { keyId, openWith, sealWith, encryptSecret } from "@/lib/wallet/crypto";

const OLD = "old-secret-" + "a".repeat(40);
const NEW = "new-secret-" + "b".repeat(40);

describe("wallet key rotation", () => {
  it("seals with the current key and opens it again", async () => {
    const blob = await sealWith("0xdeadbeef", { current: OLD });
    expect(blob.startsWith(`v2:${await keyId(OLD)}:`)).toBe(true);
    expect(await openWith(blob, { current: OLD })).toBe("0xdeadbeef");
  });
  it("seals new data with the NEXT key when one is set, and either key can open old data", async () => {
    const before = await sealWith("0x01", { current: OLD });
    const after = await sealWith("0x01", { current: OLD, next: NEW });
    expect(after.startsWith(`v2:${await keyId(NEW)}:`)).toBe(true);
    expect(await openWith(before, { current: OLD, next: NEW })).toBe("0x01");
    expect(await openWith(after, { current: OLD, next: NEW })).toBe("0x01");
  });
  it("after promoting NEXT to current, rotated data still opens and the old key is no longer needed", async () => {
    const rotated = await sealWith("0x02", { current: OLD, next: NEW });
    expect(await openWith(rotated, { current: NEW })).toBe("0x02");
    await expect(openWith(rotated, { current: OLD })).rejects.toThrow(/not configured/);
  });
  it("still opens wallets stored in the original v1 format", async () => {
    const legacy = await encryptSecret("0x03", OLD);
    expect(legacy.startsWith("v1:")).toBe(true);
    expect(await openWith(legacy, { current: OLD })).toBe("0x03");
    expect(await openWith(legacy, { current: NEW, next: OLD })).toBe("0x03");
    await expect(openWith(legacy, { current: NEW })).rejects.toThrow();
  });
  it("refuses garbage and tampered data", async () => {
    await expect(openWith("nonsense", { current: OLD })).rejects.toThrow();
    const blob = await sealWith("0x04", { current: OLD });
    const parts = blob.split(":");
    parts[3] = parts[3]!.slice(0, -4) + "AAAA";
    await expect(openWith(parts.join(":"), { current: OLD })).rejects.toThrow();
  });
});
