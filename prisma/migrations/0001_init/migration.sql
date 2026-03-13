CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- Optional extensions (pgvector / pg_cron) are environment-specific and
-- should be installed and managed outside of this baseline migration.

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'OPERATOR', 'CLIENT');

-- CreateEnum
CREATE TYPE "ModelStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'GENERATING', 'REVIEW', 'APPROVED', 'REJECTED', 'SCHEDULED', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "GenerationJobStatus" AS ENUM ('DISPATCHED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'TIMED_OUT');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VariantType" AS ENUM ('feed_1x1', 'feed_4x5', 'story_9x16', 'master');

-- CreateEnum
CREATE TYPE "PostType" AS ENUM ('feed', 'story', 'reel');

-- CreateEnum
CREATE TYPE "PublishingStatus" AS ENUM ('PENDING_APPROVAL', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'RETRY', 'FAILED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PlatformType" AS ENUM ('instagram');

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('RETAINER', 'RETAINER_PLUS_BONUS');

-- CreateEnum
CREATE TYPE "RevenueEntryType" AS ENUM ('RETAINER', 'BONUS', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(255) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'OPERATOR',
    "display_name" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_models" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "status" "ModelStatus" NOT NULL DEFAULT 'DRAFT',
    "body_profile" JSONB,
    "face_profile" JSONB,
    "imperfection_fingerprint" JSONB,
    "active_version_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "model_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "lora_gcs_uri" TEXT NOT NULL,
    "lora_strength" DECIMAL(3,2) NOT NULL DEFAULT 0.8,
    "file_size_bytes" BIGINT,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canonical_references" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "model_id" UUID NOT NULL,
    "seed" INTEGER NOT NULL,
    "prompt_text" TEXT NOT NULL,
    "reference_image_url" TEXT NOT NULL,
    "notes" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "canonical_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "presets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(100) NOT NULL,
    "mood_tag" VARCHAR(50),
    "current_version_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "presets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preset_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "preset_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "lighting_profile" JSONB NOT NULL,
    "lens_profile" JSONB NOT NULL,
    "color_palette" JSONB NOT NULL,
    "grading_curve" JSONB NOT NULL,
    "camera_simulation" JSONB,
    "prompt_fragment" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "preset_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pose_packs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "manifest" JSONB NOT NULL,
    "compatibility" VARCHAR(10) NOT NULL DEFAULT 'all',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pose_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pose_pack_models" (
    "pose_pack_id" UUID NOT NULL,
    "model_id" UUID NOT NULL,

    CONSTRAINT "pose_pack_models_pkey" PRIMARY KEY ("pose_pack_id","model_id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(200) NOT NULL,
    "model_id" UUID NOT NULL,
    "preset_version_id" UUID NOT NULL,
    "pose_pack_id" UUID,
    "product_asset_url" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "batch_size" INTEGER NOT NULL,
    "resolution_width" INTEGER NOT NULL DEFAULT 1024,
    "resolution_height" INTEGER NOT NULL DEFAULT 1024,
    "upscale" BOOLEAN NOT NULL DEFAULT true,
    "prompt_text" TEXT,
    "negative_prompt" TEXT,
    "custom_prompt_additions" TEXT,
    "base_seed" INTEGER,
    "error_message" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "campaign_id" UUID NOT NULL,
    "status" "GenerationJobStatus" NOT NULL DEFAULT 'DISPATCHED',
    "gpu_provider" VARCHAR(50),
    "gpu_type" VARCHAR(50),
    "payload" JSONB NOT NULL,
    "response_payload" JSONB,
    "generation_time_ms" INTEGER,
    "estimated_cost_usd" DECIMAL(10,4),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "dispatched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "generation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "campaign_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'PENDING',
    "raw_gcs_uri" TEXT NOT NULL,
    "approved_gcs_uri" TEXT,
    "seed" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "file_size_bytes" BIGINT,
    "prompt_text" TEXT NOT NULL,
    "generation_time_ms" INTEGER,
    "sequence_number" INTEGER NOT NULL,
    "is_favorite" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ(6),

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_variants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "asset_id" UUID NOT NULL,
    "format_type" "VariantType" NOT NULL,
    "gcs_uri" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "file_size_bytes" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_embeddings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "asset_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "model_id" UUID NOT NULL,
    "prompt_text" TEXT NOT NULL,
    "embedding" DOUBLE PRECISION[] NOT NULL,
    "embedding_model" VARCHAR(100) NOT NULL DEFAULT 'text-embedding-3-small',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hashtag_presets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(100) NOT NULL,
    "hashtags" TEXT[],
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hashtag_presets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publishing_queue" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "asset_id" UUID NOT NULL,
    "variant_type" "VariantType" NOT NULL,
    "platform" "PlatformType" NOT NULL DEFAULT 'instagram',
    "post_type" "PostType" NOT NULL,
    "caption" TEXT NOT NULL,
    "hashtag_preset_id" UUID,
    "status" "PublishingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduled_at" TIMESTAMPTZ(6) NOT NULL,
    "published_at" TIMESTAMPTZ(6),
    "ig_media_id" VARCHAR(100),
    "ig_container_id" VARCHAR(100),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "retry_after" TIMESTAMPTZ(6),
    "rejection_reason" TEXT,
    "error_message" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publishing_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publishing_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "publishing_queue_id" UUID NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "request_payload" JSONB,
    "response_payload" JSONB,
    "http_status" INTEGER,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publishing_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "publishing_queue_id" UUID NOT NULL,
    "ig_media_id" VARCHAR(100) NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "likes_count" INTEGER NOT NULL DEFAULT 0,
    "comments_count" INTEGER NOT NULL DEFAULT 0,
    "saves_count" INTEGER NOT NULL DEFAULT 0,
    "shares_count" INTEGER NOT NULL DEFAULT 0,
    "engagement_total" INTEGER NOT NULL DEFAULT 0,
    "engagement_rate" DECIMAL(8,4),
    "fetched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "ip_address" INET,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" VARCHAR(100) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(120) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "visual_direction" JSONB,
    "voice_notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_model_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "model_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_model_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_contracts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "contract_type" "ContractType" NOT NULL DEFAULT 'RETAINER_PLUS_BONUS',
    "monthly_retainer_usd" DECIMAL(10,2) NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_bonus_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contract_id" UUID NOT NULL,
    "metric" VARCHAR(80) NOT NULL,
    "threshold" DECIMAL(10,4) NOT NULL,
    "bonus_amount_usd" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "performance_bonus_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contract_id" UUID NOT NULL,
    "type" "RevenueEntryType" NOT NULL,
    "amount_usd" DECIMAL(10,2) NOT NULL,
    "reference_month" TIMESTAMPTZ(6) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ai_models_name_key" ON "ai_models"("name");

-- CreateIndex
CREATE INDEX "idx_ai_models_status" ON "ai_models"("status");

-- CreateIndex
CREATE INDEX "idx_ai_models_created_by" ON "ai_models"("created_by");

-- CreateIndex
CREATE INDEX "idx_model_versions_model_id" ON "model_versions"("model_id");

-- CreateIndex
CREATE UNIQUE INDEX "model_versions_model_id_version_key" ON "model_versions"("model_id", "version");

-- CreateIndex
CREATE INDEX "idx_canonical_refs_model_id" ON "canonical_references"("model_id");

-- CreateIndex
CREATE INDEX "idx_presets_created_by" ON "presets"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "preset_versions_preset_id_version_key" ON "preset_versions"("preset_id", "version");

-- CreateIndex
CREATE INDEX "idx_campaigns_model_id" ON "campaigns"("model_id");

-- CreateIndex
CREATE INDEX "idx_campaigns_status" ON "campaigns"("status");

-- CreateIndex
CREATE INDEX "idx_campaigns_created_by" ON "campaigns"("created_by");

-- CreateIndex
CREATE INDEX "idx_campaigns_created_at" ON "campaigns"("created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_gen_jobs_campaign_id" ON "generation_jobs"("campaign_id");

-- CreateIndex
CREATE INDEX "idx_gen_jobs_status" ON "generation_jobs"("status");

-- CreateIndex
CREATE INDEX "idx_assets_campaign_id" ON "assets"("campaign_id");

-- CreateIndex
CREATE INDEX "idx_assets_status" ON "assets"("status");

-- CreateIndex
CREATE INDEX "idx_asset_variants_asset_id" ON "asset_variants"("asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "asset_variants_asset_id_format_type_key" ON "asset_variants"("asset_id", "format_type");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_embeddings_asset_id_key" ON "prompt_embeddings"("asset_id");

-- CreateIndex
CREATE INDEX "idx_prompt_embeddings_model_id" ON "prompt_embeddings"("model_id");

-- CreateIndex
CREATE INDEX "idx_prompt_embeddings_campaign_id" ON "prompt_embeddings"("campaign_id");

-- CreateIndex
CREATE INDEX "idx_pub_queue_status_scheduled" ON "publishing_queue"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "idx_pub_queue_asset_id" ON "publishing_queue"("asset_id");

-- CreateIndex
CREATE INDEX "idx_pub_logs_queue_id" ON "publishing_logs"("publishing_queue_id");

-- CreateIndex
CREATE INDEX "idx_analytics_pub_queue_id" ON "analytics_snapshots"("publishing_queue_id");

-- CreateIndex
CREATE INDEX "idx_analytics_fetched_at" ON "analytics_snapshots"("fetched_at" DESC);

-- CreateIndex
CREATE INDEX "idx_audit_entity" ON "audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "idx_audit_created_at" ON "audit_log"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "client_model_assignments_client_id_model_id_key" ON "client_model_assignments"("client_id", "model_id");

-- AddForeignKey
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_versions" ADD CONSTRAINT "model_versions_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "ai_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_versions" ADD CONSTRAINT "model_versions_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canonical_references" ADD CONSTRAINT "canonical_references_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "ai_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presets" ADD CONSTRAINT "presets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preset_versions" ADD CONSTRAINT "preset_versions_preset_id_fkey" FOREIGN KEY ("preset_id") REFERENCES "presets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pose_packs" ADD CONSTRAINT "pose_packs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pose_pack_models" ADD CONSTRAINT "pose_pack_models_pose_pack_id_fkey" FOREIGN KEY ("pose_pack_id") REFERENCES "pose_packs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pose_pack_models" ADD CONSTRAINT "pose_pack_models_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "ai_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "ai_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_preset_version_id_fkey" FOREIGN KEY ("preset_version_id") REFERENCES "preset_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_pose_pack_id_fkey" FOREIGN KEY ("pose_pack_id") REFERENCES "pose_packs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "generation_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_variants" ADD CONSTRAINT "asset_variants_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_embeddings" ADD CONSTRAINT "prompt_embeddings_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_embeddings" ADD CONSTRAINT "prompt_embeddings_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_embeddings" ADD CONSTRAINT "prompt_embeddings_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "ai_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hashtag_presets" ADD CONSTRAINT "hashtag_presets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publishing_queue" ADD CONSTRAINT "publishing_queue_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publishing_queue" ADD CONSTRAINT "publishing_queue_hashtag_preset_id_fkey" FOREIGN KEY ("hashtag_preset_id") REFERENCES "hashtag_presets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publishing_queue" ADD CONSTRAINT "publishing_queue_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publishing_logs" ADD CONSTRAINT "publishing_logs_publishing_queue_id_fkey" FOREIGN KEY ("publishing_queue_id") REFERENCES "publishing_queue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshots_publishing_queue_id_fkey" FOREIGN KEY ("publishing_queue_id") REFERENCES "publishing_queue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_profiles" ADD CONSTRAINT "brand_profiles_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_profiles" ADD CONSTRAINT "brand_profiles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_model_assignments" ADD CONSTRAINT "client_model_assignments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_model_assignments" ADD CONSTRAINT "client_model_assignments_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "ai_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_contracts" ADD CONSTRAINT "revenue_contracts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_contracts" ADD CONSTRAINT "revenue_contracts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_bonus_rules" ADD CONSTRAINT "performance_bonus_rules_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "revenue_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_entries" ADD CONSTRAINT "revenue_entries_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "revenue_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Vector similarity index (requires pgvector). If you install pgvector and
-- want HNSW indexes, create them via a separate ops migration.

-- Minimal auth schema and helper functions used by RLS policies.
-- In local development with a superuser connection, RLS is not enforced.
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
AS $$
  SELECT NULL::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
AS $$
  SELECT NULL::text;
$$;

-- Enable RLS
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_models" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "model_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "canonical_references" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "presets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "preset_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pose_packs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pose_pack_models" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "generation_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "asset_variants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prompt_embeddings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "publishing_queue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "publishing_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hashtag_presets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "analytics_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "system_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "brand_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_model_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "revenue_contracts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "revenue_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "performance_bonus_rules" ENABLE ROW LEVEL SECURITY;

-- Baseline RLS policies (refine in subsequent migrations)
CREATE POLICY "authenticated_read_all" ON "presets" FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "authenticated_read_all_versions" ON "preset_versions" FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "operator_campaign_access" ON "campaigns" FOR ALL USING (auth.uid() = created_by) WITH CHECK (auth.uid() = created_by);

-- Seed system settings
INSERT INTO "system_settings" ("key", "value")
VALUES
  ('require_publishing_approval', 'true'::jsonb),
  ('gpu_monthly_budget_usd', '500.00'::jsonb),
  ('gpu_cost_per_ms', '0.0000005'::jsonb),
  ('instagram_rate_limit_per_hour', '25'::jsonb),
  ('default_lora_strength', '0.80'::jsonb),
  ('max_batch_size', '12'::jsonb)
ON CONFLICT ("key") DO NOTHING;
