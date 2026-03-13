DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InstagramProfileConnectionStatus') THEN
    CREATE TYPE "InstagramProfileConnectionStatus" AS ENUM ('DISCONNECTED', 'PENDING', 'CONNECTED', 'ERROR', 'EXPIRED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PostingPlanStatus') THEN
    CREATE TYPE "PostingPlanStatus" AS ENUM ('RECOMMENDED', 'SCHEDULED', 'SKIPPED', 'PUBLISHED', 'CANCELLED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "instagram_profiles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "model_id" UUID NOT NULL,
  "handle" VARCHAR(80),
  "display_name" VARCHAR(120),
  "timezone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
  "connection_status" "InstagramProfileConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
  "graph_user_id" VARCHAR(120),
  "token_expires_at" TIMESTAMPTZ(6),
  "publish_enabled" BOOLEAN NOT NULL DEFAULT true,
  "last_analytics_sync_at" TIMESTAMPTZ(6),
  "profile_metadata" JSONB,
  "oauth_state" VARCHAR(120),
  "oauth_state_expires_at" TIMESTAMPTZ(6),
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "instagram_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "instagram_profiles_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "ai_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "instagram_profiles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "instagram_profiles_model_id_key" ON "instagram_profiles"("model_id");
CREATE INDEX IF NOT EXISTS "idx_instagram_profiles_connection_status" ON "instagram_profiles"("connection_status");
CREATE INDEX IF NOT EXISTS "idx_instagram_profiles_created_by" ON "instagram_profiles"("created_by");

CREATE TABLE IF NOT EXISTS "instagram_profile_auth" (
  "profile_id" UUID NOT NULL,
  "access_token_encrypted" TEXT NOT NULL,
  "refresh_token_encrypted" TEXT,
  "token_type" VARCHAR(40),
  "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "last_refreshed_at" TIMESTAMPTZ(6),
  "refresh_requested_at" TIMESTAMPTZ(6),
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "instagram_profile_auth_pkey" PRIMARY KEY ("profile_id"),
  CONSTRAINT "instagram_profile_auth_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "instagram_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "posting_strategies" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "profile_id" UUID NOT NULL,
  "timezone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
  "weekly_post_target" INTEGER NOT NULL DEFAULT 5,
  "cooldown_hours" INTEGER NOT NULL DEFAULT 18,
  "min_ready_assets" INTEGER NOT NULL DEFAULT 3,
  "auto_queue_enabled" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "posting_strategies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "posting_strategies_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "instagram_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "posting_strategies_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "posting_strategies_profile_id_key" ON "posting_strategies"("profile_id");
CREATE INDEX IF NOT EXISTS "idx_posting_strategies_created_by" ON "posting_strategies"("created_by");

CREATE TABLE IF NOT EXISTS "strategy_pillars" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "strategy_id" UUID NOT NULL,
  "key" VARCHAR(80) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" TEXT,
  "target_share_percent" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "supported_post_types" "PostType"[] NOT NULL DEFAULT ARRAY['feed']::"PostType"[],
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "strategy_pillars_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "strategy_pillars_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "posting_strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "strategy_pillars_strategy_id_key_key" ON "strategy_pillars"("strategy_id", "key");
CREATE INDEX IF NOT EXISTS "idx_strategy_pillars_strategy_priority" ON "strategy_pillars"("strategy_id", "priority");

CREATE TABLE IF NOT EXISTS "strategy_slot_templates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "strategy_id" UUID NOT NULL,
  "pillar_id" UUID,
  "label" VARCHAR(120) NOT NULL,
  "weekday" INTEGER NOT NULL,
  "local_time" VARCHAR(8) NOT NULL,
  "daypart" VARCHAR(40) NOT NULL,
  "post_type" "PostType" NOT NULL,
  "variant_type" "VariantType" NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "strategy_slot_templates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "strategy_slot_templates_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "posting_strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "strategy_slot_templates_pillar_id_fkey" FOREIGN KEY ("pillar_id") REFERENCES "strategy_pillars"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_slot_templates_strategy_weekday_time" ON "strategy_slot_templates"("strategy_id", "weekday", "local_time");
CREATE INDEX IF NOT EXISTS "idx_slot_templates_pillar_id" ON "strategy_slot_templates"("pillar_id");

CREATE TABLE IF NOT EXISTS "posting_plan_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "profile_id" UUID NOT NULL,
  "strategy_id" UUID,
  "pillar_id" UUID,
  "asset_id" UUID,
  "status" "PostingPlanStatus" NOT NULL DEFAULT 'RECOMMENDED',
  "slot_start" TIMESTAMPTZ(6) NOT NULL,
  "slot_end" TIMESTAMPTZ(6),
  "pillar_key" VARCHAR(80),
  "post_type" "PostType" NOT NULL,
  "variant_type" "VariantType" NOT NULL,
  "rationale" TEXT,
  "confidence" DECIMAL(5,4),
  "caption_suggestion" TEXT,
  "strategy_snapshot" JSONB,
  "autopilot_metadata" JSONB,
  "decided_at" TIMESTAMPTZ(6),
  "created_by" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "posting_plan_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "posting_plan_items_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "instagram_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "posting_plan_items_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "posting_strategies"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "posting_plan_items_pillar_id_fkey" FOREIGN KEY ("pillar_id") REFERENCES "strategy_pillars"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "posting_plan_items_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "posting_plan_items_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "posting_plan_items_profile_id_slot_start_post_type_key" ON "posting_plan_items"("profile_id", "slot_start", "post_type");
CREATE INDEX IF NOT EXISTS "idx_plan_items_profile_status_slot" ON "posting_plan_items"("profile_id", "status", "slot_start");
CREATE INDEX IF NOT EXISTS "idx_plan_items_pillar_id" ON "posting_plan_items"("pillar_id");
CREATE INDEX IF NOT EXISTS "idx_plan_items_asset_id" ON "posting_plan_items"("asset_id");

ALTER TABLE "publishing_queue"
  ADD COLUMN IF NOT EXISTS "profile_id" UUID,
  ADD COLUMN IF NOT EXISTS "plan_item_id" UUID,
  ADD COLUMN IF NOT EXISTS "pillar_key" VARCHAR(80),
  ADD COLUMN IF NOT EXISTS "slot_start" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "strategy_snapshot" JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'publishing_queue_profile_id_fkey'
  ) THEN
    ALTER TABLE "publishing_queue"
      ADD CONSTRAINT "publishing_queue_profile_id_fkey"
      FOREIGN KEY ("profile_id") REFERENCES "instagram_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'publishing_queue_plan_item_id_fkey'
  ) THEN
    ALTER TABLE "publishing_queue"
      ADD CONSTRAINT "publishing_queue_plan_item_id_fkey"
      FOREIGN KEY ("plan_item_id") REFERENCES "posting_plan_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_pub_queue_profile_scheduled" ON "publishing_queue"("profile_id", "scheduled_at");
CREATE INDEX IF NOT EXISTS "idx_pub_queue_plan_item_id" ON "publishing_queue"("plan_item_id");
