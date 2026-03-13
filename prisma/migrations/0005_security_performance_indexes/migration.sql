CREATE INDEX IF NOT EXISTS "idx_assets_job_id" ON "assets" ("job_id");
CREATE INDEX IF NOT EXISTS "idx_canonical_refs_model_pack" ON "canonical_references" ("model_id", "pack_version");
CREATE INDEX IF NOT EXISTS "idx_campaigns_preset_version_id" ON "campaigns" ("preset_version_id");
CREATE INDEX IF NOT EXISTS "idx_pub_queue_created_by" ON "publishing_queue" ("created_by");
CREATE INDEX IF NOT EXISTS "idx_revenue_entries_contract_id" ON "revenue_entries" ("contract_id");
CREATE INDEX IF NOT EXISTS "idx_revenue_entries_reference_month" ON "revenue_entries" ("reference_month");
CREATE INDEX IF NOT EXISTS "idx_revenue_entries_contract_month" ON "revenue_entries" ("contract_id", "reference_month");
