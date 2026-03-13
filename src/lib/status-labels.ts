import type {
  AssetStatus,
  CampaignStatus,
  GenerationJobStatus,
  ModelStatus,
  PublishingStatus,
} from "@/types/domain";

export type StatusTone = "neutral" | "success" | "warning" | "danger";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  ACTIVE: "Live",
  ARCHIVED: "Archived",
  GENERATING: "Creating Looks",
  REVIEW: "Ready for Review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  SCHEDULED: "Scheduled",
  PUBLISHED: "Published",
  FAILED: "Needs Attention",
  PENDING_APPROVAL: "Awaiting Review",
  PUBLISHING: "Publishing Now",
  RETRY: "Retrying",
  CANCELLED: "Cancelled",
  DISPATCHED: "Queued",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Done",
  TIMED_OUT: "Timed Out",
  NOT_STARTED: "Not Started",
  READY: "Ready",
  CANDIDATE: "Option",
  SELECTED: "Chosen",
  ACCEPTED: "Accepted",
  IDLE: "Not Started",
  UPLOADING: "Uploading",
  ANALYZING: "Reviewing Photos",
  PENDING: "Pending Review",
};

export function humanizeStatusLabel(input: string): string {
  const mapped = STATUS_LABELS[input];
  if (mapped) return mapped;

  return input
    .toLowerCase()
    .split("_")
    .map((token) => token[0]?.toUpperCase() + token.slice(1))
    .join(" ");
}

export function toneForModelStatus(status: ModelStatus): StatusTone {
  if (status === "ACTIVE") return "success";
  if (status === "DRAFT") return "warning";
  return "danger";
}

export function toneForCampaignStatus(status: CampaignStatus): StatusTone {
  if (status === "APPROVED" || status === "SCHEDULED" || status === "PUBLISHED") return "success";
  if (status === "FAILED" || status === "REJECTED") return "danger";
  if (status === "DRAFT" || status === "GENERATING" || status === "REVIEW") return "warning";
  return "neutral";
}

export function toneForPublishingStatus(status: PublishingStatus): StatusTone {
  if (status === "PUBLISHED" || status === "SCHEDULED") return "success";
  if (status === "FAILED" || status === "REJECTED" || status === "CANCELLED") return "danger";
  if (status === "PENDING_APPROVAL" || status === "RETRY" || status === "PUBLISHING") return "warning";
  return "neutral";
}

export function toneForGenerationJobStatus(status: GenerationJobStatus): StatusTone {
  if (status === "COMPLETED") return "success";
  if (status === "FAILED" || status === "TIMED_OUT") return "danger";
  if (status === "DISPATCHED" || status === "IN_PROGRESS") return "warning";
  return "neutral";
}

export function toneForAssetStatus(status: AssetStatus): StatusTone {
  if (status === "APPROVED") return "success";
  if (status === "REJECTED") return "danger";
  return "warning";
}
