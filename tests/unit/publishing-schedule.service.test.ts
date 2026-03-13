import { describe, expect, it } from "vitest";
import { appendHashtags } from "@/server/services/publishing-schedule.service";

describe("publishing-schedule.service", () => {
  it("dedupes preset hashtags against ones already present in the caption", () => {
    const result = appendHashtags(
      "Already queued with #AvaStyle and #EditorialEdit",
      ["avastyle", "Editorial Edit", "NightMuse", "#nightmuse", "Campaign Notes"],
    );

    expect(result).toBe("Already queued with #AvaStyle and #EditorialEdit #NightMuse #CampaignNotes");
  });
});
