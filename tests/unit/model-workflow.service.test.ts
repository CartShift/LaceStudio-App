import { describe, expect, it } from "vitest";
import {
  buildModelCapabilityFlags,
  deriveModelStatusForWorkflow,
  deriveWorkflowCompleteness,
  MIN_ACCEPTED_IMPORTED_REFERENCES_FOR_ACTIVATION,
} from "@/server/services/model-workflow.service";

describe("model-workflow.service", () => {
  it("marks model active when character design and canonical pack are complete", () => {
    const status = deriveModelStatusForWorkflow(
      {
        status: "DRAFT",
        body_profile: { build: "athletic" },
        face_profile: { face_shape: "oval" },
        canonical_pack_status: "APPROVED",
        active_canonical_pack_version: 2,
      },
      8,
    );

    expect(status).toBe("ACTIVE");
  });

  it("keeps model draft when canonical references are incomplete", () => {
    const status = deriveModelStatusForWorkflow(
      {
        status: "DRAFT",
        body_profile: { build: "athletic" },
        face_profile: { face_shape: "oval" },
        canonical_pack_status: "READY",
        active_canonical_pack_version: 1,
      },
      4,
    );

    expect(status).toBe("DRAFT");
  });

  it("marks model active when character design exists and imported references are sufficient", () => {
    const status = deriveModelStatusForWorkflow(
      {
        status: "DRAFT",
        body_profile: { build: "athletic" },
        face_profile: { face_shape: "oval" },
        canonical_pack_status: "NOT_STARTED",
        active_canonical_pack_version: 0,
      },
      0,
      MIN_ACCEPTED_IMPORTED_REFERENCES_FOR_ACTIVATION,
    );

    expect(status).toBe("ACTIVE");
  });

  it("exposes provider capability flags from active LoRA state", () => {
    expect(buildModelCapabilityFlags(true)).toEqual({
      gpu_available: true,
      openai_available: true,
      nano_available: true,
    });

    expect(buildModelCapabilityFlags(false).gpu_available).toBe(false);
  });

  it("derives completeness for onboarding dashboard", () => {
    const completeness = deriveWorkflowCompleteness(
      {
        body_profile: { build: "athletic" },
        face_profile: { face_shape: "oval" },
        personality_profile: { social_voice: "warm" },
        social_tracks_profile: { reality_like_daily: { target_ratio_percent: 60 } },
        canonical_pack_status: "APPROVED",
        active_canonical_pack_version: 1,
      },
      8,
    );

    expect(completeness.has_character_design).toBe(true);
    expect(completeness.has_personality).toBe(true);
    expect(completeness.has_social_strategy).toBe(true);
    expect(completeness.has_canonical_pack).toBe(true);
    expect(completeness.can_finalize).toBe(true);
  });

  it("treats accepted imported references as sufficient for finalize gate", () => {
    const completeness = deriveWorkflowCompleteness(
      {
        body_profile: { build: "athletic" },
        face_profile: { face_shape: "oval" },
        personality_profile: { social_voice: "warm" },
        social_tracks_profile: { reality_like_daily: { target_ratio_percent: 60 } },
        canonical_pack_status: "NOT_STARTED",
        active_canonical_pack_version: 0,
      },
      0,
      MIN_ACCEPTED_IMPORTED_REFERENCES_FOR_ACTIVATION,
    );

    expect(completeness.has_canonical_pack).toBe(true);
    expect(completeness.can_finalize).toBe(true);
  });
});
