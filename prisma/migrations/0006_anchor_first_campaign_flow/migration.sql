ALTER TABLE "campaigns" ADD COLUMN "anchor_asset_id" UUID;
CREATE INDEX IF NOT EXISTS "idx_campaigns_anchor_asset_id" ON "campaigns" ("anchor_asset_id");
