import { describe, expect, it } from "vitest";
import {
  canonicalPackApproveSchema,
  socialTracksSchema,
  workflowPatchSchema,
} from "@/server/schemas/model-workflow";

describe("model-workflow-schema", () => {
  it("validates social track ratio to 100%", () => {
    const result = socialTracksSchema.safeParse({
      reality_like_daily: {
        enabled: true,
        style_brief: "daily style",
        target_ratio_percent: 70,
        weekly_post_goal: 3,
      },
      fashion_editorial: {
        enabled: true,
        style_brief: "editorial style",
        target_ratio_percent: 20,
        weekly_post_goal: 2,
      },
    });

    expect(result.success).toBe(false);
  });

  it("enforces 8 canonical selections on approve", () => {
    const result = canonicalPackApproveSchema.safeParse({
      pack_version: 1,
      selections: [
        {
          shot_code: "frontal_closeup",
          candidate_id: "11111111-1111-1111-1111-111111111111",
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("accepts character design workflow patch payload", () => {
    const parsed = workflowPatchSchema.parse({
      step: "character_design",
      payload: {
        body_profile: {
          height_cm: 170,
          build: "athletic",
          skin_tone: "olive",
          hair_color: "brown",
          hair_length: "long",
          hair_style: "waves",
          eye_color: "brown",
          distinguishing_features: [],
          advanced_traits: {
            shoulder_width: "balanced",
          },
        },
        face_profile: {
          face_shape: "oval",
          jawline: "defined",
          nose_profile: "straight",
          lip_profile: "balanced",
          brow_profile: "soft_arch",
          eye_spacing: "balanced",
          eye_shape: "almond",
          forehead_height: "balanced",
          cheekbones: "defined",
          advanced_traits: {},
        },
        imperfection_fingerprint: [],
      },
    });

    expect(parsed.step).toBe("character_design");
  });
});
