import { describe, expect, it } from "vitest";
import {
  createDefaultCreativeControls,
  enrichReferenceBoard,
  estimateIdentityDriftScore,
  mergeCreativeControls,
  shouldAlertIdentityDrift,
} from "@/server/services/creative-controls";

describe("creative-controls", () => {
  it("merges partial overrides while preserving defaults", () => {
    const controls = mergeCreativeControls(createDefaultCreativeControls(), {
      expression: {
        smile_intensity: 0.45,
      },
      pose: {
        preset: "walking",
      },
    });

    expect(controls.expression.smile_intensity).toBe(0.45);
    expect(controls.pose.preset).toBe("walking");
    expect(controls.identity.face_embedding_lock).toBe(true);
  });

  it("enriches references with versions and similarity", () => {
    const controls = createDefaultCreativeControls();
    controls.reference_board.items = [
      {
        source: "pinterest_url",
        url: "https://www.pinterest.com/pin/111",
        weight: "primary",
        version: 1,
      },
      {
        source: "pinterest_url",
        url: "https://www.pinterest.com/pin/222",
        weight: "secondary",
        version: 1,
      },
    ];

    const enriched = enrichReferenceBoard(controls, { versionOverride: 3 });
    expect(enriched.reference_board.active_version).toBe(3);
    expect(enriched.reference_board.items[0]?.id).toBeTruthy();
    expect(enriched.reference_board.items[0]?.similarity_score).toBeDefined();
    expect(enriched.reference_board.history[0]?.version).toBe(3);
  });

  it("raises identity drift alert when controls are too loose", () => {
    const controls = mergeCreativeControls(createDefaultCreativeControls(), {
      identity: {
        face_embedding_lock: false,
        body_ratio_enforcement: false,
      },
      realism: {
        skin_texture_realism: 0.2,
      },
    });

    const score = estimateIdentityDriftScore(controls);
    const decision = shouldAlertIdentityDrift(controls, score);

    expect(score).toBeGreaterThan(0.15);
    expect(decision.alert).toBe(true);
  });
});
