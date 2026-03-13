import { describe, expect, it } from "vitest";
import { generateCampaignSchema } from "@/server/schemas/api";

describe("generateCampaignSchema", () => {
  it("defaults generation_mode to batch", () => {
    const parsed = generateCampaignSchema.parse({
      prompt_text: "Editorial shot",
    });

    expect(parsed.generation_mode).toBe("batch");
    expect(parsed.anchor_asset_id).toBeUndefined();
  });

  it("accepts explicit anchor mode", () => {
    const parsed = generateCampaignSchema.parse({
      prompt_text: "Anchor shot",
      generation_mode: "anchor",
    });

    expect(parsed.generation_mode).toBe("anchor");
  });

  it("rejects regenerate_asset_id when generation_mode is anchor", () => {
    const result = generateCampaignSchema.safeParse({
      prompt_text: "Refine",
      generation_mode: "anchor",
      regenerate_asset_id: "00000000-0000-0000-0000-000000000001",
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected schema validation to fail");
    }

    const messages = result.error.issues.map(issue => issue.message);
    expect(messages).toContain("You can't use regenerate_asset_id when generation_mode is anchor.");
  });
});
