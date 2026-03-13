DO $$
BEGIN
  CREATE TYPE "MediaKind" AS ENUM ('image', 'video');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "VideoGenerationJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "StrategyPrimaryGoal" AS ENUM ('balanced_growth', 'top_of_funnel', 'business_conversion');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "VariantType" ADD VALUE IF NOT EXISTS 'reel_9x16';

ALTER TABLE "asset_variants"
  ADD COLUMN "media_kind" "MediaKind" NOT NULL DEFAULT 'image',
  ADD COLUMN "duration_ms" INTEGER,
  ADD COLUMN "mime_type" VARCHAR(120),
  ADD COLUMN "preview_image_gcs_uri" TEXT;

ALTER TABLE "analytics_snapshots"
  ADD COLUMN "views" INTEGER,
  ADD COLUMN "replies_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "avg_watch_time_ms" INTEGER,
  ADD COLUMN "total_watch_time_ms" INTEGER,
  ADD COLUMN "profile_visits_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "follows_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "raw_metrics" JSONB;

ALTER TABLE "posting_strategies"
  ADD COLUMN "primary_goal" "StrategyPrimaryGoal" NOT NULL DEFAULT 'balanced_growth',
  ADD COLUMN "weekly_feed_target" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "weekly_reel_target" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "weekly_story_target" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "experimentation_rate_percent" INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN "auto_queue_min_confidence" DECIMAL(5,4) NOT NULL DEFAULT 0.72,
  ADD COLUMN "best_time_windows" JSONB;

CREATE TABLE "video_generation_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "asset_id" UUID NOT NULL,
  "source_variant_id" UUID,
  "output_variant_id" UUID,
  "status" "VideoGenerationJobStatus" NOT NULL DEFAULT 'PENDING',
  "prompt_text" TEXT,
  "provider" VARCHAR(80) NOT NULL,
  "provider_job_id" VARCHAR(160),
  "duration_ms_target" INTEGER NOT NULL DEFAULT 8000,
  "aspect_ratio" VARCHAR(12) NOT NULL DEFAULT '9:16',
  "output_url" TEXT,
  "preview_image_url" TEXT,
  "error_message" TEXT,
  "metadata" JSONB,
  "created_by" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "completed_at" TIMESTAMPTZ(6),
  CONSTRAINT "video_generation_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_video_generation_jobs_asset_status" ON "video_generation_jobs" ("asset_id", "status");
CREATE INDEX "idx_video_generation_jobs_provider_job_id" ON "video_generation_jobs" ("provider_job_id");

ALTER TABLE "video_generation_jobs"
  ADD CONSTRAINT "video_generation_jobs_asset_id_fkey"
  FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "video_generation_jobs"
  ADD CONSTRAINT "video_generation_jobs_source_variant_id_fkey"
  FOREIGN KEY ("source_variant_id") REFERENCES "asset_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "video_generation_jobs"
  ADD CONSTRAINT "video_generation_jobs_output_variant_id_fkey"
  FOREIGN KEY ("output_variant_id") REFERENCES "asset_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "video_generation_jobs"
  ADD CONSTRAINT "video_generation_jobs_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
