import { describe, expect, it } from "vitest";
import { buildCanonicalConditioningReferences } from "@/server/services/canonical-pack.service";

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
