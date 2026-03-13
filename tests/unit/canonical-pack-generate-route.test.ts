import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionContextMock: vi.fn(async () => ({ role: "admin", userId: "00000000-0000-0000-0000-000000000001" })),
  assertRoleMock: vi.fn(),
  withRateLimitMock: vi.fn(),
  isDemoModeMock: vi.fn(() => false),
  startCanonicalPackGenerationMock: vi.fn(async () => ({ job_id: "job-1", pack_version: 2 })),
  demoStartCanonicalPackGenerationMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSessionContext: mocks.getSessionContextMock,
  assertRole: mocks.assertRoleMock,
}));

vi.mock("@/lib/rate-limit", () => ({
  withRateLimit: mocks.withRateLimitMock,
}));

vi.mock("@/server/demo/mode", () => ({
  isDemoMode: mocks.isDemoModeMock,
}));

vi.mock("@/server/demo/store", () => ({
  demoStore: {
    startCanonicalPackGeneration: mocks.demoStartCanonicalPackGenerationMock,
  },
}));

vi.mock("@/server/services/canonical-pack.service", () => ({
  startCanonicalPackGeneration: mocks.startCanonicalPackGenerationMock,
}));

import { POST } from "@/app/api/models/[id]/workflow/canonical-pack/generate/route";

describe("canonical-pack generate route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isDemoModeMock.mockReturnValue(false);
    mocks.startCanonicalPackGenerationMock.mockResolvedValue({
      job_id: "job-1",
      pack_version: 2,
    });
  });

  it("starts background canonical generation without waiting for completion", async () => {
    const response = await POST(
      new Request("http://localhost/api/models/11111111-1111-4111-8111-111111111111/workflow/canonical-pack/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: "zai_glm",
          candidates_per_shot: 1,
          generation_mode: "front_only",
        }),
      }),
      { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) },
    );

    expect(response.status).toBe(202);
    expect(mocks.withRateLimitMock).toHaveBeenCalledTimes(1);
    expect(mocks.startCanonicalPackGenerationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "11111111-1111-4111-8111-111111111111",
        initiatedBy: "00000000-0000-0000-0000-000000000001",
        awaitCompletion: false,
      }),
    );
  });
});
