-- CreateEnum
CREATE TYPE "ModelSourceReferenceStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "model_source_references" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "model_id" UUID NOT NULL,
  "uploaded_by" UUID NOT NULL,
  "image_gcs_uri" TEXT NOT NULL,
  "file_name" VARCHAR(255),
  "mime_type" VARCHAR(80) NOT NULL,
  "byte_size" INTEGER NOT NULL,
  "status" "ModelSourceReferenceStatus" NOT NULL DEFAULT 'PENDING',
  "rejection_reason" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "model_source_references_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_model_source_refs_model_status_created"
ON "model_source_references"("model_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "idx_model_source_refs_model_sort"
ON "model_source_references"("model_id", "sort_order");

-- AddForeignKey
ALTER TABLE "model_source_references"
ADD CONSTRAINT "model_source_references_model_id_fkey"
FOREIGN KEY ("model_id") REFERENCES "ai_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_source_references"
ADD CONSTRAINT "model_source_references_uploaded_by_fkey"
FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
