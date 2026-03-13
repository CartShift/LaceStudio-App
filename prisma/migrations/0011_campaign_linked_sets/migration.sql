ALTER TABLE "campaigns"
  ADD COLUMN "campaign_group_id" UUID,
  ADD COLUMN "source_campaign_id" UUID;

CREATE INDEX "idx_campaigns_group_id" ON "campaigns"("campaign_group_id");
CREATE INDEX "idx_campaigns_source_campaign_id" ON "campaigns"("source_campaign_id");
