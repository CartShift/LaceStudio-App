import { describe, expect, it } from "vitest";
import { isLocalhostHost, shouldEnableLocalhostAdminBypass } from "@/lib/localhost-auth";

describe("localhost admin bypass", () => {
  it("recognizes localhost hosts", () => {
    expect(isLocalhostHost("localhost:3000")).toBe(true);
    expect(isLocalhostHost("127.0.0.1:3000")).toBe(true);
    expect(isLocalhostHost("app.example.com")).toBe(false);
  });

  it("defaults to enabled only for localhost development environments", () => {
    expect(
      shouldEnableLocalhostAdminBypass({
        hostHeader: "localhost:3000",
        configuredBypass: undefined,
        nodeEnv: "development",
      }),
    ).toBe(true);

    expect(
      shouldEnableLocalhostAdminBypass({
        hostHeader: "localhost:3000",
        configuredBypass: undefined,
        nodeEnv: "production",
      }),
    ).toBe(false);
  });

  it("honors explicit bypass flags", () => {
    expect(
      shouldEnableLocalhostAdminBypass({
        hostHeader: "localhost:3000",
        configuredBypass: "false",
        nodeEnv: "development",
      }),
    ).toBe(false);

    expect(
      shouldEnableLocalhostAdminBypass({
        hostHeader: "localhost:3000",
        configuredBypass: "true",
        nodeEnv: "production",
      }),
    ).toBe(true);
  });
});
