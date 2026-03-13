import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { isIP } from "node:net";
import { ApiError } from "@/lib/http";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
]);

const BLOCKED_IPV4_EXACT = new Set([
  "0.0.0.0",
  "127.0.0.1",
  "169.254.169.254",
]);

type Ipv4Range = {
  start: number;
  end: number;
};

const BLOCKED_IPV4_RANGES: Ipv4Range[] = [
  toIpv4Range("10.0.0.0", "10.255.255.255"),
  toIpv4Range("100.64.0.0", "100.127.255.255"),
  toIpv4Range("127.0.0.0", "127.255.255.255"),
  toIpv4Range("169.254.0.0", "169.254.255.255"),
  toIpv4Range("172.16.0.0", "172.31.255.255"),
  toIpv4Range("192.168.0.0", "192.168.255.255"),
  toIpv4Range("198.18.0.0", "198.19.255.255"),
];

function toIpv4Range(start: string, end: string): Ipv4Range {
  return {
    start: ipv4ToInteger(start),
    end: ipv4ToInteger(end),
  };
}

function ipv4ToInteger(ip: string): number {
  const parts = ip.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw new Error(`Invalid IPv4: ${ip}`);
  }

  return (((parts[0] ?? 0) << 24) | ((parts[1] ?? 0) << 16) | ((parts[2] ?? 0) << 8) | (parts[3] ?? 0)) >>> 0;
}

function isBlockedIpv4(ip: string): boolean {
  if (BLOCKED_IPV4_EXACT.has(ip)) {
    return true;
  }

  let numeric: number;
  try {
    numeric = ipv4ToInteger(ip);
  } catch {
    return true;
  }

  return BLOCKED_IPV4_RANGES.some((range) => numeric >= range.start && numeric <= range.end);
}

function isBlockedIpv6(rawIp: string): boolean {
  const ip = rawIp.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  if (ip === "::" || ip === "::1" || ip === "0:0:0:0:0:0:0:1") {
    return true;
  }

  if (ip.startsWith("::ffff:")) {
    const mapped = ip.slice("::ffff:".length);
    return isIP(mapped) === 4 ? isBlockedIpv4(mapped) : true;
  }

  if (ip.startsWith("fc") || ip.startsWith("fd")) {
    return true;
  }

  if (ip.startsWith("fe8") || ip.startsWith("fe9") || ip.startsWith("fea") || ip.startsWith("feb")) {
    return true;
  }

  if (ip.startsWith("ff")) {
    return true;
  }

  return false;
}

function assertPublicHostOrThrow(hostname: string): void {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!normalized) {
    throw new ApiError(400, "VALIDATION_ERROR", "The image link is missing a host name. Add a full URL and try again.");
  }

  if (BLOCKED_HOSTNAMES.has(normalized)) {
    throw new ApiError(400, "VALIDATION_ERROR", "This image host is not allowed. Use a public image URL and try again.");
  }

  const ipKind = isIP(normalized.replace(/^\[/, "").replace(/\]$/, ""));
  if (ipKind === 4 && isBlockedIpv4(normalized)) {
    throw new ApiError(400, "VALIDATION_ERROR", "This image target is not allowed. Use a public image URL and try again.");
  }
  if (ipKind === 6 && isBlockedIpv6(normalized)) {
    throw new ApiError(400, "VALIDATION_ERROR", "This image target is not allowed. Use a public image URL and try again.");
  }
}

export async function assertSafePublicHttpUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ApiError(400, "VALIDATION_ERROR", "This image link is not valid. Use a full URL and try again.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ApiError(400, "VALIDATION_ERROR", "Only HTTP or HTTPS image links are supported. Update the link and try again.");
  }

  if (parsed.username || parsed.password) {
    throw new ApiError(400, "VALIDATION_ERROR", "Image links with embedded credentials are not allowed. Remove the credentials and try again.");
  }

  assertPublicHostOrThrow(parsed.hostname);

  const hostIpKind = isIP(parsed.hostname.replace(/^\[/, "").replace(/\]$/, ""));
  if (hostIpKind !== 0) {
    return parsed;
  }

  let addresses: LookupAddress[];
  try {
    addresses = await lookup(parsed.hostname, { all: true, verbatim: true });
  } catch {
    throw new ApiError(400, "VALIDATION_ERROR", "We couldn't reach this image host. Check the URL and try again.");
  }

  if (addresses.length === 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "We couldn't reach this image host. Check the URL and try again.");
  }

  for (const address of addresses) {
    if (!address?.address) continue;

    if (address.family === 4 && isBlockedIpv4(address.address)) {
      throw new ApiError(400, "VALIDATION_ERROR", "This image target is not allowed. Use a public image URL and try again.");
    }

    if (address.family === 6 && isBlockedIpv6(address.address)) {
      throw new ApiError(400, "VALIDATION_ERROR", "This image target is not allowed. Use a public image URL and try again.");
    }
  }

  return parsed;
}
