import type { ModelPhotoImportSnapshot } from "@/components/models/types";

export function isHeuristicPhotoAnalysis(snapshot: ModelPhotoImportSnapshot | null): boolean {
	if (!snapshot) return false;
	if (snapshot.analysis_provider === "heuristic") return true;

	return (snapshot.latest_suggestion?.warnings ?? []).some(warning => warning.toLowerCase().includes("vision providers were unavailable"));
}

export function getPhotoImportAnalysisIssue(snapshot: ModelPhotoImportSnapshot | null): {
	tone: "warning" | "danger";
	title: string;
	description: string;
	blocking: boolean;
} | null {
	if (!snapshot?.latest_suggestion) return null;

	const warnings = (snapshot.latest_suggestion.warnings ?? []).filter(warning => warning.trim().length > 0);
	if (isHeuristicPhotoAnalysis(snapshot)) {
		return {
			tone: "danger",
			title: "Identity analysis fell back to baseline scoring",
			description:
				"The current angle labels and 50% anchor scores are provisional because live vision analysis was unavailable. Reanalyze these photos before generating so the app can rank real frontal and 45-degree anchors.",
			blocking: true
		};
	}

	if (warnings.length === 0) return null;

	return {
		tone: "warning",
		title: "Photo analysis returned warnings",
		description: warnings.join(" "),
		blocking: false
	};
}
