import { describe, expect, it } from "vitest";
import {
  humanizeStatusLabel,
  toneForCampaignStatus,
  toneForGenerationJobStatus,
  toneForPublishingStatus,
} from "@/lib/status-labels";

describe("status labels", () => {
  it("humanizes enum-like values", () => {
    expect(humanizeStatusLabel("PENDING_APPROVAL")).toBe("Awaiting Review");
    expect(humanizeStatusLabel("IN_PROGRESS")).toBe("In Progress");
  });

  it("maps campaign statuses to expected tones", () => {
    expect(toneForCampaignStatus("REVIEW")).toBe("warning");
    expect(toneForCampaignStatus("PUBLISHED")).toBe("success");
    expect(toneForCampaignStatus("FAILED")).toBe("danger");
  });

  it("maps publishing and job statuses to expected tones", () => {
    expect(toneForPublishingStatus("PENDING_APPROVAL")).toBe("warning");
    expect(toneForPublishingStatus("REJECTED")).toBe("danger");
    expect(toneForGenerationJobStatus("COMPLETED")).toBe("success");
    expect(toneForGenerationJobStatus("TIMED_OUT")).toBe("danger");
  });
});
