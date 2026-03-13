import { describe, expect, it } from "vitest";
import { canTransitionCampaign } from "@/server/services/campaign-state";

describe("campaign-state", () => {
  it("allows valid transitions", () => {
    expect(canTransitionCampaign("DRAFT", "GENERATING")).toBe(true);
    expect(canTransitionCampaign("REVIEW", "APPROVED")).toBe(true);
  });

  it("blocks invalid transitions", () => {
    expect(canTransitionCampaign("DRAFT", "APPROVED")).toBe(false);
    expect(canTransitionCampaign("PUBLISHED", "DRAFT")).toBe(false);
  });
});
