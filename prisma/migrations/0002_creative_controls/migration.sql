-- CreateEnum
CREATE TYPE "ImageModelProvider" AS ENUM ('gpu', 'openai', 'nano_banana_2');

-- AlterTable
ALTER TABLE "campaigns"
  ADD COLUMN "image_model_provider" "ImageModelProvider" NOT NULL DEFAULT 'gpu',
  ADD COLUMN "image_model_id" VARCHAR(120),
  ADD COLUMN "creative_controls" JSONB,
  ADD COLUMN "reference_board_version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "assets"
  ADD COLUMN "quality_score" DECIMAL(5,2),
  ADD COLUMN "moderation_notes" TEXT,
  ADD COLUMN "issue_tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "artifacts_flagged" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "identity_drift_score" DECIMAL(5,4),
  ADD COLUMN "refinement_index" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "refinement_history" JSONB;

-- CreateTable
CREATE TABLE "campaign_reference_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "campaign_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "label" VARCHAR(120) NOT NULL,
  "references" JSONB NOT NULL,
  "created_by" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "campaign_reference_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_refinement_states" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "campaign_id" UUID NOT NULL,
  "asset_id" UUID NOT NULL,
  "state_index" INTEGER NOT NULL,
  "label" VARCHAR(120),
  "controls_patch" JSONB NOT NULL,
  "prompt_override" TEXT,
  "created_by" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "asset_refinement_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "campaign_reference_versions_campaign_id_version_key"
ON "campaign_reference_versions"("campaign_id", "version");

-- CreateIndex
CREATE INDEX "idx_campaign_reference_versions_campaign_id"
ON "campaign_reference_versions"("campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "asset_refinement_states_asset_id_state_index_key"
ON "asset_refinement_states"("asset_id", "state_index");

-- CreateIndex
CREATE INDEX "idx_asset_refinement_states_campaign_id"
ON "asset_refinement_states"("campaign_id");

-- CreateIndex
CREATE INDEX "idx_asset_refinement_states_asset_id"
ON "asset_refinement_states"("asset_id");

-- AddForeignKey
ALTER TABLE "campaign_reference_versions"
ADD CONSTRAINT "campaign_reference_versions_campaign_id_fkey"
FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_reference_versions"
ADD CONSTRAINT "campaign_reference_versions_created_by_fkey"
FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_refinement_states"
ADD CONSTRAINT "asset_refinement_states_campaign_id_fkey"
FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_refinement_states"
ADD CONSTRAINT "asset_refinement_states_asset_id_fkey"
FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_refinement_states"
ADD CONSTRAINT "asset_refinement_states_created_by_fkey"
FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
