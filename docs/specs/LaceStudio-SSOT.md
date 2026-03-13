# LaceStudio — Single Source of Truth (SSOT)

## LaceStudio

**Version:** 3.0-SSOT
**Status:** Implementation-Ready Specification
**Last Updated:** 2026-03-03
**Classification:** Internal — Confidential

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Glossary & Definitions](#2-glossary--definitions)
3. [System Architecture](#3-system-architecture)
4. [Technology Stack & Constraints](#4-technology-stack--constraints)
5. [User Roles & Permissions](#5-user-roles--permissions)
6. [Module 1 — Identity Manager](#6-module-1--identity-manager)
7. [Module 2 — Style Preset Engine](#7-module-2--style-preset-engine)
8. [Module 3 — Campaign Builder](#8-module-3--campaign-builder)
9. [Module 4 — Image Generation Service](#9-module-4--image-generation-service)
10. [Module 5 — Prompt & Embedding Module](#10-module-5--prompt--embedding-module)
11. [Module 6 — Publishing Module](#11-module-6--publishing-module)
12. [Module 7 — Analytics Module](#12-module-7--analytics-module)
13. [Complete Data Model](#13-complete-data-model)
14. [API Contracts](#14-api-contracts)
15. [State Machines & Workflows](#15-state-machines--workflows)
16. [UI Page Inventory & Navigation](#16-ui-page-inventory--navigation)
17. [Error Handling Taxonomy](#17-error-handling-taxonomy)
18. [Security Specification](#18-security-specification)
19. [Infrastructure & Deployment](#19-infrastructure--deployment)
20. [Observability & Monitoring](#20-observability--monitoring)
21. [Testing Strategy](#21-testing-strategy)
22. [Performance Budgets](#22-performance-budgets)
23. [Environment Variables Inventory](#23-environment-variables-inventory)
24. [MVP Scope & Phased Delivery](#24-mvp-scope--phased-delivery)
25. [Risk Register](#25-risk-register)
26. [Definition of Done](#26-definition-of-done)

---

## 1. Executive Summary

LaceStudio is an **internal production system** — not a SaaS product — built to create, manage, and commercially operate premium digital AI models (synthetic talent) for a digital modeling agency.

### Core Capabilities

| Capability              | Description                                                        |
| ----------------------- | ------------------------------------------------------------------ |
| **Identity Creation**   | Stable, versioned synthetic identities with LoRA weight management |
| **Image Generation**    | Editorial-grade batch image production via GPU compute             |
| **Campaign Management** | End-to-end workflow from concept to publishable asset              |
| **Social Publishing**   | Controlled scheduling and posting to Instagram                     |
| **Analytics**           | Engagement tracking with performance-informed iteration            |

### Success Metrics (Phase 1 — MVP)

| Metric                      | Target               | Measurement Method                                            |
| --------------------------- | -------------------- | ------------------------------------------------------------- |
| Models launched             | 1 fully operational  | Identity locked, publishing active                            |
| Visual identity consistency | ≥95%                 | Human QA pass rate on 20-image sample batches (see §6 AC-1.5) |
| Weekly editorial output     | 3–5 posts per model  | Publishing log count per 7-day window                         |
| Campaign production cycle   | ≤20 minutes          | Timestamp delta: campaign created → assets approved           |
| Image generation throughput | 12 images in ≤15 min | GPU service job duration metric                               |

---

## 2. Glossary & Definitions

| Term                          | Definition                                                                                                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AI Model**                  | A synthetic digital persona with a locked visual identity, not an ML model. Referred to as "model" in business context.                                                                                                               |
| **LoRA**                      | Low-Rank Adaptation weights that encode a specific model's visual identity for image generation.                                                                                                                                      |
| **LoRA Reference**            | A GCS URI pointing to the `.safetensors` file for a specific AI model version.                                                                                                                                                        |
| **Pose Pack**                 | A curated, named set of OpenPose/ControlNet reference images defining body positions and camera angles. Stored as a JSON manifest + image files in GCS.                                                                               |
| **Style Preset**              | A versioned configuration object defining lighting, lens, color, and mood parameters applied during image generation.                                                                                                                 |
| **Campaign**                  | A production unit: a collection of generated images for a specific model, preset, and (optionally) product, progressing through a defined lifecycle.                                                                                  |
| **Asset**                     | A single generated image file within a campaign, with associated metadata.                                                                                                                                                            |
| **Identity Consistency**      | The degree to which generated images match a model's canonical reference set. Measured via human QA scoring: a batch of 20 images is reviewed and each rated pass/fail against the canonical references. ≥95% pass rate = consistent. |
| **Imperfection Fingerprint**  | A JSON object describing intentional minor "flaws" (e.g., faint mole, slight asymmetry) that make a model appear realistic and recognizable.                                                                                          |
| **Canonical Seed References** | A curated set of 5–10 seed values + prompt combinations known to produce identity-accurate outputs for a given model. Used as validation benchmarks.                                                                                  |
| **Upscaling**                 | Post-generation resolution enhancement (e.g., 1024→2048 or 4096) via Real-ESRGAN or equivalent.                                                                                                                                       |
| **Operator**                  | Internal team member who uses the platform to create campaigns, review outputs, and manage publishing.                                                                                                                                |
| **Admin**                     | Internal team member with full system access including model identity management and infrastructure settings.                                                                                                                         |

---

## 3. System Architecture

### 3.1 High-Level Data Flow

```
┌─────────────────────────────────────────────────────┐
│                    FRONTEND                          │
│           Next.js App Router (Vercel)                │
│  ┌──────────┬──────────┬───────────┬──────────────┐  │
│  │ Identity │ Campaign │ Publish   │  Analytics   │  │
│  │ Manager  │ Builder  │ Scheduler │  Dashboard   │  │
│  └────┬─────┴────┬─────┴─────┬─────┴───────┬──────┘  │
└───────┼──────────┼───────────┼─────────────┼─────────┘
        │          │           │             │
        ▼          ▼           ▼             ▼
┌─────────────────────────────────────────────────────┐
│               API LAYER                              │
│     Next.js Server Actions + Route Handlers          │
│     (Auth middleware · Rate limiting · Validation)    │
└───────┬──────────┬───────────┬─────────────┬─────────┘
        │          │           │             │
        ▼          ▼           ▼             ▼
┌─────────────────────────────────────────────────────┐
│            ORCHESTRATION LAYER                        │
│                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │   Identity    │  │   Campaign   │  │  Publishing │  │
│  │   Service     │  │  Processor   │  │   Service   │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬─────┘  │
│         │                 │                  │         │
│         │    ┌────────────┴────────────┐     │         │
│         │    │  GPU Job Queue          │     │         │
│         │    │  (Supabase pgmq / cron) │     │         │
│         │    └────────────┬────────────┘     │         │
└─────────┼────────────────┼──────────────────┼─────────┘
          │                │                  │
          ▼                ▼                  ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
│   Supabase   │  │  GPU Service │  │  Instagram Graph  │
│   Postgres   │  │  (RunPod /   │  │     API           │
│  + pgvector  │  │   GCP VM)    │  │                   │
└──────┬───────┘  └──────┬───────┘  └──────────────────┘
       │                 │
       ▼                 ▼
┌─────────────────────────────┐
│   Google Cloud Storage      │
│  ┌───────────────────────┐  │
│  │ model-weights-private │  │
│  │ campaign-raw-private  │  │
│  │ campaign-approved-pub │  │
│  │ product-uploads       │  │
│  │ pose-packs            │  │
│  └───────────────────────┘  │
└─────────────────────────────┘
```

### 3.2 Request Flow — Image Generation

```
1. Operator creates campaign in UI
2. Server Action validates inputs → inserts campaign (status: DRAFT)
3. Operator clicks "Generate" → campaign moves to GENERATING
4. Route Handler constructs GPU payload → enqueues job
5. Job dispatcher sends POST to GPU service with signed callback URL
6. GPU service:
   a. Pulls LoRA weights from GCS (signed URL)
   b. Loads preset parameters
   c. Generates images in batch
   d. Runs upscaling pipeline
   e. Uploads results to GCS (campaign-raw-private)
   f. POSTs completion webhook to callback URL
7. Supabase Edge Function receives webhook:
   a. Validates HMAC signature
   b. Inserts asset records into DB
   c. Updates campaign status → REVIEW
8. Operator reviews in UI → approves/rejects individual assets
9. Approved assets copied to campaign-approved-public bucket
10. Campaign status → APPROVED (if ≥1 asset approved)
11. Operator schedules for publishing
```

### 3.3 Key Architectural Decisions

| Decision                   | Rationale                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| No monolithic backend      | Next.js route handlers + Supabase Edge Functions provide sufficient server-side logic; reduces infra cost and complexity |
| External GPU compute       | GPU needs are bursty; dedicated GPU VMs or RunPod serverless avoids idle cost                                            |
| Supabase over raw Postgres | Managed auth, RLS, realtime, Edge Functions, pgvector in one platform                                                    |
| Prisma ORM                 | Type-safe database access, migration management, schema versioning                                                       |
| GCS over Supabase Storage  | Higher storage limits, granular IAM, versioning, lifecycle policies, CDN                                                 |
| Webhook-based async        | Decouples GPU processing from request lifecycle; resilient to long jobs                                                  |

---

## 4. Technology Stack & Constraints

### 4.1 Frontend Stack

| Technology            | Version          | Purpose                                       |
| --------------------- | ---------------- | --------------------------------------------- |
| Next.js               | 16+ (App Router) | Full-stack framework                          |
| TypeScript            | 5.x              | Type safety                                   |
| Tailwind CSS          | 3.x              | Utility-first styling                         |
| React                 | 18+ (RSC)        | UI components with server components          |
| Zod                   | 3.x              | Runtime validation for forms and API payloads |
| SWR or TanStack Query | Latest           | Client-side data fetching/caching             |
| date-fns              | Latest           | Date manipulation for scheduling              |

**Deployment:** Vercel (Pro plan for cron jobs + Edge Functions)

### 4.2 Backend Stack

| Technology              | Purpose                            |
| ----------------------- | ---------------------------------- |
| Next.js Route Handlers  | REST API endpoints                 |
| Next.js Server Actions  | Form mutations, server-side logic  |
| Supabase Edge Functions | Webhook receivers, scheduled tasks |
| Prisma                  | ORM, migrations, type generation   |

### 4.3 Database

| Property   | Value                                                     |
| ---------- | --------------------------------------------------------- |
| Provider   | Supabase                                                  |
| Engine     | PostgreSQL 15+                                            |
| Extensions | `pgvector`, `uuid-ossp`, `pgcrypto`, `pg_cron`            |
| Connection | Pooled via Supabase connection pooler (PgBouncer)         |
| Backups    | Daily automated (Supabase managed) + manual pre-migration |

### 4.4 Storage — Google Cloud Storage

The app uses a GCP service account (from `GCS_SERVICE_ACCOUNT_KEY`). That account must have **Storage Object Creator** (or Object Admin) on each bucket the app writes to (e.g. `lacestudio-model-weights-private` for photo import and LoRA/canonical uploads). Without `storage.objects.create`, photo import and canonical uploads fail with a permission-denied error.

| Bucket                           | Access                               | Versioning | Lifecycle            | Purpose                           |
| -------------------------------- | ------------------------------------ | ---------- | -------------------- | --------------------------------- |
| `lacestudio-model-weights-private`    | Private (signed URLs)                | Enabled    | None (retain all)    | LoRA `.safetensors` files         |
| `lacestudio-campaign-raw-private`     | Private (signed URLs)                | Disabled   | Delete after 30 days | Raw generated images pre-approval |
| `lacestudio-campaign-approved-public` | Private (signed URLs for publishing) | Enabled    | None                 | Approved final assets             |
| `lacestudio-product-uploads`          | Private (signed URLs)                | Disabled   | Delete after 90 days | Product images for campaigns      |
| `lacestudio-pose-packs`               | Private (signed URLs)                | Enabled    | None                 | Pose reference images + manifests |

**File Naming Convention:**

```
{bucket}/{model_id}/{campaign_id}/{asset_id}_{resolution}_{seed}.{format}
Example: lacestudio-campaign-raw-private/m_abc123/c_def456/a_ghi789_2048x2048_42.webp
```

### 4.5 AI Compute Layer

| Property          | Specification                                                       |
| ----------------- | ------------------------------------------------------------------- |
| Primary Provider  | RunPod Serverless (preferred) or GCP A100 VM                        |
| Fallback Provider | GCP GPU VM (manual provisioning)                                    |
| Base Model        | SDXL 1.0 or FLUX.1 (configurable per model)                         |
| LoRA Loading      | Dynamic per-request from GCS                                        |
| ControlNet        | OpenPose for pose packs                                             |
| Upscaler          | Real-ESRGAN 4x                                                      |
| Output Format     | WebP (quality 95) for web; PNG for master                           |
| Max Batch Size    | 12 images per job                                                   |
| Timeout           | 20 minutes per job                                                  |
| Retry Policy      | 2 retries with exponential backoff (30s, 120s)                      |
| Cost Guardrail    | Monthly GPU budget cap configurable in admin settings; alert at 80% |

---

## 5. User Roles & Permissions

### 5.1 Role Definitions

| Role         | Description                                                                        | Auth Method                      |
| ------------ | ---------------------------------------------------------------------------------- | -------------------------------- |
| **Admin**    | Full system access. Manages models, infrastructure settings, user accounts.        | Supabase Auth (email + password) |
| **Operator** | Day-to-day production user. Creates campaigns, reviews assets, manages publishing. | Supabase Auth (email + password) |

### 5.2 Permission Matrix

| Action                        | Admin | Operator      |
| ----------------------------- | ----- | ------------- |
| Create/edit AI model identity | ✅    | ❌            |
| Upload/version LoRA weights   | ✅    | ❌            |
| Rollback model version        | ✅    | ❌            |
| Create/edit style presets     | ✅    | ✅            |
| Create campaigns              | ✅    | ✅            |
| Generate images               | ✅    | ✅            |
| Review & approve assets       | ✅    | ✅            |
| Schedule publishing           | ✅    | ✅            |
| Publish immediately           | ✅    | ❌            |
| View analytics                | ✅    | ✅            |
| Manage user accounts          | ✅    | ❌            |
| Configure GPU budget          | ✅    | ❌            |
| Access system settings        | ✅    | ❌            |
| Delete campaigns              | ✅    | ❌            |
| Delete assets                 | ✅    | ✅ (own only) |
| View audit log                | ✅    | ❌            |

### 5.3 Row-Level Security (RLS) Policy

- All database tables have RLS enabled.
- Operators can only read/write records where `created_by = auth.uid()` OR records explicitly shared (campaigns, assets).
- Admins bypass data-level restrictions via a Supabase `service_role` key used only in server-side contexts.
- Model identity tables (`ai_models`, `model_versions`) are admin-writable only.
- Presets are readable by all authenticated users; writable by the creator or admins.

---

## 6. Module 1 — Identity Manager

### 6.1 Purpose

Maintain strict, versioned visual identity consistency for each AI model. Prevent identity drift through version locking, canonical references, and controlled weight management.

### 6.2 User Stories

---

**US-1.1: Create a New AI Model**

> _As an Admin, I want to create a new AI model profile with identity parameters so that the system has a baseline identity to generate images against._

**Acceptance Criteria:**

- AC-1.1.1: Admin can fill a form with: name (required, 2–50 chars), description (optional, ≤500 chars), initial LoRA file upload (required, `.safetensors`, ≤2GB).
- AC-1.1.2: On submit, the system uploads the LoRA file to `lacestudio-model-weights-private/{model_id}/v1/weights.safetensors` and creates a `model_versions` record with `version=1`, `is_active=true`.
- AC-1.1.3: The model record is created with `status=DRAFT` until body/face profiles are completed.
- AC-1.1.4: The system generates a UUID for the model and returns the user to the model detail page.
- AC-1.1.5: Validation errors are displayed inline next to the relevant form field.

---

**US-1.2: Define Body & Face Profile**

> _As an Admin, I want to define body proportions and facial constraints for a model so that image generation produces physically consistent outputs._

**Acceptance Criteria:**

- AC-1.2.1: The model detail page exposes structured forms for body profile (height, build, skin_tone, hair_color, hair_length, hair_style, eye_color, distinguishing_features[]) and face profile (face_shape, jawline, nose_profile, lip_profile, brow_profile, eye_spacing, eye_shape, forehead_height, cheekbones).
- AC-1.2.2: Each field uses a constrained select or validated text input — no freeform for structured fields.
- AC-1.2.3: An "Imperfection Fingerprint" section allows adding up to 5 subtle features (type + location + intensity).
- AC-1.2.4: Saving the profile updates the `ai_models` record and logs the change in `audit_log`.
- AC-1.2.5: When both body and face profiles are complete, the model status transitions from `DRAFT` to `ACTIVE`.

---

**US-1.3: Upload New LoRA Version**

> _As an Admin, I want to upload a new LoRA weight file for an existing model so that I can refine the model's visual identity over time._

**Acceptance Criteria:**

- AC-1.3.1: The model detail page has a "Upload New Version" action (admin-only).
- AC-1.3.2: Upload accepts `.safetensors` files up to 2GB.
- AC-1.3.3: On upload, the system creates a new `model_versions` record with `version = previous + 1`, `is_active = false`.
- AC-1.3.4: The new version is NOT automatically activated. Admin must explicitly "Activate" the version.
- AC-1.3.5: Activating a version sets `is_active = true` on the new version and `is_active = false` on all others for that model.
- AC-1.3.6: All version history is retained and visible in a version list on the model detail page.

---

**US-1.4: Rollback to Previous Version**

> _As an Admin, I want to rollback a model to a previous LoRA version so that I can recover from a bad training result._

**Acceptance Criteria:**

- AC-1.4.1: The version list shows all versions with: version number, upload date, file size, active status.
- AC-1.4.2: Any non-active version has an "Activate" button.
- AC-1.4.3: Activating a previous version follows the same logic as US-1.3 AC-1.3.5.
- AC-1.4.4: A confirmation dialog warns: "This will change the active identity weights for {model_name}. All future generations will use version {n}."
- AC-1.4.5: The rollback is logged in `audit_log`.

---

**US-1.5: Manage Canonical Seed References**

> _As an Admin, I want to store canonical seed + prompt pairs for a model so that identity consistency can be validated against known-good outputs._

**Acceptance Criteria:**

- AC-1.5.1: The model detail page has a "Canonical References" section.
- AC-1.5.2: Admin can add up to 10 reference entries, each consisting of: seed (integer), prompt_text (string), reference_image_url (image upload), notes (optional).
- AC-1.5.3: Reference images are stored in `lacestudio-model-weights-private/{model_id}/canonical/`.
- AC-1.5.4: These references are displayed as a visual gallery on the model detail page.
- AC-1.5.5: Canonical references are included as context when constructing GPU payloads (metadata only, not sent as images to the GPU).

---

### 6.3 Data Schema

See [§13 Complete Data Model](#13-complete-data-model) — tables: `ai_models`, `model_versions`, `canonical_references`.

---

## 7. Module 2 — Style Preset Engine

### 7.1 Purpose

Provide reusable, versioned aesthetic configurations that ensure visual cohesion across campaigns. Presets encode lighting, lens simulation, color grading, and mood into a single selectable configuration.

### 7.2 User Stories

---

**US-2.1: Create a Style Preset**

> _As an Operator or Admin, I want to create a style preset so that I can define a reusable aesthetic for campaigns._

**Acceptance Criteria:**

- AC-2.1.1: The preset creation form includes the following structured sections:
  - **Lighting Profile:** key_light_direction (enum: front, 45-left, 45-right, 90-left, 90-right, back, top, bottom), key_light_intensity (0.0–1.0), fill_light (boolean), rim_light (boolean), ambient_type (enum: studio, natural, golden-hour, blue-hour, overcast, neon, dramatic)
  - **Lens Profile:** focal_length_mm (integer 24–200), aperture (enum: f/1.4, f/1.8, f/2.8, f/4, f/5.6, f/8, f/11), bokeh (boolean), lens_type (enum: prime, zoom, macro, tilt-shift)
  - **Color Palette:** primary_hue (hex), secondary_hue (hex), accent_hue (hex), saturation (0.0–1.0), warmth (-1.0 to 1.0)
  - **Grading Curve:** shadows (dark, neutral, lifted), midtones (enum: warm, cool, neutral), highlights (enum: warm, cool, blown)
  - **Mood Tag:** string, 1–3 words (e.g., "editorial luxury", "street raw")
  - **Camera Simulation:** camera_body (optional string, e.g., "Hasselblad X2D"), film_stock (optional string, e.g., "Kodak Portra 400")
- AC-2.1.2: The preset is saved with `version = 1`.
- AC-2.1.3: The creator is recorded as `created_by`.
- AC-2.1.4: A preview description is auto-generated from the parameters for quick scanning.

---

**US-2.2: Edit a Style Preset (Non-Destructive)**

> _As an Operator or Admin, I want to edit a preset without breaking campaigns that used the previous version._

**Acceptance Criteria:**

- AC-2.2.1: Editing a preset creates a new version (version = previous + 1).
- AC-2.2.2: Existing campaigns reference the specific preset version they were created with (foreign key to `preset_versions`).
- AC-2.2.3: The preset list shows the latest version by default with a "version history" expandable section.
- AC-2.2.4: Previous versions are read-only.

---

**US-2.3: Browse & Select Presets**

> _As an Operator, I want to browse available presets with visual summaries so that I can quickly select the right aesthetic for a campaign._

**Acceptance Criteria:**

- AC-2.3.1: The preset library displays a card grid with: name, mood tag, color palette preview (3 color swatches), lighting summary, last used date.
- AC-2.3.2: Presets are filterable by mood_tag and sortable by name, date created, last used.
- AC-2.3.3: Clicking a preset card opens a detail view with all parameters.

---

### 7.3 Data Schema

See [§13 Complete Data Model](#13-complete-data-model) — tables: `presets`, `preset_versions`.

---

## 8. Module 3 — Campaign Builder

### 8.1 Purpose

Provide a structured, step-by-step workflow for creating image generation campaigns — from model/preset selection through generation, review, approval, and scheduling.

### 8.2 Campaign Lifecycle

```
DRAFT → GENERATING → REVIEW → APPROVED → SCHEDULED → PUBLISHED
                       ↓                      ↓
                    REJECTED              FAILED
                       ↓
                    DRAFT (re-edit)
```

See [§15 State Machines](#15-state-machines--workflows) for full transition rules.

### 8.3 User Stories

---

**US-3.1: Create a Campaign (Step-by-Step Wizard)**

> _As an Operator, I want to create a campaign through a guided wizard so that I don't miss any required inputs._

**Acceptance Criteria:**

- AC-3.1.1: The campaign wizard has the following steps:
  1. **Select Model** — Choose from active AI models (displays name + thumbnail). Only models with `status=ACTIVE` are shown.
  2. **Select Preset** — Choose from preset library (latest version used by default). Displays preset cards with visual summaries.
  3. **Product (Optional)** — Upload a product image (JPEG/PNG/WebP, ≤10MB) or skip. Product image stored in `lacestudio-product-uploads`.
  4. **Pose Pack** — Select from available pose packs for the chosen model. Displays pack name + thumbnail grid of poses.
  5. **Generation Settings** — Batch size (1–12, default 8), resolution (1024x1024, 1024x1536, 1536x1024), upscale (boolean, default true), negative prompt additions (optional textarea), custom prompt additions (optional textarea).
  6. **Review & Confirm** — Summary of all selections. Edit button per section to go back.
- AC-3.1.2: On confirm, the campaign is created with `status=DRAFT`.
- AC-3.1.3: The system generates a prompt based on: model body/face profile, preset parameters, pose pack context, product description (if any), user additions.
- AC-3.1.4: The generated prompt is shown to the operator for review/edit before generation begins.
- AC-3.1.5: Campaign name auto-generated as `{model_name}_{preset_mood}_{YYYYMMDD}_{sequence}` but is editable.

---

**US-3.2: Trigger Image Generation**

> _As an Operator, I want to start batch image generation for a campaign so that assets are produced for review._

**Acceptance Criteria:**

- AC-3.2.1: The campaign detail page has a "Generate" button (active only when `status=DRAFT`).
- AC-3.2.2: Clicking "Generate" transitions the campaign to `GENERATING` and dispatches a GPU job.
- AC-3.2.3: During generation, the UI shows: a progress indicator, estimated time remaining (based on batch size × average generation time), the ability to navigate away without cancelling the job.
- AC-3.2.4: If the GPU service returns an error, the campaign transitions to `DRAFT` with an error message stored in `campaign.error_message`.
- AC-3.2.5: On successful completion (webhook received), the campaign transitions to `REVIEW`.
- AC-3.2.6: The system blocks generation if the monthly GPU budget is ≥100% utilized (displays warning at ≥80%).

---

**US-3.3: Review & Approve Assets**

> _As an Operator, I want to review generated images individually and approve or reject each one so that only quality-passing images proceed to publishing._

**Acceptance Criteria:**

- AC-3.3.1: The review UI presents a grid of generated images as cards.
- AC-3.3.2: Each card shows: the image (zoomable), generation seed, sequence number.
- AC-3.3.3: Each card has: "Approve" button (green), "Reject" button (red), "Favorite" toggle (star).
- AC-3.3.4: Approved assets are copied from `campaign-raw-private` to `campaign-approved-public` bucket with format variants generated:
  - 1:1 (1080x1080) — Feed
  - 4:5 (1080x1350) — Feed/Ads
  - 9:16 (1080x1920) — Story
  - Master (original resolution)
- AC-3.3.5: When at least 1 asset is approved and the operator clicks "Finalize Review", the campaign transitions to `APPROVED`.
- AC-3.3.6: If all assets are rejected, the campaign transitions to `REJECTED`, and the operator can regenerate (returns to `DRAFT`).
- AC-3.3.7: Rejected assets are marked `status=REJECTED` but retained in the raw bucket for 30 days (lifecycle policy).

---

**US-3.4: Export Assets**

> _As an Operator, I want to download approved assets in specific formats so that I can use them outside the platform._

**Acceptance Criteria:**

- AC-3.4.1: Each approved asset has a download button with format selection: 1:1, 4:5, 9:16, Master.
- AC-3.4.2: A "Download All" action on the campaign generates a ZIP of all approved assets in the selected format.
- AC-3.4.3: Download URLs are time-limited signed URLs (expiry: 1 hour).

---

### 8.4 Pose Pack Sub-System

**Definition:** A pose pack is a named collection of ControlNet/OpenPose reference images.

**Structure:**

```json
{
  "id": "uuid",
  "name": "Editorial Standing — Set A",
  "description": "Full-body standing poses, fashion editorial style",
  "model_compatibility": ["all"] | ["model_id_1", "model_id_2"],
  "poses": [
    {
      "pose_id": "uuid",
      "name": "Standing 3/4 Turn",
      "openpose_url": "gs://lacestudio-pose-packs/{pack_id}/pose_001.png",
      "thumbnail_url": "gs://lacestudio-pose-packs/{pack_id}/thumb_001.webp",
      "camera_angle": "eye-level",
      "framing": "full-body"
    }
  ],
  "created_at": "ISO-8601",
  "created_by": "user_id"
}
```

**Management:**

- Admin can create/edit/delete pose packs via a dedicated UI section.
- Pose packs are stored in the `lacestudio-pose-packs` bucket.
- Each campaign references a pose pack ID; the GPU service receives the individual pose image URLs.

---

## 9. Module 4 — Image Generation Service

### 9.1 Purpose

Orchestrate communication with the external GPU compute layer. Manage job dispatching, status tracking, retries, and result ingestion.

### 9.2 User Stories

---

**US-4.1: Dispatch a Generation Job**

> _As the system, I want to dispatch a properly formed payload to the GPU service when a campaign generation is triggered so that images are produced asynchronously._

**Acceptance Criteria:**

- AC-4.1.1: The system constructs the following payload:
  ```json
  {
    "job_id": "uuid",
    "callback_url": "https://{domain}/api/webhooks/gpu-complete",
    "callback_secret": "HMAC-shared-secret",
    "model_config": {
      "base_model": "sdxl-1.0",
      "lora_url": "signed-gcs-url-to-safetensors",
      "lora_strength": 0.8
    },
    "generation_params": {
      "prompt": "constructed-prompt-string",
      "negative_prompt": "constructed-negative-prompt",
      "seed": [42, 84, 126, ...],
      "steps": 30,
      "cfg_scale": 7.5,
      "width": 1024,
      "height": 1024,
      "batch_size": 8,
      "scheduler": "DPM++ 2M Karras"
    },
    "controlnet": {
      "model": "openpose",
      "images": ["signed-url-1", "signed-url-2"],
      "strength": 0.6
    },
    "upscale": {
      "enabled": true,
      "model": "real-esrgan-4x",
      "target_resolution": 2048
    },
    "output": {
      "format": "webp",
      "quality": 95,
      "bucket": "lacestudio-campaign-raw-private",
      "path_prefix": "{model_id}/{campaign_id}/"
    }
  }
  ```
- AC-4.1.2: The LoRA signed URL expires after 30 minutes.
- AC-4.1.3: Seeds are either taken from the operator's input or auto-generated as deterministic sequence from a random base seed (recorded on the campaign).
- AC-4.1.4: The job is recorded in the `generation_jobs` table with `status=DISPATCHED`.
- AC-4.1.5: If the GPU service returns a non-2xx response, the system retries per the retry policy (2 retries, exponential backoff). After exhaustion, `job.status = FAILED`, `campaign.status = DRAFT`, `campaign.error_message` is set.

---

**US-4.2: Receive Generation Completion Webhook**

> _As the system, I want to securely receive and process completion webhooks from the GPU service so that generated assets are ingested into the platform._

**Acceptance Criteria:**

- AC-4.2.1: The webhook endpoint is `POST /api/webhooks/gpu-complete`.
- AC-4.2.2: The request must include an `X-Webhook-Signature` header containing `HMAC-SHA256(request_body, shared_secret)`.
- AC-4.2.3: If HMAC validation fails, return `401 Unauthorized` and log the attempt.
- AC-4.2.4: Expected webhook payload:
  ```json
  {
    "job_id": "uuid",
    "status": "completed" | "failed",
    "error_message": "string (if failed)",
    "assets": [
      {
        "file_path": "gs://bucket/path/to/image.webp",
        "seed": 42,
        "width": 2048,
        "height": 2048,
        "generation_time_ms": 12500,
        "prompt_text": "the prompt used"
      }
    ],
    "total_generation_time_ms": 180000,
    "gpu_type": "A100-80GB"
  }
  ```
- AC-4.2.5: On success: insert one `assets` record per image, update `generation_jobs.status = COMPLETED`, update `campaign.status = REVIEW`.
- AC-4.2.6: On failure: update `generation_jobs.status = FAILED`, optionally retry per policy, or update `campaign.status = DRAFT` with error.
- AC-4.2.7: GPU cost is estimated from `total_generation_time_ms × rate_per_ms` and recorded on the job record. Monthly spend is aggregated for budget tracking.

---

**US-4.3: Monitor Job Status**

> _As an Operator, I want to see the status of active generation jobs so that I know when results are ready._

**Acceptance Criteria:**

- AC-4.3.1: The campaign detail page shows job status: DISPATCHED, IN_PROGRESS, COMPLETED, FAILED.
- AC-4.3.2: A global "Active Jobs" indicator in the navigation shows the count of running jobs.
- AC-4.3.3: If a job has been running for >20 minutes, it is flagged as "Stale" in the UI with a "Retry" option.

---

### 9.3 Data Schema

See [§13 Complete Data Model](#13-complete-data-model) — tables: `generation_jobs`.

---

## 10. Module 5 — Prompt & Embedding Module

### 10.1 Purpose

Track prompt history, generate vector embeddings for semantic analysis, and enable similarity search to improve future campaign quality.

### 10.2 User Stories

---

**US-5.1: Auto-Embed Prompts on Asset Creation**

> _As the system, I want to automatically generate and store a vector embedding for every prompt used in image generation so that semantic search is available._

**Acceptance Criteria:**

- AC-5.1.1: When an asset record is created (via webhook), the system queues an embedding generation task.
- AC-5.1.2: The embedding is generated using OpenAI `text-embedding-3-small` (1536 dimensions) or equivalent.
- AC-5.1.3: The embedding is stored in the `prompt_embeddings` table linked to the `asset_id` and `campaign_id`.
- AC-5.1.4: Embedding failure is non-blocking — it is logged and retried via a background job.

---

**US-5.2: Search Similar Prompts**

> _As an Operator, I want to search for prompts similar to a text query so that I can find high-performing prompt patterns._

**Acceptance Criteria:**

- AC-5.2.1: The prompt library UI has a search bar accepting natural language text.
- AC-5.2.2: On search, the input is embedded and a cosine similarity search is performed against `prompt_embeddings` using pgvector's `<=>` operator.
- AC-5.2.3: Results are ranked by similarity and displayed with: prompt text, campaign name, asset thumbnail, engagement score (if published).
- AC-5.2.4: Results are filterable by model, date range, minimum engagement score.
- AC-5.2.5: The operator can "Use as template" to pre-fill a new campaign prompt.

---

**US-5.3: Detect Prompt Repetition**

> _As the system, I want to warn the operator when a new campaign prompt is very similar to a recent prompt so that content variety is maintained._

**Acceptance Criteria:**

- AC-5.3.1: During campaign creation (step 6 — review), the system performs a similarity search against prompts from the same model in the last 30 days.
- AC-5.3.2: If a prompt with cosine similarity ≥0.92 is found, a warning is displayed: "This prompt is very similar to one used on {date} in campaign {name}."
- AC-5.3.3: The warning is advisory only — the operator can proceed.

---

### 10.3 Data Schema

See [§13 Complete Data Model](#13-complete-data-model) — table: `prompt_embeddings`.

---

## 11. Module 6 — Publishing Module

### 11.1 Purpose

Manage the scheduling, execution, and tracking of social media posts to Instagram via the Graph API, with draft approval and compliance safeguards.

### 11.2 User Stories

---

**US-6.1: Schedule a Post**

> _As an Operator, I want to schedule an approved asset for publishing at a specific date/time so that content is posted consistently._

**Acceptance Criteria:**

- AC-6.1.1: From an approved campaign's asset list, the operator can select one or more approved assets and click "Schedule."
- AC-6.1.2: The scheduling form includes: date/time picker (minimum 15 minutes in the future), caption text (required, ≤2200 chars), hashtag preset selector (optional), post type (Feed Photo, Story, Reel placeholder), format auto-selected based on post type (1:1 or 4:5 for Feed, 9:16 for Story).
- AC-6.1.3: On confirm, a `publishing_queue` record is created with `status = SCHEDULED`.
- AC-6.1.4: Scheduled posts appear on a calendar view and a list view in the publishing section.
- AC-6.1.5: All times are displayed in the operator's local timezone but stored as UTC.

---

**US-6.2: Manage Hashtag Presets**

> _As an Operator, I want to save and reuse hashtag sets so that I don't retype them for every post._

**Acceptance Criteria:**

- AC-6.2.1: The publishing settings section has a "Hashtag Presets" manager.
- AC-6.2.2: Each preset has: name, hashtags (array of strings, max 30 per Instagram rules).
- AC-6.2.3: Presets are selectable during post scheduling and auto-appended to the caption.
- AC-6.2.4: Hashtags count toward the 2200-char caption limit; the UI shows remaining characters.

---

**US-6.3: Execute Scheduled Posts**

> _As the system, I want to automatically publish posts at their scheduled time via the Instagram Graph API._

**Acceptance Criteria:**

- AC-6.3.1: A Supabase cron job runs every 5 minutes checking for `publishing_queue` records where `scheduled_at ≤ NOW()` and `status = SCHEDULED`.
- AC-6.3.2: For each due post:
  1. Fetch the asset's signed URL from GCS (1-hour expiry).
  2. Create a media container via `POST /v18.0/{ig-user-id}/media` with `image_url` and `caption`.
  3. Publish the container via `POST /v18.0/{ig-user-id}/media_publish`.
  4. Store the returned `ig_media_id` on the publishing record.
  5. Update `status = PUBLISHED`, `published_at = NOW()`.
- AC-6.3.3: If the Instagram API returns an error:
  - Rate limit (429): Update `status = RETRY`, `retry_after = response.retry_after`, increment `retry_count`.
  - Auth error (401/403): Update `status = FAILED`, alert admin.
  - Other error: Update `status = FAILED`, log full error response.
- AC-6.3.4: Maximum retry count: 3. After 3 failures, `status = FAILED` permanently.
- AC-6.3.5: Rate limiting: maximum 25 API calls per hour (well under Instagram's limits).
- AC-6.3.6: A publishing log records every API call with request/response metadata for debugging.

---

**US-6.4: Draft Approval Gate**

> _As an Admin, I want to require approval before any post is scheduled so that nothing goes live without review._

**Acceptance Criteria:**

- AC-6.4.1: A global setting `require_publishing_approval` (boolean, default: true) exists in system settings.
- AC-6.4.2: When enabled, scheduling a post creates the record with `status = PENDING_APPROVAL`.
- AC-6.4.3: Admin sees pending posts in a dedicated "Approval Queue" section.
- AC-6.4.4: Admin can approve (moves to `SCHEDULED`) or reject (moves to `REJECTED` with rejection reason).
- AC-6.4.5: The operator is shown the post status; rejected posts show the rejection reason.

---

### 11.3 Instagram Graph API Integration Details

| Property                | Value                                                                   |
| ----------------------- | ----------------------------------------------------------------------- |
| API Version             | v18.0+ (latest stable)                                                  |
| Auth                    | Long-lived page access token (refreshed every 60 days via cron)         |
| Permissions             | `instagram_basic`, `instagram_content_publish`, `pages_read_engagement` |
| Content Types (Phase 1) | Single image Feed posts, Stories                                        |
| Content Types (Phase 2) | Carousels, Reels                                                        |
| Rate Safety Margin      | Use ≤50% of published rate limits                                       |

### 11.4 Data Schema

See [§13 Complete Data Model](#13-complete-data-model) — tables: `publishing_queue`, `publishing_logs`, `hashtag_presets`.

---

## 12. Module 7 — Analytics Module

### 12.1 Purpose

Ingest, store, and display engagement metrics from Instagram to inform content strategy and enable performance-based iteration.

### 12.2 User Stories

---

**US-7.1: Ingest Post Analytics**

> _As the system, I want to automatically fetch engagement metrics for published posts so that performance data is always current._

**Acceptance Criteria:**

- AC-7.1.1: A Supabase cron job runs every 6 hours, querying the Instagram Graph API for metrics on all posts published in the last 90 days.
- AC-7.1.2: Metrics fetched per post: `impressions`, `reach`, `engagement` (likes + comments + saves + shares), `saves`, `comments_count`, `likes_count`, `shares_count`.
- AC-7.1.3: Each fetch creates a new `analytics_snapshots` record (append-only, time-series).
- AC-7.1.4: The system calculates derived metrics: `engagement_rate = engagement / reach * 100`.
- AC-7.1.5: Stale data warning: if the last snapshot for a post is >24 hours old, the dashboard flags it.

---

**US-7.2: View Analytics Dashboard**

> _As an Operator, I want to see a dashboard of post performance metrics so that I can evaluate content effectiveness._

**Acceptance Criteria:**

- AC-7.2.1: The dashboard displays:
  - **Top-level KPIs:** Total reach (30d), Average engagement rate (30d), Total posts published (30d), Top-performing post.
  - **Per-model breakdown:** Reach, engagement rate, post count.
  - **Post list:** Sortable/filterable table of published posts with: thumbnail, date, reach, engagement rate, saves, comments.
  - **Trend chart:** Engagement rate over time (last 90 days), line chart.
- AC-7.2.2: Filters: model selector, date range picker, post type.
- AC-7.2.3: Data refreshes on page load (SWR/TanStack Query with stale-while-revalidate).

---

**US-7.3: Link Analytics to Campaign Parameters**

> _As an Operator, I want to see which preset and generation parameters were used for high-performing posts so that I can replicate success._

**Acceptance Criteria:**

- AC-7.3.1: Each post in the analytics table links back to its campaign.
- AC-7.3.2: The campaign detail page shows aggregate analytics for all published assets from that campaign.
- AC-7.3.3: The preset detail page shows average engagement rate across all campaigns that used it.

---

### 12.3 Data Schema

See [§13 Complete Data Model](#13-complete-data-model) — table: `analytics_snapshots`.

---

## 13. Complete Data Model

### 13.1 Entity Relationship Overview

```
users ──1:M──> ai_models (created_by)
users ──1:M──> campaigns (created_by)
users ──1:M──> presets (created_by)

ai_models ──1:M──> model_versions
ai_models ──1:M──> canonical_references
ai_models ──1:M──> campaigns

presets ──1:M──> preset_versions
preset_versions ──1:M──> campaigns

campaigns ──1:M──> assets
campaigns ──1:M──> generation_jobs
campaigns ──1:1──> prompt_embeddings (via assets)

assets ──1:1──> prompt_embeddings
assets ──1:M──> publishing_queue
assets ──1:M──> asset_variants

publishing_queue ──1:M──> publishing_logs
publishing_queue ──1:M──> analytics_snapshots

ai_models ──M:M──> pose_packs (via pose_pack_models)
```

### 13.2 Table Definitions

#### `users`

| Column       | Type         | Constraints                                     | Description           |
| ------------ | ------------ | ----------------------------------------------- | --------------------- |
| id           | UUID         | PK, DEFAULT uuid_generate_v4()                  | User identifier       |
| email        | VARCHAR(255) | UNIQUE, NOT NULL                                | Login email           |
| role         | VARCHAR(20)  | NOT NULL, CHECK (role IN ('admin', 'operator')) | User role             |
| display_name | VARCHAR(100) | NOT NULL                                        | Display name          |
| created_at   | TIMESTAMPTZ  | NOT NULL, DEFAULT NOW()                         | Account creation time |
| updated_at   | TIMESTAMPTZ  | NOT NULL, DEFAULT NOW()                         | Last update time      |

_Note: Auth managed via Supabase Auth. This table extends `auth.users` via a trigger on signup._

---

#### `ai_models`

| Column                   | Type        | Constraints                                                                  | Description                                     |
| ------------------------ | ----------- | ---------------------------------------------------------------------------- | ----------------------------------------------- |
| id                       | UUID        | PK, DEFAULT uuid_generate_v4()                                               | Model identifier                                |
| name                     | VARCHAR(50) | NOT NULL, UNIQUE                                                             | Model display name                              |
| description              | TEXT        |                                                                              | Model description                               |
| status                   | VARCHAR(20) | NOT NULL, DEFAULT 'DRAFT', CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')) | Model lifecycle status                          |
| body_profile             | JSONB       |                                                                              | Structured body proportions (see §6 AC-1.2.1)   |
| face_profile             | JSONB       |                                                                              | Structured facial constraints (see §6 AC-1.2.1) |
| imperfection_fingerprint | JSONB       |                                                                              | Array of {type, location, intensity}            |
| active_version_id        | UUID        | FK → model_versions.id                                                       | Currently active LoRA version                   |
| created_by               | UUID        | FK → users.id, NOT NULL                                                      | Creator                                         |
| created_at               | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()                                                      |                                                 |
| updated_at               | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()                                                      |                                                 |

**Indexes:** `idx_ai_models_status` on (status), `idx_ai_models_created_by` on (created_by)

---

#### `model_versions`

| Column          | Type         | Constraints                    | Description                        |
| --------------- | ------------ | ------------------------------ | ---------------------------------- |
| id              | UUID         | PK, DEFAULT uuid_generate_v4() | Version identifier                 |
| model_id        | UUID         | FK → ai_models.id, NOT NULL    | Parent model                       |
| version         | INTEGER      | NOT NULL                       | Sequential version number          |
| lora_gcs_uri    | TEXT         | NOT NULL                       | GCS URI to `.safetensors` file     |
| lora_strength   | DECIMAL(3,2) | NOT NULL, DEFAULT 0.80         | Default LoRA application strength  |
| file_size_bytes | BIGINT       |                                | LoRA file size                     |
| is_active       | BOOLEAN      | NOT NULL, DEFAULT false        | Whether this is the active version |
| notes           | TEXT         |                                | Version notes                      |
| uploaded_by     | UUID         | FK → users.id, NOT NULL        | Uploader                           |
| created_at      | TIMESTAMPTZ  | NOT NULL, DEFAULT NOW()        |                                    |

**Indexes:** `idx_model_versions_model_id` on (model_id), UNIQUE on (model_id, version)

---

#### `canonical_references`

| Column              | Type        | Constraints                    | Description                |
| ------------------- | ----------- | ------------------------------ | -------------------------- |
| id                  | UUID        | PK, DEFAULT uuid_generate_v4() | Reference identifier       |
| model_id            | UUID        | FK → ai_models.id, NOT NULL    | Parent model               |
| seed                | INTEGER     | NOT NULL                       | Generation seed            |
| prompt_text         | TEXT        | NOT NULL                       | Prompt used                |
| reference_image_url | TEXT        | NOT NULL                       | GCS URI to reference image |
| notes               | TEXT        |                                | Optional notes             |
| sort_order          | INTEGER     | NOT NULL, DEFAULT 0            | Display ordering           |
| created_at          | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()        |                            |

**Indexes:** `idx_canonical_refs_model_id` on (model_id)

---

#### `presets`

| Column             | Type         | Constraints                    | Description           |
| ------------------ | ------------ | ------------------------------ | --------------------- |
| id                 | UUID         | PK, DEFAULT uuid_generate_v4() | Preset identifier     |
| name               | VARCHAR(100) | NOT NULL                       | Preset display name   |
| mood_tag           | VARCHAR(50)  |                                | Short mood descriptor |
| current_version_id | UUID         | FK → preset_versions.id        | Latest active version |
| created_by         | UUID         | FK → users.id, NOT NULL        | Creator               |
| created_at         | TIMESTAMPTZ  | NOT NULL, DEFAULT NOW()        |                       |
| updated_at         | TIMESTAMPTZ  | NOT NULL, DEFAULT NOW()        |                       |

**Indexes:** `idx_presets_created_by` on (created_by)

---

#### `preset_versions`

| Column            | Type        | Constraints                    | Description                                   |
| ----------------- | ----------- | ------------------------------ | --------------------------------------------- |
| id                | UUID        | PK, DEFAULT uuid_generate_v4() | Version identifier                            |
| preset_id         | UUID        | FK → presets.id, NOT NULL      | Parent preset                                 |
| version           | INTEGER     | NOT NULL                       | Sequential version number                     |
| lighting_profile  | JSONB       | NOT NULL                       | Lighting parameters                           |
| lens_profile      | JSONB       | NOT NULL                       | Lens parameters                               |
| color_palette     | JSONB       | NOT NULL                       | Color parameters                              |
| grading_curve     | JSONB       | NOT NULL                       | Grading parameters                            |
| camera_simulation | JSONB       |                                | Camera/film simulation                        |
| prompt_fragment   | TEXT        |                                | Auto-generated prompt text from preset params |
| created_at        | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()        |                                               |

**Indexes:** UNIQUE on (preset_id, version)

---

#### `pose_packs`

| Column        | Type         | Constraints                    | Description                      |
| ------------- | ------------ | ------------------------------ | -------------------------------- |
| id            | UUID         | PK, DEFAULT uuid_generate_v4() | Pack identifier                  |
| name          | VARCHAR(100) | NOT NULL                       | Pack display name                |
| description   | TEXT         |                                | Pack description                 |
| manifest      | JSONB        | NOT NULL                       | Array of pose objects (see §8.4) |
| compatibility | VARCHAR(10)  | NOT NULL, DEFAULT 'all'        | 'all' or 'specific'              |
| created_by    | UUID         | FK → users.id, NOT NULL        | Creator                          |
| created_at    | TIMESTAMPTZ  | NOT NULL, DEFAULT NOW()        |                                  |
| updated_at    | TIMESTAMPTZ  | NOT NULL, DEFAULT NOW()        |                                  |

---

#### `pose_pack_models`

_Junction table for specific model compatibility._

| Column       | Type | Constraints                  | Description |
| ------------ | ---- | ---------------------------- | ----------- |
| pose_pack_id | UUID | FK → pose_packs.id, NOT NULL |             |
| model_id     | UUID | FK → ai_models.id, NOT NULL  |             |

**PK:** (pose_pack_id, model_id)

---

#### `campaigns`

| Column                  | Type         | Constraints                                                                                                                         | Description                          |
| ----------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| id                      | UUID         | PK, DEFAULT uuid_generate_v4()                                                                                                      | Campaign identifier                  |
| name                    | VARCHAR(200) | NOT NULL                                                                                                                            | Campaign display name                |
| model_id                | UUID         | FK → ai_models.id, NOT NULL                                                                                                         | Target AI model                      |
| preset_version_id       | UUID         | FK → preset_versions.id, NOT NULL                                                                                                   | Preset version used                  |
| pose_pack_id            | UUID         | FK → pose_packs.id                                                                                                                  | Selected pose pack                   |
| product_asset_url       | TEXT         |                                                                                                                                     | GCS URI to product image             |
| status                  | VARCHAR(20)  | NOT NULL, DEFAULT 'DRAFT', CHECK (status IN ('DRAFT','GENERATING','REVIEW','APPROVED','REJECTED','SCHEDULED','PUBLISHED','FAILED')) | Campaign lifecycle status            |
| batch_size              | INTEGER      | NOT NULL, CHECK (batch_size BETWEEN 1 AND 12)                                                                                       | Number of images to generate         |
| resolution_width        | INTEGER      | NOT NULL, DEFAULT 1024                                                                                                              | Output width                         |
| resolution_height       | INTEGER      | NOT NULL, DEFAULT 1024                                                                                                              | Output height                        |
| upscale                 | BOOLEAN      | NOT NULL, DEFAULT true                                                                                                              | Whether to upscale outputs           |
| prompt_text             | TEXT         |                                                                                                                                     | Final constructed prompt             |
| negative_prompt         | TEXT         |                                                                                                                                     | Negative prompt                      |
| custom_prompt_additions | TEXT         |                                                                                                                                     | Operator's custom prompt text        |
| base_seed               | INTEGER      |                                                                                                                                     | Base seed for deterministic sequence |
| error_message           | TEXT         |                                                                                                                                     | Last error message if failed         |
| created_by              | UUID         | FK → users.id, NOT NULL                                                                                                             | Creator                              |
| created_at              | TIMESTAMPTZ  | NOT NULL, DEFAULT NOW()                                                                                                             |                                      |
| updated_at              | TIMESTAMPTZ  | NOT NULL, DEFAULT NOW()                                                                                                             |                                      |

**Indexes:** `idx_campaigns_model_id` on (model_id), `idx_campaigns_status` on (status), `idx_campaigns_created_by` on (created_by), `idx_campaigns_created_at` on (created_at DESC)

---

#### `generation_jobs`

| Column             | Type          | Constraints                                                                                                     | Description                           |
| ------------------ | ------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| id                 | UUID          | PK, DEFAULT uuid_generate_v4()                                                                                  | Job identifier                        |
| campaign_id        | UUID          | FK → campaigns.id, NOT NULL                                                                                     | Parent campaign                       |
| status             | VARCHAR(20)   | NOT NULL, DEFAULT 'DISPATCHED', CHECK (status IN ('DISPATCHED','IN_PROGRESS','COMPLETED','FAILED','TIMED_OUT')) | Job status                            |
| gpu_provider       | VARCHAR(50)   |                                                                                                                 | Provider name (e.g., 'runpod', 'gcp') |
| gpu_type           | VARCHAR(50)   |                                                                                                                 | GPU hardware type                     |
| payload            | JSONB         | NOT NULL                                                                                                        | Full dispatched payload               |
| response_payload   | JSONB         |                                                                                                                 | Webhook response data                 |
| generation_time_ms | INTEGER       |                                                                                                                 | Total processing time                 |
| estimated_cost_usd | DECIMAL(10,4) |                                                                                                                 | Estimated GPU cost                    |
| retry_count        | INTEGER       | NOT NULL, DEFAULT 0                                                                                             | Retry attempts used                   |
| error_message      | TEXT          |                                                                                                                 | Error details                         |
| dispatched_at      | TIMESTAMPTZ   | NOT NULL, DEFAULT NOW()                                                                                         |                                       |
| completed_at       | TIMESTAMPTZ   |                                                                                                                 |                                       |

**Indexes:** `idx_gen_jobs_campaign_id` on (campaign_id), `idx_gen_jobs_status` on (status)

---

#### `assets`

| Column             | Type        | Constraints                                                                      | Description                                 |
| ------------------ | ----------- | -------------------------------------------------------------------------------- | ------------------------------------------- |
| id                 | UUID        | PK, DEFAULT uuid_generate_v4()                                                   | Asset identifier                            |
| campaign_id        | UUID        | FK → campaigns.id, NOT NULL                                                      | Parent campaign                             |
| job_id             | UUID        | FK → generation_jobs.id, NOT NULL                                                | Source generation job                       |
| status             | VARCHAR(20) | NOT NULL, DEFAULT 'PENDING', CHECK (status IN ('PENDING','APPROVED','REJECTED')) | Review status                               |
| raw_gcs_uri        | TEXT        | NOT NULL                                                                         | GCS URI in raw bucket                       |
| approved_gcs_uri   | TEXT        |                                                                                  | GCS URI in approved bucket (after approval) |
| seed               | INTEGER     | NOT NULL                                                                         | Generation seed used                        |
| width              | INTEGER     | NOT NULL                                                                         | Image width (px)                            |
| height             | INTEGER     | NOT NULL                                                                         | Image height (px)                           |
| file_size_bytes    | BIGINT      |                                                                                  | File size                                   |
| prompt_text        | TEXT        | NOT NULL                                                                         | Exact prompt used                           |
| generation_time_ms | INTEGER     |                                                                                  | Individual generation time                  |
| sequence_number    | INTEGER     | NOT NULL                                                                         | Position in batch (1-based)                 |
| is_favorite        | BOOLEAN     | NOT NULL, DEFAULT false                                                          | Operator favorite flag                      |
| created_at         | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()                                                          |                                             |
| reviewed_at        | TIMESTAMPTZ |                                                                                  | When approved/rejected                      |

**Indexes:** `idx_assets_campaign_id` on (campaign_id), `idx_assets_status` on (status)

---

#### `asset_variants`

| Column          | Type        | Constraints                                                                    | Description        |
| --------------- | ----------- | ------------------------------------------------------------------------------ | ------------------ |
| id              | UUID        | PK, DEFAULT uuid_generate_v4()                                                 | Variant identifier |
| asset_id        | UUID        | FK → assets.id, NOT NULL                                                       | Parent asset       |
| format_type     | VARCHAR(20) | NOT NULL, CHECK (format_type IN ('feed_1x1','feed_4x5','story_9x16','master')) | Variant type       |
| gcs_uri         | TEXT        | NOT NULL                                                                       | GCS URI            |
| width           | INTEGER     | NOT NULL                                                                       | Variant width      |
| height          | INTEGER     | NOT NULL                                                                       | Variant height     |
| file_size_bytes | BIGINT      |                                                                                | File size          |
| created_at      | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()                                                        |                    |

**Indexes:** `idx_asset_variants_asset_id` on (asset_id), UNIQUE on (asset_id, format_type)

---

#### `prompt_embeddings`

| Column          | Type         | Constraints                                | Description                              |
| --------------- | ------------ | ------------------------------------------ | ---------------------------------------- |
| id              | UUID         | PK, DEFAULT uuid_generate_v4()             | Embedding identifier                     |
| asset_id        | UUID         | FK → assets.id, UNIQUE                     | Source asset                             |
| campaign_id     | UUID         | FK → campaigns.id, NOT NULL                | Source campaign                          |
| model_id        | UUID         | FK → ai_models.id, NOT NULL                | AI model (denormalized for fast queries) |
| prompt_text     | TEXT         | NOT NULL                                   | Original prompt                          |
| embedding       | VECTOR(1536) | NOT NULL                                   | Vector embedding                         |
| embedding_model | VARCHAR(100) | NOT NULL, DEFAULT 'text-embedding-3-small' | Model used for embedding                 |
| created_at      | TIMESTAMPTZ  | NOT NULL, DEFAULT NOW()                    |                                          |

**Indexes:** `idx_prompt_embeddings_hnsw` HNSW on (embedding vector_cosine_ops), `idx_prompt_embeddings_model_id` on (model_id), `idx_prompt_embeddings_campaign_id` on (campaign_id)

---

#### `publishing_queue`

| Column            | Type         | Constraints                                                                                                                                        | Description                        |
| ----------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| id                | UUID         | PK, DEFAULT uuid_generate_v4()                                                                                                                     | Publishing record identifier       |
| asset_id          | UUID         | FK → assets.id, NOT NULL                                                                                                                           | Asset to publish                   |
| variant_type      | VARCHAR(20)  | NOT NULL                                                                                                                                           | Format variant to use              |
| platform          | VARCHAR(20)  | NOT NULL, DEFAULT 'instagram'                                                                                                                      | Target platform                    |
| post_type         | VARCHAR(20)  | NOT NULL, CHECK (post_type IN ('feed','story','reel'))                                                                                             | Instagram post type                |
| caption           | TEXT         | NOT NULL                                                                                                                                           | Post caption                       |
| hashtag_preset_id | UUID         | FK → hashtag_presets.id                                                                                                                            | Hashtag preset (if used)           |
| status            | VARCHAR(20)  | NOT NULL, DEFAULT 'SCHEDULED', CHECK (status IN ('PENDING_APPROVAL','SCHEDULED','PUBLISHING','PUBLISHED','RETRY','FAILED','REJECTED','CANCELLED')) | Queue status                       |
| scheduled_at      | TIMESTAMPTZ  | NOT NULL                                                                                                                                           | Planned publish time (UTC)         |
| published_at      | TIMESTAMPTZ  |                                                                                                                                                    | Actual publish time                |
| ig_media_id       | VARCHAR(100) |                                                                                                                                                    | Instagram media ID (after publish) |
| ig_container_id   | VARCHAR(100) |                                                                                                                                                    | Instagram container ID             |
| retry_count       | INTEGER      | NOT NULL, DEFAULT 0                                                                                                                                | Retry attempts                     |
| retry_after       | TIMESTAMPTZ  |                                                                                                                                                    | Earliest retry time                |
| rejection_reason  | TEXT         |                                                                                                                                                    | Admin rejection reason             |
| error_message     | TEXT         |                                                                                                                                                    | Last error                         |
| created_by        | UUID         | FK → users.id, NOT NULL                                                                                                                            | Scheduler                          |
| created_at        | TIMESTAMPTZ  | NOT NULL, DEFAULT NOW()                                                                                                                            |                                    |
| updated_at        | TIMESTAMPTZ  | NOT NULL, DEFAULT NOW()                                                                                                                            |                                    |

**Indexes:** `idx_pub_queue_status_scheduled` on (status, scheduled_at), `idx_pub_queue_asset_id` on (asset_id)

---

#### `publishing_logs`

| Column              | Type        | Constraints                        | Description                                                     |
| ------------------- | ----------- | ---------------------------------- | --------------------------------------------------------------- |
| id                  | UUID        | PK, DEFAULT uuid_generate_v4()     | Log identifier                                                  |
| publishing_queue_id | UUID        | FK → publishing_queue.id, NOT NULL | Parent publishing record                                        |
| action              | VARCHAR(50) | NOT NULL                           | Action performed (e.g., 'create_container', 'publish', 'retry') |
| request_payload     | JSONB       |                                    | API request (secrets redacted)                                  |
| response_payload    | JSONB       |                                    | API response                                                    |
| http_status         | INTEGER     |                                    | Response status code                                            |
| error_message       | TEXT        |                                    | Error details                                                   |
| created_at          | TIMESTAMPTZ | NOT NULL, DEFAULT NOW()            |                                                                 |

**Indexes:** `idx_pub_logs_queue_id` on (publishing_queue_id)

---

#### `hashtag_presets`

| Column     | Type         | Constraints                    | Description                          |
| ---------- | ------------ | ------------------------------ | ------------------------------------ |
| id         | UUID         | PK, DEFAULT uuid_generate_v4() | Preset identifier                    |
| name       | VARCHAR(100) | NOT NULL                       | Preset name                          |
| hashtags   | TEXT[]       | NOT NULL                       | Array of hashtag strings (without #) |
| created_by | UUID         | FK → users.id, NOT NULL        | Creator                              |
| created_at | TIMESTAMPTZ  | NOT NULL, DEFAULT NOW()        |                                      |
| updated_at | TIMESTAMPTZ  | NOT NULL, DEFAULT NOW()        |                                      |

---

#### `analytics_snapshots`

| Column              | Type         | Constraints                        | Description                       |
| ------------------- | ------------ | ---------------------------------- | --------------------------------- |
| id                  | UUID         | PK, DEFAULT uuid_generate_v4()     | Snapshot identifier               |
| publishing_queue_id | UUID         | FK → publishing_queue.id, NOT NULL | Published post                    |
| ig_media_id         | VARCHAR(100) | NOT NULL                           | Instagram media ID                |
| impressions         | INTEGER      | DEFAULT 0                          | Total impressions                 |
| reach               | INTEGER      | DEFAULT 0                          | Unique accounts reached           |
| likes_count         | INTEGER      | DEFAULT 0                          | Like count                        |
| comments_count      | INTEGER      | DEFAULT 0                          | Comment count                     |
| saves_count         | INTEGER      | DEFAULT 0                          | Save count                        |
| shares_count        | INTEGER      | DEFAULT 0                          | Share count                       |
| engagement_total    | INTEGER      | DEFAULT 0                          | likes + comments + saves + shares |
| engagement_rate     | DECIMAL(8,4) |                                    | engagement_total / reach \* 100   |
| fetched_at          | TIMESTAMPTZ  | NOT NULL, DEFAULT NOW()            | When this snapshot was captured   |

**Indexes:** `idx_analytics_pub_queue_id` on (publishing_queue_id), `idx_analytics_fetched_at` on (fetched_at DESC)

---

#### `audit_log`

| Column      | Type         | Constraints                    | Description                                  |
| ----------- | ------------ | ------------------------------ | -------------------------------------------- |
| id          | UUID         | PK, DEFAULT uuid_generate_v4() | Log entry identifier                         |
| user_id     | UUID         | FK → users.id                  | Actor (null for system actions)              |
| action      | VARCHAR(100) | NOT NULL                       | Action name (e.g., 'model.version.activate') |
| entity_type | VARCHAR(50)  | NOT NULL                       | Entity type affected                         |
| entity_id   | UUID         | NOT NULL                       | Entity ID affected                           |
| old_value   | JSONB        |                                | Previous state (for updates)                 |
| new_value   | JSONB        |                                | New state (for updates)                      |
| ip_address  | INET         |                                | Request IP                                   |
| created_at  | TIMESTAMPTZ  | NOT NULL, DEFAULT NOW()        |                                              |

**Indexes:** `idx_audit_entity` on (entity_type, entity_id), `idx_audit_created_at` on (created_at DESC)

---

#### `system_settings`

| Column     | Type         | Constraints             | Description   |
| ---------- | ------------ | ----------------------- | ------------- |
| key        | VARCHAR(100) | PK                      | Setting key   |
| value      | JSONB        | NOT NULL                | Setting value |
| updated_by | UUID         | FK → users.id           | Last updater  |
| updated_at | TIMESTAMPTZ  | NOT NULL, DEFAULT NOW() |               |

**Initial Settings:**

| Key                             | Default Value | Description                          |
| ------------------------------- | ------------- | ------------------------------------ |
| `require_publishing_approval`   | `true`        | Whether posts require admin approval |
| `gpu_monthly_budget_usd`        | `500.00`      | Monthly GPU spend limit              |
| `gpu_cost_per_ms`               | `0.0000005`   | Cost rate for GPU time estimation    |
| `instagram_rate_limit_per_hour` | `25`          | Max Instagram API calls per hour     |
| `default_lora_strength`         | `0.80`        | Default LoRA strength for new models |
| `max_batch_size`                | `12`          | Maximum images per generation job    |

---

## 14. API Contracts

### 14.1 Internal API Routes (Next.js Route Handlers)

All routes prefixed with `/api/`. All require authentication via Supabase session JWT.

---

#### Identity Manager APIs

**`POST /api/models`** — Create AI Model

_Role: Admin_

Request:

```json
{
	"name": "string (2–50 chars)",
	"description": "string (optional, ≤500 chars)"
}
```

Response `201`:

```json
{
	"id": "uuid",
	"name": "string",
	"status": "DRAFT",
	"created_at": "ISO-8601"
}
```

Errors: `400` (validation), `401` (unauthenticated), `403` (not admin)

---

**`PUT /api/models/:id`** — Update AI Model

_Role: Admin_

Request:

```json
{
  "name": "string (optional)",
  "description": "string (optional)",
  "body_profile": { ... },
  "face_profile": { ... },
  "imperfection_fingerprint": [ ... ]
}
```

Response `200`: Updated model object. Status auto-transitions to ACTIVE if body_profile AND face_profile are both non-null.

---

**`POST /api/models/:id/versions`** — Upload LoRA Version

_Role: Admin_

Request: `multipart/form-data`

- `file`: `.safetensors` file (≤2GB)
- `notes`: string (optional)
- `lora_strength`: number (optional, 0.1–1.0)

Response `201`:

```json
{
	"id": "uuid",
	"model_id": "uuid",
	"version": 2,
	"is_active": false,
	"lora_gcs_uri": "gs://...",
	"created_at": "ISO-8601"
}
```

---

**`POST /api/models/:id/versions/:versionId/activate`** — Activate Version

_Role: Admin_

Response `200`: Updated model_versions list for the model.

---

**`GET /api/models`** — List AI Models

_Role: Admin, Operator_

Query Params: `status` (optional filter), `page` (default 1), `limit` (default 20)

Response `200`:

```json
{
  "data": [ { model objects with active version info } ],
  "pagination": { "page": 1, "limit": 20, "total": 3 }
}
```

---

**`GET /api/models/:id`** — Get AI Model Detail

_Role: Admin, Operator_

Response `200`: Full model object including active version, canonical references, version history.

---

#### Preset APIs

**`POST /api/presets`** — Create Preset

_Role: Admin, Operator_

Request:

```json
{
  "name": "string",
  "mood_tag": "string",
  "lighting_profile": { ... },
  "lens_profile": { ... },
  "color_palette": { ... },
  "grading_curve": { ... },
  "camera_simulation": { ... }
}
```

Response `201`: Preset object with version 1 details.

---

**`PUT /api/presets/:id`** — Update Preset (Creates New Version)

_Role: Admin, Operator (owner)_

Same body as create. Creates new `preset_versions` record.

---

**`GET /api/presets`** — List Presets

Query Params: `mood_tag`, `sort_by` (name, created_at, last_used), `page`, `limit`

Response `200`: Paginated preset list with latest version details.

---

#### Campaign APIs

**`POST /api/campaigns`** — Create Campaign

_Role: Admin, Operator_

Request:

```json
{
	"name": "string (optional, auto-generated if omitted)",
	"model_id": "uuid",
	"preset_version_id": "uuid",
	"pose_pack_id": "uuid",
	"product_asset_url": "string (optional)",
	"batch_size": 8,
	"resolution_width": 1024,
	"resolution_height": 1024,
	"upscale": true,
	"custom_prompt_additions": "string (optional)",
	"negative_prompt": "string (optional)"
}
```

Response `201`: Campaign object with `status=DRAFT` and auto-generated `prompt_text`.

---

**`POST /api/campaigns/:id/generate`** — Trigger Generation

_Role: Admin, Operator_

Request:

```json
{
	"prompt_text": "string (final prompt after operator review)"
}
```

Response `202`:

```json
{
	"job_id": "uuid",
	"campaign_status": "GENERATING"
}
```

Errors: `400` (invalid status transition), `402` (GPU budget exceeded), `409` (generation already in progress)

---

**`POST /api/campaigns/:id/assets/:assetId/review`** — Review Asset

_Role: Admin, Operator_

Request:

```json
{
  "action": "approve" | "reject"
}
```

Response `200`: Updated asset object.

---

**`POST /api/campaigns/:id/finalize`** — Finalize Campaign Review

_Role: Admin, Operator_

Response `200`:

```json
{
  "campaign_status": "APPROVED" | "REJECTED",
  "approved_count": 5,
  "rejected_count": 3
}
```

---

**`GET /api/campaigns`** — List Campaigns

Query Params: `model_id`, `status`, `page`, `limit`, `sort_by` (created_at, updated_at)

---

**`GET /api/campaigns/:id`** — Campaign Detail

Response includes: campaign data, assets list, generation jobs, analytics summary.

---

#### Publishing APIs

**`POST /api/publishing/schedule`** — Schedule Post

_Role: Admin, Operator_

Request:

```json
{
	"asset_id": "uuid",
	"variant_type": "feed_1x1",
	"post_type": "feed",
	"caption": "string (≤2200 chars)",
	"hashtag_preset_id": "uuid (optional)",
	"scheduled_at": "ISO-8601 (UTC)"
}
```

Response `201`: Publishing queue record.

---

**`POST /api/publishing/:id/approve`** — Approve Scheduled Post

_Role: Admin_

---

**`POST /api/publishing/:id/reject`** — Reject Scheduled Post

_Role: Admin_

Request:

```json
{
	"reason": "string"
}
```

---

**`GET /api/publishing/calendar`** — Get Scheduled Posts

Query Params: `start_date`, `end_date`, `model_id`

Response `200`: Array of publishing records within date range.

---

#### Analytics APIs

**`GET /api/analytics/dashboard`** — Dashboard Data

Query Params: `model_id` (optional), `start_date`, `end_date`

Response `200`:

```json
{
  "kpis": {
    "total_reach": 125000,
    "avg_engagement_rate": 4.8,
    "total_posts": 15,
    "top_post": { ... }
  },
  "model_breakdown": [ ... ],
  "trend_data": [
    { "date": "2026-02-15", "engagement_rate": 4.2 },
    ...
  ]
}
```

---

**`GET /api/analytics/posts`** — Post-Level Analytics

Query Params: `model_id`, `start_date`, `end_date`, `sort_by`, `page`, `limit`

---

#### Webhook Endpoints

**`POST /api/webhooks/gpu-complete`** — GPU Completion Webhook

_Auth: HMAC-SHA256 signature validation (not JWT)_

See §9 US-4.2 for full specification.

---

#### Prompt Search API

**`POST /api/prompts/search`** — Semantic Search

Request:

```json
{
  "query": "string",
  "model_id": "uuid (optional)",
  "min_engagement_rate": 0 (optional),
  "start_date": "ISO-8601 (optional)",
  "limit": 20
}
```

Response `200`: Array of prompt results with similarity score, campaign info, asset thumbnail, engagement data.

---

**`POST /api/prompts/check-similarity`** — Check Prompt Duplication

Request:

```json
{
	"prompt_text": "string",
	"model_id": "uuid"
}
```

Response `200`:

```json
{
	"is_similar": true,
	"matches": [
		{
			"similarity": 0.94,
			"campaign_name": "...",
			"date": "..."
		}
	]
}
```

---

### 14.2 GPU Service Contract

The GPU service is an external HTTP API. LaceStudio is the client.

**`POST {GPU_SERVICE_URL}/generate`**

Headers:

```
Content-Type: application/json
Authorization: Bearer {GPU_API_KEY}
```

Request Body: See §9 AC-4.1.1 for full payload spec.

Response `202`:

```json
{
	"job_id": "uuid",
	"status": "accepted",
	"estimated_time_ms": 900000
}
```

Response `429` (rate limited):

```json
{
	"error": "rate_limited",
	"retry_after_seconds": 60
}
```

Response `503` (no GPUs available):

```json
{
	"error": "no_capacity",
	"retry_after_seconds": 300
}
```

---

## 15. State Machines & Workflows

### 15.1 AI Model Lifecycle

```
                ┌────────┐
                │ DRAFT  │
                └───┬────┘
                    │ body_profile AND face_profile completed
                    ▼
                ┌────────┐
                │ ACTIVE │ ◄──────── Admin re-activates
                └───┬────┘
                    │ Admin archives
                    ▼
               ┌──────────┐
               │ ARCHIVED │
               └──────────┘
```

**Transition Rules:**
| From | To | Trigger | Guard |
|---|---|---|---|
| DRAFT | ACTIVE | Profile completion | body_profile != null AND face_profile != null AND active_version_id != null |
| ACTIVE | ARCHIVED | Admin action | Confirmation dialog. No active campaigns must reference this model. |
| ARCHIVED | ACTIVE | Admin action | Model must still have valid face/body profiles and at least one LoRA version. |

---

### 15.2 Campaign Lifecycle

```
     ┌───────┐
     │ DRAFT │ ◄─────────────────────────────────────────┐
     └───┬───┘                                            │
         │ Operator clicks "Generate"                     │
         ▼                                                │
   ┌────────────┐                                         │
   │ GENERATING │                                         │
   └─────┬──────┘                                         │
         │                                                │
    ┌────┴────┐                                           │
    │         │                                           │
    ▼         ▼                                           │
┌────────┐  ┌───────┐                                     │
│ REVIEW │  │ FAILED│ ──── operator retries ──────────────┘
└───┬────┘  └───────┘
    │
    ├── All approved ──────► ┌──────────┐
    │                        │ APPROVED │
    │                        └────┬─────┘
    │                             │ Schedule
    │                             ▼
    │                       ┌───────────┐
    │                       │ SCHEDULED │
    │                       └─────┬─────┘
    │                             │ Published
    │                             ▼
    │                       ┌───────────┐
    │                       │ PUBLISHED │
    │                       └───────────┘
    │
    └── All rejected ──────► ┌──────────┐
                             │ REJECTED │ ─── re-edit ───► DRAFT
                             └──────────┘
```

**Transition Rules:**
| From | To | Trigger | Guard |
|---|---|---|---|
| DRAFT | GENERATING | Generate action | GPU budget not exceeded; model is ACTIVE; prompt_text is set |
| GENERATING | REVIEW | Webhook success | At least 1 asset created |
| GENERATING | FAILED | Webhook failure / timeout | All retries exhausted |
| GENERATING | DRAFT | GPU error (retryable) | Retry policy not exhausted; reverts for operator modification |
| FAILED | DRAFT | Operator retry | Manual action |
| REVIEW | APPROVED | Finalize review | At least 1 asset approved |
| REVIEW | REJECTED | Finalize review | All assets rejected |
| REJECTED | DRAFT | Operator re-edit | Manual action |
| APPROVED | SCHEDULED | At least 1 asset scheduled | Publishing queue record exists with status SCHEDULED |
| SCHEDULED | PUBLISHED | All scheduled posts published | All publishing_queue records for this campaign are PUBLISHED |

---

### 15.3 Asset Lifecycle

```
  ┌─────────┐
  │ PENDING │  (created by webhook)
  └────┬────┘
       │
  ┌────┴─────┐
  ▼          ▼
┌──────────┐ ┌──────────┐
│ APPROVED │ │ REJECTED │
└──────────┘ └──────────┘
```

---

### 15.4 Publishing Queue Lifecycle

```
┌──────────────────┐     ┌───────────┐
│ PENDING_APPROVAL │ ──► │ SCHEDULED │ ◄── (if approval not required)
└──────────────────┘     └─────┬─────┘
        │                      │
        │ Rejected             │ Publish time reached
        ▼                      ▼
  ┌──────────┐          ┌────────────┐
  │ REJECTED │          │ PUBLISHING │
  └──────────┘          └──────┬─────┘
                               │
                          ┌────┴────┐
                          ▼         ▼
                    ┌───────────┐ ┌───────┐
                    │ PUBLISHED │ │ RETRY │ ── retry ──► PUBLISHING
                    └───────────┘ └───┬───┘
                                      │ Max retries
                                      ▼
                                  ┌────────┐
                                  │ FAILED │
                                  └────────┘
```

---

## 16. UI Page Inventory & Navigation

### 16.1 Navigation Structure

```
┌─────────────────────────────────────────────────┐
│ LaceStudio                          [User] [Logout]  │
├─────────┬───────────────────────────────────────┤
│         │                                       │
│ Dashboard│   (Main content area)                │
│ Models   │                                      │
│ Presets  │                                      │
│ Campaigns│                                      │
│ Poses    │                                      │
│ Publish  │                                      │
│ Analytics│                                      │
│ Prompts  │                                      │
│ ──────── │                                      │
│ Settings*│  (* Admin only)                      │
│ Audit*   │  (* Admin only)                      │
│         │                                       │
└─────────┴───────────────────────────────────────┘
```

### 16.2 Page Inventory

| Route                   | Page                | Purpose                                     | Role                          |
| ----------------------- | ------------------- | ------------------------------------------- | ----------------------------- |
| `/`                     | Dashboard           | Overview KPIs, recent activity, active jobs | All                           |
| `/models`               | Model List          | Browse AI models                            | All                           |
| `/models/new`           | Create Model        | New model wizard                            | Admin                         |
| `/models/:id`           | Model Detail        | Identity config, versions, canonical refs   | Admin (edit), Operator (view) |
| `/presets`              | Preset Library      | Browse/filter presets                       | All                           |
| `/presets/new`          | Create Preset       | New preset form                             | All                           |
| `/presets/:id`          | Preset Detail       | View/edit preset, version history           | All                           |
| `/campaigns`            | Campaign List       | Browse/filter campaigns                     | All                           |
| `/campaigns/new`        | Campaign Wizard     | Step-by-step campaign creation              | All                           |
| `/campaigns/:id`        | Campaign Detail     | View campaign, review assets, job status    | All                           |
| `/campaigns/:id/review` | Asset Review        | Grid review UI for approving/rejecting      | All                           |
| `/poses`                | Pose Pack Library   | Browse pose packs                           | All                           |
| `/poses/new`            | Create Pose Pack    | Upload new pose pack                        | Admin                         |
| `/poses/:id`            | Pose Pack Detail    | View/edit pack                              | Admin (edit), Operator (view) |
| `/publish`              | Publishing Hub      | Calendar + list view of scheduled posts     | All                           |
| `/publish/approvals`    | Approval Queue      | Pending post approvals                      | Admin                         |
| `/analytics`            | Analytics Dashboard | Performance metrics + charts                | All                           |
| `/analytics/posts`      | Post Analytics      | Detailed per-post metrics                   | All                           |
| `/prompts`              | Prompt Library      | Search/browse prompts                       | All                           |
| `/settings`             | System Settings     | Global configuration                        | Admin                         |
| `/settings/users`       | User Management     | CRUD users                                  | Admin                         |
| `/audit`                | Audit Log           | Activity log viewer                         | Admin                         |

---

## 17. Error Handling Taxonomy

### 17.1 Error Categories

| Category                       | HTTP Code | Handling                  | User Experience                                                    |
| ------------------------------ | --------- | ------------------------- | ------------------------------------------------------------------ |
| **Validation Error**           | 400       | Return field-level errors | Inline error messages next to form fields                          |
| **Authentication Error**       | 401       | Redirect to login         | Toast: "Session expired. Please log in again."                     |
| **Authorization Error**        | 403       | Block action              | Toast: "You don't have permission to perform this action."         |
| **Not Found**                  | 404       | Return error              | Page-level "Not Found" state                                       |
| **Conflict**                   | 409       | Return error              | Toast: "This action conflicts with current state. Please refresh." |
| **Rate Limited**               | 429       | Retry with backoff        | Toast: "Too many requests. Please wait."                           |
| **GPU Budget Exceeded**        | 402       | Block generation          | Banner: "Monthly GPU budget reached. Contact admin."               |
| **GPU Service Error**          | 502/503   | Queue retry               | Campaign shows "Generation failed" with retry option               |
| **Webhook Validation Failure** | 401       | Reject, log               | No user-facing message (logged for admin review)                   |
| **Instagram API Error**        | Varies    | Per-error handling        | Publishing status reflects failure with reason                     |
| **Internal Error**             | 500       | Log, alert                | Toast: "Something went wrong. Please try again."                   |

### 17.2 Retry Policies

| Operation                   | Max Retries        | Backoff                 | Timeout            |
| --------------------------- | ------------------ | ----------------------- | ------------------ |
| GPU job dispatch            | 2                  | Exponential (30s, 120s) | 20 min per attempt |
| Instagram publishing        | 3                  | Per rate-limit response | 30s per API call   |
| Embedding generation        | 3                  | Fixed 10s               | 30s per call       |
| Analytics ingestion         | 3                  | Fixed 60s               | 30s per API call   |
| Webhook delivery (outbound) | N/A (inbound only) | N/A                     | N/A                |

---

## 18. Security Specification

### 18.1 Authentication

| Property        | Specification                                                              |
| --------------- | -------------------------------------------------------------------------- |
| Provider        | Supabase Auth                                                              |
| Methods         | Email + Password (Phase 1); MFA optional (Phase 2)                         |
| Session         | JWT (Supabase default), 1-hour access token + 7-day refresh token          |
| Password Policy | Minimum 12 characters, at least 1 uppercase, 1 number, 1 special character |

### 18.2 Authorization

- RLS enforced on all tables (see §5.3).
- Middleware on all API routes validates session JWT and extracts role.
- Admin-only routes return `403` for operators.
- Server-side: use `service_role` key only in Edge Functions and server actions (never exposed to client).

### 18.3 Secrets Management

| Secret                    | Storage                              | Rotation                   |
| ------------------------- | ------------------------------------ | -------------------------- |
| Supabase service_role key | Vercel env vars (encrypted)          | On compromise              |
| GPU API key               | Vercel env vars                      | Quarterly                  |
| GPU webhook HMAC secret   | Vercel env vars + GPU service config | Quarterly                  |
| GCS service account key   | Vercel env vars (JSON)               | Annually                   |
| Instagram access token    | Supabase DB (encrypted column)       | Auto-refresh every 55 days |
| OpenAI API key            | Vercel env vars                      | Quarterly                  |

### 18.4 Data Protection

- All GCS buckets are private. Access via signed URLs only (short-lived: 15 min for uploads, 1 hour for downloads).
- LoRA weight files are never served to the frontend. Only the GPU service receives signed URLs.
- Audit log captures all state-changing operations.
- Database backups: daily automated (Supabase), on-demand before migrations.
- No PII stored beyond operator email addresses.

---

## 19. Infrastructure & Deployment

### 19.1 Environments

| Environment | URL                    | Database                   | GCS Buckets      | Purpose                |
| ----------- | ---------------------- | -------------------------- | ---------------- | ---------------------- |
| Development | localhost:3000         | Supabase project (dev)     | lacestudio-dev-\*     | Local development      |
| Staging     | staging.lacestudio.internal | Supabase project (staging) | lacestudio-staging-\* | Pre-production testing |
| Production  | app.lacestudio.internal     | Supabase project (prod)    | lacestudio-\*         | Live system            |

### 19.2 CI/CD Pipeline (GitHub Actions)

```yaml
# Trigger: Push to main (production), push to develop (staging), PR (preview)

Pipeline Steps:
  1. Checkout code
  2. Install dependencies (pnpm)
  3. Lint (eslint)
  4. Type check (tsc --noEmit)
  5. Unit tests (vitest)
  6. Integration tests (vitest + Supabase local)
  7. Build (next build)
  8. Database migration check (prisma migrate diff)
  9. Deploy:
     - PR → Vercel preview deployment
     - develop → Vercel staging
     - main → Vercel production
  10. Post-deploy: Run migrations (prisma migrate deploy)
  11. Post-deploy: Smoke tests
```

### 19.3 Database Migration Strategy

- Prisma manages all migrations.
- Migrations are committed to the repository.
- `prisma migrate dev` for local development.
- `prisma migrate deploy` for staging/production (non-interactive).
- Manual backup before any production migration.
- Rollback: reverse migration files prepared for destructive changes.

---

## 20. Observability & Monitoring

### 20.1 Logging

| Layer                   | Tool                                  | Log Level                |
| ----------------------- | ------------------------------------- | ------------------------ |
| Next.js application     | Vercel Logs + structured JSON logging | Info (prod), Debug (dev) |
| Supabase Edge Functions | Supabase Dashboard Logs               | Info                     |
| GPU Service             | GPU provider logs (RunPod dashboard)  | Varies                   |

**Structured Log Format:**

```json
{
	"timestamp": "ISO-8601",
	"level": "info|warn|error",
	"service": "api|webhook|cron|gpu",
	"action": "campaign.generate|publishing.publish|...",
	"entity_type": "campaign|asset|...",
	"entity_id": "uuid",
	"user_id": "uuid",
	"duration_ms": 150,
	"error": "string (if applicable)",
	"metadata": {}
}
```

### 20.2 Monitoring & Alerts

| Metric                     | Threshold            | Alert Channel                    |
| -------------------------- | -------------------- | -------------------------------- |
| GPU job failure rate       | >20% over 1 hour     | Email + Slack                    |
| GPU job duration           | >20 min (single job) | Email                            |
| Instagram publish failure  | Any failure          | Email                            |
| Monthly GPU spend          | ≥80% of budget       | Email                            |
| Monthly GPU spend          | ≥100% of budget      | Email + Slack + UI banner        |
| Webhook HMAC failures      | >3 in 1 hour         | Email + Slack (potential attack) |
| Database connection errors | >5 in 5 minutes      | Email + Slack                    |
| API error rate (5xx)       | >5% over 15 minutes  | Email                            |

### 20.3 Health Check

**`GET /api/health`** — No auth required.

Response `200`:

```json
{
	"status": "healthy",
	"version": "git-sha",
	"database": "connected",
	"timestamp": "ISO-8601"
}
```

---

## 21. Testing Strategy

### 21.1 Testing Layers

| Layer                       | Tool                    | Coverage Target | Scope                                                                 |
| --------------------------- | ----------------------- | --------------- | --------------------------------------------------------------------- |
| Unit Tests                  | Vitest                  | ≥80%            | Utility functions, prompt construction, state transitions, validators |
| Integration Tests           | Vitest + Supabase local | Key flows       | API routes, database operations, RLS policies                         |
| E2E Tests (Phase 2)         | Playwright              | Critical paths  | Campaign creation → generation → review → publish flow                |
| Visual Regression (Phase 2) | Playwright screenshots  | Key pages       | Dashboard, review UI, campaign wizard                                 |

### 21.2 Critical Test Scenarios

| #    | Scenario                                                               | Type               |
| ---- | ---------------------------------------------------------------------- | ------------------ |
| T-1  | Create model → upload LoRA → activate version → model becomes ACTIVE   | Integration        |
| T-2  | Rollback model version → verify active version changes                 | Integration        |
| T-3  | Create campaign → generate → webhook success → assets appear in REVIEW | Integration        |
| T-4  | GPU webhook with invalid HMAC → rejected with 401                      | Integration        |
| T-5  | Approve assets → campaign APPROVED → format variants generated         | Integration        |
| T-6  | Schedule post → cron fires → Instagram API call made → PUBLISHED       | Integration        |
| T-7  | GPU budget at 100% → generation blocked                                | Unit + Integration |
| T-8  | Prompt similarity ≥0.92 → warning displayed                            | Unit               |
| T-9  | RLS: Operator cannot edit ai_models                                    | Integration        |
| T-10 | Campaign state transitions follow the FSM (no invalid transitions)     | Unit               |

---

## 22. Performance Budgets

| Metric                      | Target                             | Measurement           |
| --------------------------- | ---------------------------------- | --------------------- |
| Page load (initial)         | ≤1.5s (LCP)                        | Vercel Analytics      |
| Page navigation (SPA)       | ≤200ms                             | Client-side timing    |
| API response (read)         | ≤200ms p95                         | Server-side timing    |
| API response (write)        | ≤500ms p95                         | Server-side timing    |
| Image generation (12 batch) | ≤15 minutes                        | GPU job duration      |
| Image generation (single)   | ≤90 seconds                        | GPU job duration      |
| Asset variant generation    | ≤30 seconds per asset (4 variants) | Server-side timing    |
| Embedding generation        | ≤2 seconds                         | Server-side timing    |
| Similarity search           | ≤500ms                             | Database query timing |
| Instagram publish           | ≤10 seconds end-to-end             | Publishing log timing |
| Search/filter in lists      | ≤300ms                             | Client-side timing    |

---

## 23. Environment Variables Inventory

| Variable                        | Service  | Required | Description                               |
| ------------------------------- | -------- | -------- | ----------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Frontend | Yes      | Supabase project URL                      |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Frontend | Yes      | Supabase anonymous key                    |
| `SUPABASE_SERVICE_ROLE_KEY`     | Backend  | Yes      | Supabase admin key (server-side only)     |
| `DATABASE_URL`                  | Backend  | Yes      | Prisma connection string (pooled)         |
| `DIRECT_DATABASE_URL`           | Backend  | Yes      | Prisma direct connection (for migrations) |
| `GCS_SERVICE_ACCOUNT_KEY`       | Backend  | Yes      | GCS JSON key                              |
| `GCS_PROJECT_ID`                | Backend  | Yes      | GCP project ID                            |
| `GPU_SERVICE_URL`               | Backend  | Yes      | GPU API endpoint                          |
| `GPU_API_KEY`                   | Backend  | Yes      | GPU service auth key                      |
| `GPU_WEBHOOK_SECRET`            | Backend  | Yes      | HMAC secret for webhook validation        |
| `OPENAI_API_KEY`                | Backend  | Yes      | For embedding generation                  |
| `INSTAGRAM_ACCESS_TOKEN`        | Backend  | Yes      | Instagram Graph API token                 |
| `INSTAGRAM_USER_ID`             | Backend  | Yes      | Instagram business account ID             |
| `NEXT_PUBLIC_APP_URL`           | Frontend | Yes      | Application base URL                      |
| `VERCEL_ENV`                    | Auto     | Auto     | Environment detection                     |

**Auth / Supabase:** If you see a console "fetch failed" from `@supabase/auth-js` during SSR, the Next.js server cannot reach `NEXT_PUBLIC_SUPABASE_URL`. Ensure the URL is correct, Supabase (or local stack) is running, and the server can resolve and reach that host. When the auth provider is unreachable, the app treats it as no session and renders without crashing.

---

## 24. MVP Scope & Phased Delivery

### Phase 1 — MVP (Months 1–2)

**Goal:** One fully operational AI model, end-to-end campaign pipeline, manual publishing.

| Feature                       | Module                   | User Stories                   |
| ----------------------------- | ------------------------ | ------------------------------ |
| Create & configure 1 AI model | Identity Manager         | US-1.1, US-1.2, US-1.3, US-1.5 |
| Create & manage style presets | Style Preset Engine      | US-2.1, US-2.2, US-2.3         |
| Campaign creation wizard      | Campaign Builder         | US-3.1                         |
| Image batch generation        | Image Generation Service | US-4.1, US-4.2, US-4.3         |
| Asset review & approval       | Campaign Builder         | US-3.3, US-3.4                 |
| Manual post scheduling        | Publishing Module        | US-6.1, US-6.2, US-6.3, US-6.4 |
| Basic analytics dashboard     | Analytics Module         | US-7.1, US-7.2                 |
| Prompt storage & embedding    | Prompt Module            | US-5.1                         |
| Auth (Admin + Operator roles) | Security                 | —                              |
| Audit log                     | Security                 | —                              |

**Excluded from Phase 1:**

- Prompt similarity search (US-5.2, US-5.3) — requires sufficient data
- LoRA version rollback (US-1.4) — low urgency for single model
- Analytics-to-campaign linking (US-7.3)
- Carousel / Reel publishing
- Automated optimization loop
- Multi-model orchestration

---

### Phase 2 — Analytics & Optimization (Month 3)

| Feature                                            | User Stories    |
| -------------------------------------------------- | --------------- |
| Performance-to-preset correlation                  | US-7.3          |
| Prompt similarity search                           | US-5.2          |
| Prompt repetition detection                        | US-5.3          |
| LoRA version rollback                              | US-1.4          |
| Enhanced analytics (trend charts, model breakdown) | US-7.2 extended |

---

### Phase 3 — Multi-Model & Scale (Month 4+)

| Feature                                     | Notes                                     |
| ------------------------------------------- | ----------------------------------------- |
| Multiple AI models operating simultaneously | Multi-model support already in data model |
| Carousel & Reel publishing                  | Instagram API extension                   |
| Pose pack management UI                     | US for admin pose management              |
| GPU provider failover                       | Automatic fallback to secondary provider  |
| Cost optimization recommendations           | Based on analytics data                   |

---

### Phase 4 — Revenue & Brand Dashboard (Month 5+)

| Feature                           | Notes                        |
| --------------------------------- | ---------------------------- |
| Revenue tracking per model        | New data model extension     |
| Brand/client management           | Campaign tagging for clients |
| Client-facing read-only dashboard | Separate auth scope          |
| Export reporting                  | PDF/CSV performance reports  |

---

## 25. Risk Register

| ID   | Risk                                              | Probability | Impact   | Mitigation                                                                                | Owner             |
| ---- | ------------------------------------------------- | ----------- | -------- | ----------------------------------------------------------------------------------------- | ----------------- |
| R-1  | Identity drift across versions                    | Medium      | High     | Version locking, canonical reference validation, human QA gate                            | Tech Lead         |
| R-2  | Over-automation reduces quality                   | Medium      | High     | Manual creative approval required at every stage                                          | Creative Operator |
| R-3  | Instagram API rate limiting / account restriction | Medium      | High     | Conservative rate limits (50% of max), diversified content types, compliance monitoring   | Tech Lead         |
| R-4  | GPU cost exceeds budget                           | Medium      | Medium   | Budget caps in system settings, alert at 80%, block at 100%, batch size limits            | Tech Lead         |
| R-5  | LoRA weight file corruption                       | Low         | High     | GCS versioning enabled, checksum validation on upload, multiple version retention         | Tech Lead         |
| R-6  | Webhook delivery failure (GPU to LaceStudio)           | Medium      | Medium   | Timeout detection (20 min), stale job flagging, manual retry, idempotent webhook handler  | Tech Lead         |
| R-7  | Instagram access token expiration                 | Medium      | Medium   | 55-day auto-refresh cron, expiration monitoring, admin alert 7 days before expiry         | Tech Lead         |
| R-8  | Single operator bottleneck                        | Medium      | Medium   | Clear workflow documentation, cross-training, role-based access allows multiple operators | Sales Director    |
| R-9  | Supabase outage                                   | Low         | High     | All operations are retryable, local dev environment for continued authoring               | Tech Lead         |
| R-10 | Generated content violates platform policies      | Low         | Critical | Human review gate before all publishing, content guidelines in operator docs              | Creative Operator |

---

## 26. Definition of Done

A feature is considered **done** when ALL of the following are satisfied:

- [ ] All acceptance criteria for the user story are met and verified
- [ ] Code passes TypeScript strict-mode compilation with zero errors
- [ ] ESLint passes with zero warnings
- [ ] Unit tests written and passing (≥80% coverage for new code)
- [ ] Integration test written for database-touching operations
- [ ] RLS policies verified for the affected tables
- [ ] API endpoints return correct error codes for all error cases
- [ ] Loading and error states implemented in UI
- [ ] Responsive design verified (desktop; mobile is not a priority but should not break)
- [ ] Prisma migration committed and tested
- [ ] Environment variables documented if new ones added
- [ ] Audit log entries created for state-changing operations
- [ ] PR reviewed and approved by at least 1 team member
- [ ] Deployed to staging and smoke-tested
- [ ] No regressions in existing features

---

_End of LaceStudio SSOT — Version 3.0_
