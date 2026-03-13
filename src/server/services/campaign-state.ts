import type { CampaignStatus } from "@/types/domain";

const transitions: Record<CampaignStatus, CampaignStatus[]> = {
	DRAFT: ["GENERATING"],
	GENERATING: ["REVIEW", "FAILED", "DRAFT"],
	REVIEW: ["GENERATING", "APPROVED", "REJECTED"],
	APPROVED: ["GENERATING", "SCHEDULED"],
	REJECTED: ["GENERATING", "DRAFT"],
	SCHEDULED: ["PUBLISHED"],
	PUBLISHED: [],
	FAILED: ["GENERATING", "DRAFT"]
};

export function canTransitionCampaign(from: CampaignStatus, to: CampaignStatus): boolean {
	return transitions[from].includes(to);
}
