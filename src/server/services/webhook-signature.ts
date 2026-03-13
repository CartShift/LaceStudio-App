import { createHmac, timingSafeEqual } from "node:crypto";

export function computeHmacSha256(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function verifyHmacSha256(body: string, secret: string, signature: string): boolean {
  const computed = computeHmacSha256(body, secret);
  const a = Buffer.from(computed, "utf8");
  const b = Buffer.from(signature, "utf8");

  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
