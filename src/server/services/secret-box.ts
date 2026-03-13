import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getEnv } from "@/lib/env";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

function resolveEncryptionKey(): Buffer {
  const keyValue = getEnv().APP_ENCRYPTION_KEY;

  if (!keyValue) {
    throw new Error("APP_ENCRYPTION_KEY is required for encrypted Instagram profile credentials.");
  }

  if (/^[0-9a-f]{64}$/i.test(keyValue)) {
    return Buffer.from(keyValue, "hex");
  }

  try {
    const decoded = Buffer.from(keyValue, "base64");
    if (decoded.length === 32) {
      return decoded;
    }
  } catch {
    // Fall through to hashed string handling.
  }

  return createHash("sha256").update(keyValue).digest();
}

export function encryptSecret(value: string): string {
  const key = resolveEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(payload: string): string {
  const key = resolveEncryptionKey();
  const [ivRaw, tagRaw, encryptedRaw] = payload.split(".");

  if (!ivRaw || !tagRaw || !encryptedRaw) {
    throw new Error("Encrypted secret payload is malformed.");
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64url")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

export function maskIdentifier(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 4) return "****";
  return `${"*".repeat(Math.max(4, value.length - 4))}${value.slice(-4)}`;
}
