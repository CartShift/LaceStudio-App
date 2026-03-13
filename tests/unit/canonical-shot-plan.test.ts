import { describe, expect, it } from "vitest";
import { buildCanonicalShotPlan } from "@/server/services/canonical-shot-plan";

describe("canonical-shot-plan", () => {
  it("builds 8 deterministic strict-studio shot prompts", () => {
    const plan = buildCanonicalShotPlan({
      modelName: "Ava Prime",
      bodyProfile: {
        hair_color: "black",
        eye_color: "green",
      },
      faceProfile: {
        face_shape: "oval",
        jawline: "defined",
      },
    });

    expect(plan).toHaveLength(8);
    expect(plan[0]?.shot_code).toBe("frontal_closeup");
    expect(plan[0]?.prompt).toContain("Strict studio setup");
    expect(plan[0]?.prompt).toContain("Identity body traits");
  });
});
