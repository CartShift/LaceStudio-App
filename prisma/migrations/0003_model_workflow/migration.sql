-- CreateEnum
CREATE TYPE "CanonicalPackStatus" AS ENUM ('NOT_STARTED', 'GENERATING', 'READY', 'APPROVED', 'FAILED');

-- CreateEnum
CREATE TYPE "ModelReferenceCandidateStatus" AS ENUM ('CANDIDATE', 'SELECTED', 'REJECTED');

-- AlterTable
ALTER TABLE "ai_models"
  ADD COLUMN "personality_profile" JSONB,
  ADD COLUMN "social_tracks_profile" JSONB,
  ADD COLUMN "onboarding_state" JSONB,
  ADD COLUMN "canonical_pack_status" "CanonicalPackStatus" NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN "active_canonical_pack_version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "canonical_references"
  ADD COLUMN "pack_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "shot_code" VARCHAR(40),
  ADD COLUMN "source_candidate_id" UUID;

-- Existing canonical references are now considered canonical pack v1.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY model_id
      ORDER BY sort_order ASC, created_at ASC, id ASC
    ) AS shot_order
  FROM "canonical_references"
)
UPDATE "canonical_references" refs
SET "shot_code" = CONCAT('legacy_shot_', ranked.shot_order::TEXT)
FROM ranked
WHERE refs.id = ranked.id;

ALTER TABLE "canonical_references"
  ALTER COLUMN "shot_code" SET NOT NULL;

-- Models with existing canonical references are backfilled as approved.
UPDATE "ai_models" models
SET
  "canonical_pack_status" = CASE
    WHEN EXISTS (
      SELECT 1
      FROM "canonical_references" refs
      WHERE refs.model_id = models.id
    ) THEN 'APPROVED'::"CanonicalPackStatus"
    ELSE 'NOT_STARTED'::"CanonicalPackStatus"
  END,
  "active_canonical_pack_version" = CASE
    WHEN EXISTS (
      SELECT 1
      FROM "canonical_references" refs
      WHERE refs.model_id = models.id
    ) THEN 1
    ELSE 0
  END;

-- CreateTable
CREATE TABLE "model_reference_candidates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "model_id" UUID NOT NULL,
  "pack_version" INTEGER NOT NULL,
  "shot_code" VARCHAR(40) NOT NULL,
  "candidate_index" INTEGER NOT NULL,
  "seed" INTEGER NOT NULL,
  "prompt_text" TEXT NOT NULL,
  "image_gcs_uri" TEXT NOT NULL,
  "provider" "ImageModelProvider" NOT NULL,
  "provider_model_id" VARCHAR(120),
  "realism_score" DECIMAL(5,4),
  "clarity_score" DECIMAL(5,4),
  "consistency_score" DECIMAL(5,4),
  "composite_score" DECIMAL(5,4),
  "qa_notes" TEXT,
  "status" "ModelReferenceCandidateStatus" NOT NULL DEFAULT 'CANDIDATE',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "model_reference_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_model_ref_candidates_model_pack_shot"
ON "model_reference_candidates"("model_id", "pack_version", "shot_code");

-- CreateIndex
CREATE INDEX "idx_model_ref_candidates_model_status"
ON "model_reference_candidates"("model_id", "status");

-- AddForeignKey
ALTER TABLE "model_reference_candidates"
ADD CONSTRAINT "model_reference_candidates_model_id_fkey"
FOREIGN KEY ("model_id") REFERENCES "ai_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;
