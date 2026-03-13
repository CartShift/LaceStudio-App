function normalizeHostHeader(hostHeader: string | null | undefined): string {
  return (hostHeader ?? "").split(":")[0]?.trim().toLowerCase() ?? "";
}

export function isLocalhostHost(hostHeader: string | null | undefined): boolean {
  const host = normalizeHostHeader(hostHeader);
  return host === "localhost" || host === "127.0.0.1";
}

export function shouldEnableLocalhostAdminBypass(input: {
  hostHeader: string | null | undefined;
  configuredBypass?: string | null | undefined;
  nodeEnv?: string | null | undefined;
}): boolean {
  if (!isLocalhostHost(input.hostHeader)) {
    return false;
  }

  const configuredBypass = (input.configuredBypass ?? process.env.ALLOW_LOCALHOST_AUTH_BYPASS ?? "")
    .trim()
    .toLowerCase();

  if (configuredBypass === "true") {
    return true;
  }

  if (configuredBypass === "false") {
    return false;
  }

  return (input.nodeEnv ?? process.env.NODE_ENV ?? "").trim().toLowerCase() === "development";
}
