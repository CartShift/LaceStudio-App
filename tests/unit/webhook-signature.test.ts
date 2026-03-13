import { describe, expect, it } from "vitest";
import { computeHmacSha256, verifyHmacSha256 } from "@/server/services/webhook-signature";

describe("webhook-signature", () => {
  it("computes and verifies signatures", () => {
    const body = JSON.stringify({ hello: "world" });
    const secret = "super-secret";
    const signature = computeHmacSha256(body, secret);

    expect(verifyHmacSha256(body, secret, signature)).toBe(true);
    expect(verifyHmacSha256(body, secret, "invalid")).toBe(false);
  });
});
