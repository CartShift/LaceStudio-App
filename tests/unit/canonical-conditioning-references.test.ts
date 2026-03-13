import { describe, expect, it } from "vitest";
import { buildCanonicalConditioningReferences, buildShotConditioningReferences } from "@/server/services/canonical-pack.service";

describe("buildCanonicalConditioningReferences", () => {
	it("deduplicates and prioritizes imported references before canonical ones", () => {
		const result = buildCanonicalConditioningReferences({
			canonicalReferences: [
				"gs://bucket/model/canonical-1.png",
				"gs://bucket/model/canonical-2.png",
				"gs://bucket/model/shared.png",
			],
			sourceReferences: [
				"gs://bucket/model/shared.png",
				"gs://bucket/model/imported-1.png",
			],
		});

		expect(result).toEqual([
			"gs://bucket/model/shared.png",
			"gs://bucket/model/imported-1.png",
			"gs://bucket/model/canonical-1.png",
			"gs://bucket/model/canonical-2.png",
		]);
	});

	it("caps conditioning references at max", () => {
		const canonicalReferences = Array.from({ length: 12 }, (_, index) => `gs://bucket/canonical-${index + 1}.png`);
		const sourceReferences = Array.from({ length: 12 }, (_, index) => `gs://bucket/imported-${index + 1}.png`);

		const result = buildCanonicalConditioningReferences({
			canonicalReferences,
			sourceReferences,
		});

		expect(result).toHaveLength(10);
		expect(result[0]).toBe("gs://bucket/imported-1.png");
		expect(result[9]).toBe("gs://bucket/imported-10.png");
	});
});

describe("buildShotConditioningReferences", () => {
	it("prioritizes the matching angle for close-up shots", () => {
		const result = buildShotConditioningReferences({
			shotCode: "left45_closeup",
			generationMode: "full",
			referencePool: [
				{
					url: "https://cdn.example.com/front.png",
					source: "external_url",
					title: "Model Identity uploaded frontal closeup",
					weight: "secondary",
					similarity_score: 0.9,
					source_kind: "uploaded_photo",
					view_angle: "frontal",
					framing: "closeup",
					expression: "neutral",
					identity_anchor_score: 0.96,
					sharpness_score: 0.92,
				},
				{
					url: "https://cdn.example.com/left.png",
					source: "external_url",
					title: "Model Identity uploaded left_45 closeup",
					weight: "secondary",
					similarity_score: 0.85,
					source_kind: "uploaded_photo",
					view_angle: "left_45",
					framing: "closeup",
					expression: "neutral",
					identity_anchor_score: 0.84,
					sharpness_score: 0.9,
				},
				{
					url: "https://cdn.example.com/right.png",
					source: "external_url",
					title: "Model Identity uploaded right_45 closeup",
					weight: "secondary",
					similarity_score: 0.8,
					source_kind: "uploaded_photo",
					view_angle: "right_45",
					framing: "closeup",
					expression: "neutral",
					identity_anchor_score: 0.82,
					sharpness_score: 0.88,
				},
			],
		});

		expect(result[0]?.url).toBe("https://cdn.example.com/left.png");
		expect(result[0]?.weight).toBe("primary");
	});

	it("keeps the approved front anchor for remaining-look generation", () => {
		const result = buildShotConditioningReferences({
			shotCode: "full_body_front",
			generationMode: "remaining",
			referencePool: [
				{
					url: "https://cdn.example.com/front-anchor.png",
					source: "external_url",
					title: "Model Identity approved front anchor",
					weight: "primary",
					similarity_score: 1,
					source_kind: "selected_front_candidate",
					canonical_shot_code: "frontal_closeup",
					view_angle: "frontal",
					framing: "closeup",
					expression: "neutral",
					identity_anchor_score: 1,
					sharpness_score: 0.95,
				},
				{
					url: "https://cdn.example.com/full-body.png",
					source: "external_url",
					title: "Model Identity uploaded frontal full_body",
					weight: "secondary",
					similarity_score: 0.8,
					source_kind: "uploaded_photo",
					view_angle: "frontal",
					framing: "full_body",
					expression: "neutral",
					identity_anchor_score: 0.78,
					sharpness_score: 0.82,
				},
			],
		});

		expect(result).toHaveLength(2);
		expect(result[0]?.url).toBe("https://cdn.example.com/front-anchor.png");
		expect(result[0]?.weight).toBe("primary");
	});
});
