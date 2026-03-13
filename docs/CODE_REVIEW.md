# March 12, 2026 Delta Review

This pass re-reviewed the codebase after the earlier March 4 document and focused on live correctness, UX behavior, and route/service consistency rather than only structural advice.

## Confirmed Findings

1. `src/lib/api-errors.ts`
   Client-side field error parsing only handled `details.fieldErrors`, but the server emits validation details as `details.field_errors` from `src/lib/request.ts`. Result: field-level validation messages can silently disappear in the UI.

2. `src/app/(app)/layout.tsx`
   The app shell elevated every localhost session to `admin` unconditionally, even when the auth-layer localhost bypass setting would disable that behavior. Result: UI role state can disagree with API authorization and expose the wrong navigation/actions locally.

3. `src/app/api/models/[id]/workflow/canonical-pack/generate/route.ts`
   The route was calling `startCanonicalPackGeneration(... awaitCompletion: true)`, which turns a background generation endpoint into a long-running blocking request. Result: slower UX, higher timeout risk, and duplicated waiting because the client already polls for completion.

## Important Follow-Up Risks Not Fully Addressed In This Patch

1. `src/components/models/model-wizard.tsx`, `src/app/(app)/models/[id]/page.tsx`, and `src/app/(app)/campaigns/[id]/page.tsx` remain very large and would benefit from further extraction into hooks/components.

2. Several preview/modal surfaces still rely on custom keyboard handling and deserve a dedicated accessibility pass.

## Additional Fix Completed After The Initial Delta Summary

1. `src/server/services/ingest-analytics.ts`, `src/app/api/analytics/dashboard/route.ts`, and `src/app/api/analytics/posts/route.ts`
   The analytics views were consuming raw snapshot history as if every row were a unique post state. The routes now reduce repeated snapshots to the most recent row per published post for KPI/table calculations, preserve historical rows only for the daily trend series, and push latest-per-post pagination/aggregation into database queries instead of loading full snapshot history into application memory.

2. `src/components/models/model-wizard.tsx`
   The autosave flow could keep stale timers alive while remote workflow state was being reloaded. That created a race where outdated local drafts could overwrite freshly hydrated server data, and resume flows could schedule autosaves before the workflow payload finished applying. Autosave orchestration is now isolated so hydration can cancel pending timers, invalidate stale in-flight completions, reset stale save badges, and resume cleanly after state sync.

3. `src/components/models/model-wizard.tsx`
   The progress sidebar was mutating `workflow_state.completed_steps` while deriving UI-only completion badges. That risked leaking render-time mutations back into the workflow object. The derived completed-step list now clones the workflow array before adding view-level steps.

4. `src/app/(app)/campaigns/[id]/page.tsx`
   The campaign asset preview was still an inline overlay inside the page component, driven by a page-level global keyboard listener and missing dialog semantics. It is now extracted into a dedicated lightbox component with scroll locking, focusable dialog markup, close-on-Escape behavior, and keyboard navigation isolated from the main page orchestration.

# LaceStudio Code Review

**Review Date:** March 4, 2026  
**Version:** 0.1.0  
**Reviewer:** AI Code Review

---

## Executive Summary

LaceStudio is a sophisticated Next.js 16 application for managing AI-generated fashion/editorial content. The codebase demonstrates strong architectural decisions, comprehensive type safety, and well-implemented domain logic. Overall code quality is **high**, with clear opportunities for optimization in specific areas.

**Overall Rating: 8.2/10**

### Strengths
- Excellent TypeScript usage with strict mode and `noUncheckedIndexedAccess`
- Comprehensive Zod v4 validation schemas
- Clean separation between API routes, services, and providers
- Well-implemented SSRF protection for external URL fetching
- Good test coverage with Vitest + Playwright

### Key Areas for Improvement
- Large service files that could be decomposed
- Duplicate retry/backoff logic across providers
- Demo mode complexity scattered across codebase
- Some provider implementations exceed 1000 lines

---

## Architecture Overview

### Tech Stack

| Category | Technology |
|----------|------------|
| Framework | Next.js 16.1.6 (App Router) |
| Frontend | React 19.2.3 |
| Database | PostgreSQL + Prisma 6.16.3 |
| Auth | Supabase Auth |
| State | TanStack Query 5.x |
| Validation | Zod 4.3.6 |
| Styling | Tailwind CSS 4.x |
| Testing | Vitest 4.x + Playwright 1.58 |

### Directory Structure

```
src/
├── app/                    # Next.js App Router
│   ├── (app)/             # Authenticated app routes
│   └── api/               # API route handlers
├── components/            # React components
│   ├── layout/           # Shell, navigation
│   ├── ui/               # Primitive components
│   └── [domain]/         # Domain-specific components
├── lib/                   # Core utilities
├── server/               # Server-side logic
│   ├── providers/        # External service providers
│   ├── schemas/          # Zod validation schemas
│   ├── services/         # Business logic services
│   └── demo/             # Demo mode implementation
├── types/                 # Shared TypeScript types
└── prisma/               # Database schema and migrations
```

### Domain Model

The application manages:
- **AI Models** → Virtual models with canonical reference packs
- **Campaigns** → Image generation batches with creative controls
- **Assets** → Generated images with review workflow
- **Publishing** → Instagram scheduling and publishing
- **Analytics** → Post performance tracking

---

## Code Quality Analysis

### 1. TypeScript Configuration

**Rating: 9/10**

```1:10:tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    ...
  }
}
```

Excellent configuration with:
- `strict: true` for maximum type safety
- `noUncheckedIndexedAccess` preventing array/tuple bugs
- Proper path aliases (`@/*`)

### 2. Validation Layer

**Rating: 8.5/10**

The Zod schemas in `src/server/schemas/` provide comprehensive validation:

```1:60:src/server/schemas/api.ts
export const campaignCreateSchema = z.object({
  name: z.string().max(200).optional(),
  model_id: uuidSchema,
  preset_version_id: uuidSchema,
  // ... well-validated fields
});
```

**Issues:**
- Some schemas use `z.record(z.string(), z.unknown())` which bypasses validation
- Creative controls schema is complex with many nested defaults

### 3. API Route Handlers

**Rating: 8/10**

Consistent pattern with error handling wrapper:

```31:82:src/app/api/campaigns/route.ts
export async function GET(request: Request) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin", "operator"]);
    // ... handler logic
  });
}
```

**Good patterns:**
- Centralized error handling via `withRouteErrorHandling`
- Consistent auth checks with `getSessionContext()` and `assertRole()`
- Demo mode integration without polluting business logic

**Issues:**
- Demo mode checks duplicated across routes
- Pagination logic could be extracted to a utility

### 4. Service Layer

**Rating: 7.5/10**

Services contain business logic but some are too large:

| File | Lines | Concern |
|------|-------|---------|
| `canonical-pack.service.ts` | 1378 | Too large |
| `nano-banana-image-provider.ts` | 1046 | Too large |
| `creative-controls.ts` | 247 | Acceptable |
| `prompt-builder.ts` | 52 | Good |

**Recommendations:**
- Split `canonical-pack.service.ts` into:
  - `canonical-pack-generation.ts`
  - `canonical-pack-approval.ts`
  - `canonical-pack-state.ts`
- Extract retry logic to shared utility

### 5. Provider Pattern

**Rating: 8/10**

Clean abstraction for image providers:

```15:36:src/server/providers/index.ts
export function getImageProvider(provider: ImageModelProvider): ImageProvider {
  const env = getEnv();
  if (provider === "openai") return new OpenAiImageProvider();
  if (provider === "nano_banana_2") return new NanoBananaImageProvider();
  // ...
}
```

**Issues:**
- Each provider implements its own retry logic (duplicate code)
- Mock providers mixed with live providers in same files

### 6. Frontend Components

**Rating: 8/10**

Components follow good patterns:

```57:100:src/components/layout/app-shell.tsx
export function AppShell({ role, showRoleSwitcher = false, children }: AppShellProps) {
  const pathname = usePathname();
  const sections = useMemo(() => navSectionsForRole(role), [role]);
  // ...
}
```

**Good patterns:**
- Proper use of `useMemo` for expensive computations
- Role-based navigation filtering
- Clean composition with providers

**Issues:**
- `model-wizard.tsx` (653 lines) manages too much state
- Some components could benefit from custom hooks

---

## Security Review

### 1. Authentication

**Rating: 8/10**

```152:194:src/lib/auth.ts
export async function getSessionContext(): Promise<SessionContext> {
  // ... token validation
  const user = await prisma.user.findUnique({
    where: { id: authUser.id },
    select: { id: true, role: true }
  });
  // ...
}
```

**Good:**
- Supabase token validation
- Database-backed user lookup
- Role-based access control

**Concerns:**
- Localhost bypass grants admin role automatically:
  ```165:167:src/lib/auth.ts
  if (onLocalhost) {
    return { userId: DEMO_ROLE_USER_IDS.admin, role: "admin" };
  }
  ```
- This is convenient for development but could be a risk if deployed incorrectly

### 2. SSRF Protection

**Rating: 9/10**

Excellent SSRF protection implementation:

```1:157:src/lib/ssrf.ts
const BLOCKED_IPV4_RANGES: Ipv4Range[] = [
  toIpv4Range("10.0.0.0", "10.255.255.255"),
  toIpv4Range("127.0.0.0", "127.255.255.255"),
  toIpv4Range("169.254.0.0", "169.254.255.255"),
  // ...
];

export async function assertSafePublicHttpUrl(rawUrl: string): Promise<URL> {
  // DNS resolution and IP validation
}
```

**Good:**
- Blocks private IP ranges
- DNS rebinding protection via resolution
- Blocks metadata endpoints (GCP, AWS)

### 3. Input Validation

**Rating: 8.5/10**

Comprehensive Zod validation on all API inputs:

```50:57:src/lib/request.ts
export function validateOrThrow<T>(schema: ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Request validation failed", parsed.error.flatten());
  }
  return parsed.data;
}
```

### 4. Secrets Management

**Rating: 8/10**

Environment variables validated at startup:

```40:52:src/lib/env.ts
export function getEnv(): z.infer<typeof envSchema> {
  if (cachedEnv) return cachedEnv;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment variables:\n${details}`);
  }
  cachedEnv = parsed.data;
  return parsed.data;
}
```

---

## Performance Analysis

### 1. Database Queries

**Rating: 7.5/10**

Good use of Prisma with some optimization opportunities:

**Good:**
- Transaction usage for atomic operations
- Proper select clauses to limit data transfer
- Indexes defined in schema

**Issues:**
- N+1 potential in canonical pack summary:
  ```709:719:src/server/services/canonical-pack.service.ts
  const candidates = await prisma.modelReferenceCandidate.findMany({...});
  const candidatesWithPreview = await mapWithConcurrency(candidates, 12, async candidate => ({
    ...candidate,
    preview_image_url: await resolveCandidatePreviewUrl(candidate.image_gcs_uri)
  }));
  ```

### 2. API Response Times

**Rating: 8/10**

- GPU provider has proper timeout (120s) and retry logic
- Image providers use bounded concurrency (4 concurrent)
- Proper use of `Promise.allSettled` for parallel operations

### 3. Frontend Performance

**Rating: 7.5/10**

**Good:**
- React Query with proper cache keys
- 15-second refetch interval for dashboard summary
- Suspense boundaries for loading states

**Issues:**
- Model wizard polls every 1.5s for 240 attempts (6 minutes max)
- Could use WebSocket/SSE for long-running operations

---

## Code Smells & Technical Debt

### 1. Duplicate Retry Logic

Multiple implementations of exponential backoff:

- `live-gpu-provider.ts` - lines 41-71
- `nano-banana-image-provider.ts` - lines 894-945
- `canonical-pack.service.ts` - lines 1168-1200

**Recommendation:** Create `src/lib/retry.ts` with shared implementation.

### 2. Demo Mode Complexity

Demo mode checks scattered across:
- `src/server/demo/mode.ts`
- `src/server/demo/store.ts`
- Every API route handler
- Auth layer

**Recommendation:** Use middleware or higher-order function pattern.

### 3. Large Files

| File | Lines | Recommendation |
|------|-------|----------------|
| `canonical-pack.service.ts` | 1378 | Split into 3-4 modules |
| `nano-banana-image-provider.ts` | 1046 | Extract Gemini-specific code |
| `model-wizard.tsx` | 653 | Extract custom hooks |

### 4. Type Duplication

Domain types defined in multiple places:
- `src/types/domain.ts` - TypeScript types
- `prisma/schema.prisma` - Prisma enums
- `src/server/schemas/*.ts` - Zod schemas

**Recommendation:** Generate TypeScript types from Zod schemas using `z.infer`.

---

## Testing Coverage

### Unit Tests

| Area | Coverage | Quality |
|------|----------|---------|
| Prompt Builder | Good | Clear assertions |
| Creative Controls | Good | Tests merge logic |
| Campaign State | Good | Tests transitions |
| API Errors | Good | Tests error parsing |
| GPU Provider | Good | Mocks external calls |

### E2E Tests

Only 1 E2E test file (`dashboard.spec.ts`) - needs expansion.

### Missing Tests

- Instagram provider (live)
- Webhook handlers
- Authentication flow
- Error scenarios

---

## Recommendations

### High Priority

1. **Extract Retry Utility**
   ```typescript
   // src/lib/retry.ts
   export async function withRetry<T>(options: {
     maxAttempts: number;
     baseDelayMs: number;
     shouldRetry: (error: unknown) => boolean;
     run: () => Promise<T>;
   }): Promise<T>;
   ```

2. **Split Large Services**
   - Break `canonical-pack.service.ts` into focused modules
   - Extract Gemini logic from `nano-banana-image-provider.ts`

3. **Add Rate Limiting**
   - Implement per-user rate limiting on API routes
   - Add environment variables for limits

### Medium Priority

4. **Improve Error Messages**
   - Add request IDs to all error responses
   - Include more context in validation errors

5. **Expand E2E Tests**
   - Add tests for campaign workflow
   - Test authentication flows
   - Test error scenarios

6. **WebSocket for Long Operations**
   - Replace polling in model wizard
   - Real-time updates for generation progress

### Low Priority

7. **Consolidate Type Definitions**
   - Single source of truth for domain types
   - Generate from Zod schemas

8. **Add API Versioning**
   - Prefix routes with `/api/v1/`
   - Plan for backwards compatibility

9. **Improve Logging**
   - Add request timing
   - Structured error context

---

## File-by-File Highlights

### Excellent Files

| File | Why |
|------|-----|
| `src/lib/ssrf.ts` | Comprehensive SSRF protection |
| `src/lib/auth.ts` | Clean auth flow with role handling |
| `src/lib/http.ts` | Consistent error responses |
| `src/server/schemas/creative.ts` | Well-structured validation |
| `src/components/layout/nav-config.ts` | Clean role-based navigation |

### Files Needing Attention

| File | Issues |
|------|--------|
| `src/server/services/canonical-pack.service.ts` | Too large, mixed concerns |
| `src/server/providers/image/nano-banana-image-provider.ts` | Too large |
| `src/components/models/model-wizard.tsx` | Too much state management |

---

## Conclusion

LaceStudio is a well-architected application with strong foundations. The codebase demonstrates mature TypeScript practices, comprehensive validation, and thoughtful security measures. The main areas for improvement are around code organization (splitting large files) and reducing duplication (retry logic, demo mode checks).

The codebase is production-ready with the current quality level, but addressing the high-priority recommendations would significantly improve maintainability and developer experience.

---

*Generated by AI Code Review - March 2026*

---

## Full System Reference

This section turns this file into a **single, comprehensive source of truth** for the entire LaceStudio codebase: architecture, data models, APIs, workflows, providers, security, publishing, and configuration.

### High-Level System Overview

- **Product name**: LaceStudio  
- **Purpose**: Internal OS for identity-safe synthetic talent production, campaign orchestration, Instagram publishing, and performance analytics.  
- **Architecture**: Full-stack **Next.js 16 App Router** app with:
  - **Frontend**: React 19, Tailwind 4, shadcn-style UI
  - **Backend**: Next.js route handlers + Prisma 6 + PostgreSQL
  - **Auth**: Supabase Auth (JWT) with demo-mode overrides
  - **State**: TanStack React Query 5 for server state
  - **Storage**: Google Cloud Storage (GCS) for images/weights
  - **External services**: GPU image generation, OpenAI, Gemini Nano Banana 2, Instagram Graph API
  - **Infra glue**: Supabase edge functions for some GPU/analytics flows

### Codebase Layout (Single Mental Model)

- **`src/app`**: Next.js App Router
  - `(app)/` route group: authenticated app (dashboard, models, campaigns, presets, poses, prompts, publish, analytics, settings, clients, revenue, audit)
  - `api/`: all HTTP route handlers (≈ 48 endpoints)
  - `layout.tsx`, `error.tsx`, `not-found.tsx`, `globals.css`
- **`src/components`**:
  - `layout/`: `AppShell`, nav, scaffolding, theme toggle
  - `providers/`: `AppProviders`, notice/breadcrumb providers
  - `ui/`: shadcn-style primitives (button, input, select, card, table, dialog, etc.)
  - `models/`: model wizard and its step components
  - `campaigns/`: creation form, progress UI, prompt helpers
  - `workspace/`: generic table/form/filter shells
  - `dashboard/`, `brand/`, etc.: feature-specific UI
- **`src/server`**:
  - `services/`: all business logic (model workflow, canonical packs, campaign state/generation, creative controls, prompt builder, GPU budget, analytics ingest, scheduled publishing, storage)
  - `providers/`: GPU, image, Instagram providers (mock + live)
  - `schemas/`: Zod schemas for API + creative controls + workflows
  - `demo/`: in-memory demo store + feature flags
  - `repositories/`: pagination helpers, data access helpers
  - `jobs/`: background job type definitions
- **`src/lib`**:
  - `auth.ts`: session context + RBAC
  - `http.ts`: `ApiError`, `ok`, error responses
  - `route-handler.ts`: API error wrapper
  - `prisma.ts`: Prisma client singleton
  - `env.ts`: env var validation
  - `client-api.ts`: client-side fetch wrapper
  - `ssrf.ts`: SSRF-safe URL validation
  - `retry.ts`, `logger.ts`, `utils.ts`, `cron-auth.ts`, `supabase-browser.ts`, `cn.ts`
- **`src/types`**:
  - `domain.ts`: domain enums/types
  - `ui.ts`: UI-facing type helpers
- **`prisma`**:
  - `schema.prisma`: all models/enums
  - `migrations/`, `seed.ts`, `create-db.ts`
- **`docs`**:
  - This file, Gemini docs, SSOT spec, implementation trackers, PRD

---

### Data Model (Prisma Schema) – Entities & Relationships

All data is defined in `prisma/schema.prisma`. Below is a structured semantic view.

#### Core Enums

- **`UserRole`**: `ADMIN`, `OPERATOR`, `CLIENT`
- **`ModelStatus`**: `DRAFT`, `ACTIVE`, `ARCHIVED`
- **`CampaignStatus`**: `DRAFT`, `GENERATING`, `REVIEW`, `APPROVED`, `REJECTED`, `SCHEDULED`, `PUBLISHED`, `FAILED`
- **`GenerationJobStatus`**: `DISPATCHED`, `IN_PROGRESS`, `COMPLETED`, `FAILED`, `TIMED_OUT`
- **`AssetStatus`**: `PENDING`, `APPROVED`, `REJECTED`
- **`VariantType`**: `feed_1x1`, `feed_4x5`, `story_9x16`, `master`
- **`PostType`**: `feed`, `story`, `reel`
- **`PublishingStatus`**: `PENDING_APPROVAL`, `SCHEDULED`, `PUBLISHING`, `PUBLISHED`, `RETRY`, `FAILED`, `REJECTED`, `CANCELLED`
- **`PlatformType`**: `instagram`
- **`ImageModelProvider`**: `gpu`, `openai`, `nano_banana_2`
- **`ContractType`**: `RETAINER`, `RETAINER_PLUS_BONUS`
- **Other enums**: for creative/analytics internals (e.g. audit event types).

#### Users & Auth

- **`User`**
  - `id`, `email`, `role: UserRole`, `display_name`, timestamps.
  - Used by `SessionContext` to drive RBAC.

#### AI Models & Canonical References

- **`AiModel`**
  - Identity root: model name, slug, `status: ModelStatus`
  - JSON fields:
    - `body_profile` (height, build, skin tone, hair, eyes, imperfections)
    - `face_profile` (face shape, nose, lips, brows, asymmetries)
    - `personality_profile`
    - `social_tracks_profile` (daily vs editorial, ratios, post goals)
    - `onboarding_state` (workflow state, canonical pack progress)
  - Relations:
    - `versions: ModelVersion[]`
    - `canonical_references: CanonicalReference[]`
    - `campaigns: Campaign[]`

- **`ModelVersion`**
  - LoRA / weights versions for a model
  - Fields: `version`, `weights_gcs_uri`, `status`, `created_at`

- **`ModelReferenceCandidate`**
  - Per-shot candidate images during canonical pack generation
  - Fields: `shot_code`, `image_gcs_uri`, QA scores, selection flags

- **`CanonicalReference`**
  - Final approved canonical images per shot
  - FK to `AiModel`, 1 record per required shot code

#### Presets & Poses

- **`Preset`**
  - Human-facing preset entry (`name`, `mood_tag`, `current_version_id`)
  - Created by a user; soft parent for versions.

- **`PresetVersion`**
  - Immutable aesthetic configuration:
    - `lighting_profile` (direction, intensity, ambient type)
    - `lens_profile` (focal length, aperture, lens type)
    - `color_palette` (hues, saturation, warmth)
    - `grading_curve` (shadows/midtones/highlights)
    - `camera_simulation` (body, film stock)
    - Optional `prompt_fragment`
  - Campaigns always reference a specific `preset_version_id`.

- **`PosePack`**
  - Pose manifest JSON:
    - metadata (`name`, `description`, `compatibility`)
    - array of pose entries (IDs, names, pose/thumbnail URLs, camera angle/framing).

- **`PosePackModels`**
  - Junction between `PosePack` and `AiModel` for compatibility.

#### Campaigns, Jobs, Assets

- **`Campaign`**
  - Core generation unit:
    - FKs: `model_id`, `preset_version_id`, optional `pose_pack_id`
    - `status: CampaignStatus`
    - `batch_size`, `resolution`, `upscale`
    - `creative_controls` JSON (see below)
    - `reference_board` JSON (board of images/links)
  - Relations:
    - `generation_jobs: GenerationJob[]`
    - `assets: Asset[]`
    - `publishing_queue_items: PublishingQueue[]`

- **`GenerationJob`**
  - Tracks each call to an image provider
  - Fields: `status: GenerationJobStatus`, `provider`, cost metrics, seed, payload snapshot.

- **`Asset`**
  - Single generated image:
    - FKs: `campaign_id`, `job_id`
    - GCS URI, drift scores, review/status fields
    - Review fields: `quality_score`, `issue_tags`, `notes`, `flag_artifacts`
    - Refinement state linkage (`AssetRefinementState`).

- **`AssetVariant`**
  - Resized derivatives per `VariantType`.

- **`AssetRefinementState`**
  - Stores micro-controls for a refinement iteration:
    - outfit/pose/expression/realism micro adjustments
    - base asset reference.

#### Publishing & Analytics

- **`PublishingQueue`**
  - Represents a scheduled post:
    - `asset_id`, `variant_type`, `post_type`
    - `caption`, `hashtag_preset_id`
    - `status: PublishingStatus`
    - `scheduled_at`, `published_at`
    - `ig_media_id`, `ig_container_id`
    - `retry_count`, `retry_after`, `error_message`, `rejection_reason`

- **`PublishingLog`**
  - Timeline of publishing actions (create container, publish, retry, failure).

- **`AnalyticsSnapshot`**
  - Metrics per post:
    - `impressions`, `reach`, `likes`, `comments`, `saves`, `shares`
    - `engagement_total`, `engagement_rate`.

#### Clients, Brands, Revenue

- **`Client`**
  - `name`, `status`, `notes`
  - Relations: `brand_profiles`, `assignments`, `revenue_contracts`.

- **`BrandProfile`**
  - Per-brand configuration:
    - `visual_direction` JSON, `voice_notes`.

- **`ClientModelAssignment`**
  - Links `Client` to `AiModel` with `starts_at`, optional `ends_at`.

- **`RevenueContract`**
  - Client commercial agreements:
    - `contract_type`, `monthly_retainer_usd`
    - `starts_at`, `ends_at`
    - Relations: `entries` (macroscopic ledger), `bonus_rules`.

- **`RevenueEntry`**
  - Individual booking:
    - `type: RETAINER | BONUS | ADJUSTMENT`
    - `amount_usd`, `reference_month`, `notes`.

- **`PerformanceBonusRule`**
  - Metric-based bonus triggers:
    - `metric` (e.g. `engagement_rate`)
    - `threshold`, `bonus_amount_usd`.

#### System & Audit

- **`SystemSetting`**: feature flags, configuration state.
- **`AuditLog`**: models operations, who did what and when.
- **`PromptEmbedding`**: pgvector embeddings for prompt similarity/recall.

---

### API Surface (Route Handlers)

All API routes live in `src/app/api/**`. They share:

- `withRouteErrorHandling(request, handler)` from `lib/route-handler.ts`
- `getSessionContext()` and `assertRole()` from `lib/auth.ts`
- Zod validation via `validateOrThrow` and schemas in `server/schemas/api.ts`.

#### Models

- **`POST /api/models`**
  - Purpose: create a new **DRAFT** `AiModel`.
  - Body: `modelCreateSchema` (basic name/slug, initial traits).
  - Auth: `admin`, `operator`.

- **`GET /api/models`**
  - Query: optional filters `status`, search.
  - Response: list of models + canonical status summary.

- **`GET /api/models/[id]/workflow`**
  - Returns full **workflow state** (character/personality/social + canonical pack summary + completion booleans).

- **`PATCH /api/models/[id]/workflow`**
  - Upserts one step of the wizard (character/personality/social).
  - Uses `modelWorkflowStepSchema`.

- **`GET /api/models/[id]/workflow/canonical-pack`**
  - Returns summary of latest canonical pack version + candidates grouped by shot code.

- **`POST /api/models/[id]/workflow/canonical-pack/generate`**
  - Triggers canonical pack generation; idempotent with concurrency guard.
  - Uses GPU/OpenAI/Nano Banana 2 flow depending on env and model version availability.

- **`POST /api/models/[id]/workflow/canonical-pack/approve`**
  - Body: array of selected candidate IDs (must cover all required shots).
  - Creates `CanonicalReference` records and updates model status via workflow service.

- **`POST /api/models/[id]/workflow/finalize`**
  - Recomputes workflow completeness; moves model from `DRAFT` → `ACTIVE` if ready.

#### Campaigns & Assets

- **`POST /api/campaigns`**
  - Body: `campaignCreateSchema`:
    - `model_id`, `preset_version_id`, optional `pose_pack_id`
    - `batch_size`, resolution, `image_model`, optional `creative_controls`.

- **`GET /api/campaigns`**
  - Lists campaigns with model + basic status.

- **`GET /api/campaigns/[id]`**
  - Full campaign view with assets, generation jobs, creative state.

- **`POST /api/campaigns/[id]/generate`**
  - Body: `generateCampaignSchema`:
    - `mode: "anchor" | "batch"`
    - optional `anchor_asset_id`, refinement flags, creative overrides.
  - Uses `campaign-generation-plan` + providers to enqueue jobs and optionally return assets.

- **`POST /api/campaigns/[id]/finalize`**
  - Sets `status` to `APPROVED` or `REJECTED` based on approved assets count.

- **`POST /api/campaigns/[id]/assets/[assetId]/review`**
  - Body: `reviewAssetSchema`:
    - `action: "approve" | "reject" | "flag"`
    - `quality_score`, `issue_tags`, `notes`, `flag_artifacts`.

- **`POST /api/campaigns/[id]/assets/[assetId]/refine`**
  - Body: `assetRefineSchema` containing micro adjustments.
  - Returns `generate_next` payload for subsequent generation call.

#### Publishing & Analytics

- **`POST /api/publishing/schedule`**
  - Body: `schedulePostSchema`:
    - `asset_id`, `post_type`, `caption`, `scheduled_at`, optional hashtag preset.
  - Validates:
    - caption length ≤ 2200
    - lead time ≥ 15 minutes
    - asset must be `APPROVED`.
  - Status:
    - `PENDING_APPROVAL` if approval required
    - else `SCHEDULED`.

- **`POST /api/publishing/[id]/approve`**
  - Moves `PENDING_APPROVAL` → `SCHEDULED`.

- **`POST /api/publishing/[id]/reject`**
  - Sets `status = REJECTED` with `rejection_reason`.

- **`GET /api/publishing/calendar`**
  - Calendar-style view: items with scheduled/published timestamps.

- **`POST /api/cron/publish`**
  - Secured by `assertCronAuthorized`.
  - Calls `publishDuePosts()`:
    - Applies rate limit budget (Instagram calls/hour).
    - Moves due `SCHEDULED`/`RETRY` items through:
      - `PUBLISHING` → `PUBLISHED` or `RETRY`/`FAILED`.

- **`POST /api/cron/analytics`**
  - Secured by `assertCronAuthorized`.
  - Calls `ingestAnalyticsSnapshots()` to fetch/freeze metrics from Instagram.

#### Integrations & Webhooks

- **`POST /api/webhooks/gpu-complete`**
  - GPU provider callback:
    - Validates HMAC signature + timestamp.
    - Updates `GenerationJob` + creates `Asset` records.

- **`GET/POST /api/clients`, `/api/brands`, `/api/revenue/contracts`, `/api/revenue/entries`**
  - CRUD operations for business-side entities (client + revenue).
  - Restricted to admin for writes; read access for admin/operator or client-specific dashboards.

---

### Core Services & Business Logic

#### Model Workflow (`src/server/services/model-workflow.service.ts`)

- Tracks step completion:
  - `isCharacterDesignComplete`, `isPersonalityComplete`, `isSocialStrategyComplete`.
- Determines canonical pack completeness based on required shot codes.
- Computes workflow status:
  - `deriveModelStatusForWorkflow(model, selectedCount)` → `DRAFT | ACTIVE | ARCHIVED`.
- Manages `onboarding_state` (completed steps, current step, timestamps).

#### Canonical Pack (`src/server/services/canonical-pack.service.ts`)

- **Generation**:
  - `startCanonicalPackGeneration(modelId, userId)`:
    - Locks against concurrent runs.
    - Creates new version record.
    - Enqueues async per-shot generation steps.
  - `generateCanonicalPackInternal(...)`:
    - For each required shot:
      - Build prompt from character traits.
      - Call image provider (OpenAI/Nano Banana 2/GPU).
      - Save image in GCS.
      - Run QA scoring.
      - Persist `ModelReferenceCandidate`.

- **Summary**:
  - `getCanonicalPackSummary(modelId)` returns:
    - version, `canonical_pack_status`, per-shot candidate groups, preview URLs.

- **Approval**:
  - `approveCanonicalPack(modelId, candidateIds)`:
    - Validates coverage of all required shots.
    - Inside transaction:
      - Mark selected vs rejected candidates.
      - Create `CanonicalReference` rows.
      - Set pack status to `APPROVED`.
      - Update model workflow if now complete.

#### Creative Controls (`src/server/schemas/creative.ts` + `services/creative-controls.ts`)

- Zod schema encodes 9 control groups:
  - `reference_board`, `outfit`, `pose`, `expression`, `identity`, `realism`, `refinement`, `aesthetic`, `moderation`.
- Service functions:
  - `mergeCreativeControls(base, patch)` – deep merge with validation.
  - `estimateIdentityDriftScore(controls)` – numeric drift estimate.
  - `enrichReferenceBoard(board)` – compute similarity clusters + history.

#### Prompt Builder (`src/server/services/prompt-builder.ts`)

- `buildPrompt(args)`:
  - Base fragments: model name, mood, cinematic quality.
  - Adds creative fragments from `creative_controls`.
  - Appends custom additions.
  - Builds `negativePrompt`.
- Generates deterministic seeds per image based on base seed.

#### Campaign Generation (`src/server/services/campaign-generation-plan.ts`)

- Handles:
  - Mode: `anchor` vs `batch`.
  - Anchor asset requirements and constraints.
  - Effective batch size (accounting for anchor).
  - Mix of references: canonical identity, campaign references, anchor, pose, LUT, refinements.
- Orchestrates provider calls:
  - Builds provider payloads.
  - Accounts for GPU vs OpenAI vs Nano Banana 2 behaviour.

#### GPU Budgeting (`src/server/services/gpu-budget.ts`)

- Tracks monthly GPU cost vs cap.
- Exposes checks to reject generation if above limit.

#### Scheduled Publishing (`src/server/services/publish-scheduled.ts`)

- `publishDuePosts(now)`:
  - Computes remaining call budget for Instagram API.
  - Claims a batch of due queue items with optimistic locking.
  - For each:
    - `createMedia`: build container.
    - `publishMedia`: publish.
    - Logs actions + updates status/IDs.
  - On errors:
    - `classifyPublishFailure(error, retryCount, now)` → `status`, `retryAfter`, message.

#### Analytics Ingest (`src/server/services/ingest-analytics.ts`)

- For each recent `PUBLISHED` post (last 90 days):
  - Calls `provider.fetchInsights(ig_media_id)`.
  - Computes engagement totals and rates.
  - Persists `AnalyticsSnapshot`.

---

### Provider Architecture (Mock & Live)

All providers are unified via `src/server/providers/index.ts`:

- **Image providers**:
  - `OpenAiImageProvider`
  - `NanoBananaImageProvider` (Gemini 3.1 Flash Image)
  - `GpuImageProvider` (custom)
  - `MockImageProvider`

- **GPU providers**:
  - `LiveGpuProvider` (external service, webhooks)
  - `MockGpuProvider`

- **Instagram providers**:
  - `LiveInstagramProvider` (Graph API)
  - `MockInstagramProvider`

Each provider implements a narrow interface (create job, fetch images, create container, publish media, fetch insights) while env vars determine which implementation is used.

---

### Workflows

#### Model Wizard Lifecycle

1. **Create model**
   - `POST /api/models` → `AiModel` with `status = DRAFT`, `canonical_pack_status = NOT_STARTED`.
2. **Step 1 – Character Design**
   - Fill `body_profile` + `face_profile`.
   - Mark step complete in `onboarding_state`.
3. **Step 2 – Personality**
   - Fill `personality_profile` (voice, temperament, interests, boundaries).
4. **Step 3 – Social Strategy**
   - Configure daily vs editorial tracks, ratios, weekly post goals.
5. **Step 4 – Reference Studio**
   - Trigger canonical pack generation.
   - Monitor progress UI grouped by shot code.
6. **Step 5 – Review & Finalize**
   - Select exactly one candidate per required shot.
   - Approve canonical pack.
   - Finalize model; if character + canonical pack complete → `status = ACTIVE`.
7. **Optional – Archive**
   - Admin can mark model `ARCHIVED` (terminal).

#### Campaign Lifecycle

1. **Create campaign**
   - Choose model, preset version, optional pose pack.
   - Configure creative controls, batch size, resolution.
2. **Generate**
   - Trigger generation (anchor/batch/refinement).
   - Jobs created; assets attached as they complete.
3. **Review assets**
   - Approve/reject/flag; apply refinements as needed.
4. **Finalize campaign**
   - Lock-in `APPROVED` or `REJECTED` status.
5. **Publishing**
   - Schedule approved assets for feed/story.
6. **Analytics**
   - Cron ingests insights and populates dashboards.

---

### Security Model

- **Authentication**
  - Supabase JWT validation on server.
  - Demo-mode overrides for local dev (role + user IDs).
- **RBAC**
  - Three roles with strict route-level checks via `assertRole`.
- **CSRF**
  - Implemented in a central proxy:
    - Blocks unsafe cross-origin requests without `Authorization`.
    - Uses `CSRF_TRUSTED_ORIGINS` for allow-list.
- **SSRF**
  - `assertSafePublicHttpUrl`:
    - DNS resolution, IP-range checks, blocked metadata hosts.
- **Webhooks**
  - GPU webhooks signed by HMAC with timestamp skew checks.
- **Cron**
  - `assertCronAuthorized` with constant-time secret comparison.
- **Headers**
  - CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy configured at Next.js level.

---

### Frontend Architecture & State

- **App shell**
  - `AppShell` + `AppProviders` wrap all pages:
    - Theme provider
    - React Query `QueryClientProvider`
    - Notice/breadcrumb contexts.

- **Routing**
  - `(app)` group for authenticated app routes.
  - Subfolders for each major feature (`dashboard`, `models`, `campaigns`, etc.).
  - Role-based nav computed in `nav-config.ts` (admin/operator/client menus).

- **State**
  - React Query for server state (cache keys per resource).
  - Local component state for wizard steps and forms.

- **UI**
  - Tailwind 4 + shadcn-style components.
  - Consistent `PageScaffold` layouts for list/detail views.

---

### Configuration & Feature Flags

From `.env.example` and `env.ts`:

- **Supabase**
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` (server-only).

- **Database**
  - `DATABASE_URL`, `DIRECT_DATABASE_URL`.
  - If you renamed the DB (e.g. to `lacestudio`) and need to bring over data: create the new DB with `pnpm db:create`, run `pnpm prisma migrate deploy`, then set `SOURCE_DB` to your previous database name and run `pnpm run db:copy-data`. Uses `pg_dump`/`pg_restore` (data-only); set `PG_BIN` if PostgreSQL bin is elsewhere (default `C:\Program Files\PostgreSQL\17\bin` on Windows).

- **GCS**
  - `GCS_SERVICE_ACCOUNT_KEY` (JSON), `GCS_PROJECT_ID`, `GCS_MODEL_WEIGHTS_BUCKET`.
  - The service account (e.g. `lacestudio@lacestudio.iam.gserviceaccount.com`) must have **write** access to the bucket used by the app. Photo import and canonical uploads call `storage.objects.create`. Grant one of:
    - **Bucket-level**: `Storage Object Creator` on the bucket (`roles/storage.objectCreator`), or
    - **Bucket-level**: `Storage Object Admin` if you need overwrite/delete too (`roles/storage.objectAdmin`).
  - Grant via GCP Console: Cloud Storage → bucket → Permissions → Add principal → service account email → role **Storage Object Creator** (or Object Admin). Or via gcloud (use the project that contains the bucket):
    - `gcloud storage buckets add-iam-policy-binding gs://BUCKET_NAME --member="serviceAccount:SA_EMAIL" --role="roles/storage.objectCreator" [--project=GCP_PROJECT_ID]`
    - Replace `BUCKET_NAME` (e.g. `lacestudio-model-weights-private`), `SA_EMAIL` (e.g. `lacestudio@lacestudio.iam.gserviceaccount.com`), and optionally `GCP_PROJECT_ID` to match `GCS_PROJECT_ID`.

- **GPU**
  - `GPU_SERVICE_URL`, `GPU_API_KEY`, `GPU_WEBHOOK_SECRET`.

- **AI providers**
  - `OPENAI_API_KEY`, models for image + vision.
  - `NANO_BANANA_API_URL`, `NANO_BANANA_API_KEY`, `NANO_BANANA_MODEL`.

- **Instagram**
  - `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_USER_ID`, provider mode.

- **Feature flags**
  - `IMAGE_PROVIDER_DEFAULT`
  - `GPU_PROVIDER_MODE` (`mock|live`)
  - `INSTAGRAM_PROVIDER_MODE` (`mock|live`)
  - `ENABLE_PROMPT_SIMILARITY`
  - `ENABLE_CLIENT_DASHBOARD`
  - `ENABLE_MODEL_CREATION_WIZARD`
  - `DEMO_MODE`

- **Security**
  - `CRON_SECRET`
  - `CSRF_TRUSTED_ORIGINS`
  - `ALLOW_LOCALHOST_AUTH_BYPASS`
  - `WEBHOOK_MAX_SKEW_MS`

- **Rate limiting**
  - `API_RATE_LIMIT_WINDOW_MS`
  - `API_RATE_LIMIT_MAX_REQUESTS`
  - `API_RATE_LIMIT_MAX_REQUESTS_PER_USER`

Together, these toggles control whether the system runs in **demo**, **staging**, or **production** style modes, which provider implementations are active, and how aggressively APIs are guarded.

---

### Single-File Intent

This **`CODE_REVIEW.md`** now serves both as:

- **Code review** (quality, risks, recommendations) and  
- **Authoritative system reference** (architecture, data, APIs, workflows, security, configuration)

so you can onboard to or reason about the entire LaceStudio system from **one file** without jumping across multiple docs.

---

## Improvement Opportunities Summary

**Analysis Date:** March 4, 2026
**Reviewer:** AI Code Analysis

This section provides a comprehensive, prioritized list of refinement opportunities identified through deep codebase analysis. Each item includes a priority rating, effort estimate, impact assessment, and implementation details.

### Priority Legend
- **P1** – Critical: Security/stability issues, should be addressed soon
- **P2** – High: Significant maintainability/performance improvements
- **P3** – Medium: Quality-of-life improvements
- **P4** – Low: Nice-to-have enhancements

### Effort Legend
- **S** – Small: < 2 hours
- **M** – Medium: 2-8 hours
- **L** – Large: > 8 hours

---

## Architecture & Code Organization

### A1. Split Large Service Files [P2 | L | High Impact]

**Files Affected:**
- `src/server/services/canonical-pack.service.ts` (1,378 lines)
- `src/server/providers/image/nano-banana-image-provider.ts` (1,046 lines)
- `src/server/demo/store.ts` (2,000+ lines)

**Current State:**
The `canonical-pack.service.ts` contains generation logic, approval flows, state management, validation, and polling - all mixed together. Similar issues exist in other large files.

**Recommendation:**
Split into focused modules:

```
src/server/services/canonical-pack/
├── generation.ts        # startCanonicalPackGeneration, generateCanonicalPackInternal
├── approval.ts          # approveCanonicalPack, approveFrontCandidate
├── summary.ts           # getCanonicalPackSummary
├── state.ts             # readCanonicalGenerationState, isCanonicalGenerationStateStale
├── validation.ts        # Shot code validation, candidate validation
└── index.ts             # Re-exports for backward compatibility
```

**Benefits:**
- Easier to test individual concerns
- Clearer separation of responsibilities
- Simpler code review process

---

### A2. Extract Gemini-Specific Code from Nano Banana Provider [P3 | M | Medium Impact]

**File:** `src/server/providers/image/nano-banana-image-provider.ts`

**Current State:**
Gemini API specifics (multipart encoding, thinking config, grounding) are interleaved with general provider logic.

**Recommendation:**
```
src/server/providers/image/
├── nano-banana/
│   ├── gemini-client.ts    # Gemini API specifics
│   ├── multipart.ts        # Image encoding utilities
│   ├── grounding.ts        # Search grounding logic
│   └── index.ts            # Main provider class
```

---

### A3. Decompose Demo Store by Domain [P3 | L | Medium Impact]

**File:** `src/server/demo/store.ts` (2,000+ lines)

**Current State:**
Single monolithic class handles all demo data for models, campaigns, presets, publishing, analytics, etc.

**Recommendation:**
```
src/server/demo/
├── store.ts              # Main store orchestrator
├── stores/
│   ├── model-store.ts    # AI models, versions, canonical packs
│   ├── campaign-store.ts # Campaigns, assets, jobs
│   ├── preset-store.ts   # Presets and versions
│   ├── publish-store.ts  # Publishing queue
│   └── analytics-store.ts # Analytics snapshots
└── types.ts              # Shared demo types
```

---

## Code Duplication & Patterns

### B1. ~~Retry Logic Already Consolidated~~ ✓ COMPLETE

**Status:** The codebase already has a centralized retry utility in `src/lib/retry.ts` that is used by all providers. No action needed.

---

### B2. Demo Mode Checks Pattern [P3 | M | Low Impact]

**Current State:**
```typescript
// Repeated in ~48 API routes
if (isDemoMode()) {
  const result = demoStore.doSomething();
  return ok(result);
}
// Then real implementation...
```

**Recommendation:**
Create a higher-order function pattern:

```typescript
// src/server/demo/route-wrapper.ts
export function withDemoAwareness<T>(
  handler: (session: SessionContext, input: T) => Promise<Response>
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const session = await getSessionContext();
    const input = await parseInput(request);

    if (isDemoMode()) {
      return handleDemoVersion(session, input);
    }
    return handler(session, input);
  };
}
```

**Benefits:**
- Reduces boilerplate in routes
- Centralizes demo mode logic
- Easier to add demo-specific logging/metrics

---

### B3. Pagination Utility Usage [P3 | S | Low Impact]

**Current State:**
`src/server/repositories/pagination.ts` exists but is not consistently used across list endpoints.

**Recommendation:**
Audit all `GET` list endpoints and ensure they use the pagination helper. Add to API style guide.

---

## Type System Improvements

### C1. Consolidate Type Definitions [P3 | M | Medium Impact]

**Current State:**
Domain types defined in multiple locations:
- `src/types/domain.ts` - TypeScript interfaces
- `prisma/schema.prisma` - Prisma enums
- `src/server/schemas/*.ts` - Zod schemas
- Component-local types in `src/components/models/types.ts`

**Recommendation:**
1. Generate TypeScript types from Zod schemas using `z.infer<typeof schema>`
2. Create single source of truth per domain:

```typescript
// src/server/schemas/domain.ts
export const imageModelProviderSchema = z.enum(["gpu", "openai", "nano_banana_2", "zai_glm"]);
export type ImageModelProvider = z.infer<typeof imageModelProviderSchema>;

// Use everywhere instead of duplicating
```

---

### C2. Strict Zod Schema Validation [P2 | M | Medium Impact]

**Current State:**
Some schemas use loose validation:
```typescript
creative_controls: z.record(z.string(), z.unknown()) // Bypasses validation
```

**Recommendation:**
Replace with explicit schemas or use `z.discriminatedUnion` where appropriate. This catches invalid data at the boundary rather than deep in service logic.

---

## Performance Optimizations

### D1. Canonical Pack N+1 Query Issue [P2 | M | Medium Impact]

**Location:** `src/server/services/canonical-pack.service.ts` lines 709-719

**Current State:**
```typescript
const candidates = await prisma.modelReferenceCandidate.findMany({...});
const candidatesWithPreview = await mapWithConcurrency(candidates, 12, async candidate => ({
  ...candidate,
  preview_image_url: await resolveCandidatePreviewUrl(candidate.image_gcs_uri)
}));
```

**Issue:** Each candidate triggers a separate GCS signed URL generation.

**Recommendation:**
1. Batch the GCS URL resolution
2. Consider caching signed URLs (they're valid for hours)
3. Use a single batch call to storage service

---

### D2. Model Wizard Polling [P2 | M | Medium Impact]

**Current State:**
`model-wizard.tsx` polls every 1.5s for up to 240 attempts (6 minutes) for canonical pack status.

**Recommendation:**
Consider Server-Sent Events (SSE) or WebSocket for long-running operations:

```typescript
// New endpoint: /api/models/[id]/workflow/canonical-pack/stream
export async function GET(request: Request) {
  const stream = new ReadableStream({
    start(controller) {
      // Push status updates as they happen
    }
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream" }
  });
}
```

**Benefits:**
- Reduces unnecessary polling requests
- Better UX with real-time updates
- Lower server load

---

### D3. Add Response Caching Headers [P4 | S | Low Impact]

**Current State:**
No explicit cache control headers on API responses.

**Recommendation:**
Add appropriate cache headers:
```typescript
// For stable data like presets
headers: { "Cache-Control": "private, max-age=300" }

// For dynamic data
headers: { "Cache-Control": "private, no-cache" }
```

---

## Security Enhancements

### E1. Implement Rate Limiting [P1 | M | High Impact]

**Current State:**
Environment variables exist (`API_RATE_LIMIT_*`) but no actual implementation in routes.

**Recommendation:**
```typescript
// src/lib/rate-limit.ts
export async function withRateLimit(
  identifier: string,
  options?: { windowMs?: number; maxRequests?: number }
): Promise<void>;

// Usage in routes
export async function POST(request: Request) {
  const session = await getSessionContext();
  await withRateLimit(session.userId);
  // ... handler
}
```

**Consider:** Using Redis for distributed rate limiting if multi-instance deployment.

---

### E2. Webhook Signature Verification Enhancement [P2 | S | Low Impact]

**Current State:**
GPU webhooks use HMAC with timestamp skew checks.

**Recommendation:**
Add constant-time comparison for signature verification to prevent timing attacks:
```typescript
// Use crypto.timingSafeEqual instead of string comparison
```

---

### E3. Localhost Auth Bypass Warning [P1 | S | Low Impact]

**Location:** `src/lib/auth.ts` lines 165-167

**Current State:**
```typescript
if (onLocalhost) {
  return { userId: DEMO_ROLE_USER_IDS.admin, role: "admin" };
}
```

**Recommendation:**
Add explicit logging when bypass is active:
```typescript
if (onLocalhost && env.ALLOW_LOCALHOST_AUTH_BYPASS === "true") {
  console.warn("[AUTH] Localhost auth bypass active - admin role granted");
  return { userId: DEMO_ROLE_USER_IDS.admin, role: "admin" };
}
```

---

## Frontend Improvements

### F1. Extract Custom Hooks from Model Wizard [P3 | M | High Impact]

**File:** `src/components/models/model-wizard.tsx` (653 lines)

**Current State:**
Single component manages:
- Model CRUD
- Workflow state
- Autosave logic
- Canonical pack polling
- Step navigation
- Draft state

**Recommendation:**
```
src/components/models/
├── model-wizard.tsx           # Main orchestrator
├── hooks/
│   use-model-workflow.ts      # Workflow loading/saving
│   use-canonical-generation.ts # Canonical pack polling/generation
│   use-autosave.ts            # Debounced autosave logic
│   └── use-wizard-navigation.ts # Step navigation state
├── context/
│   └── wizard-context.tsx     # Shared wizard state
```

---

### F2. Add Error Boundaries per Feature [P3 | M | Medium Impact]

**Current State:**
Only global error boundary exists.

**Recommendation:**
Add feature-level error boundaries:
```typescript
// src/components/error-boundary.tsx
export function FeatureErrorBoundary({ children, fallback }) {
  return <ErrorBoundary fallback={fallback}>{children}</ErrorBoundary>;
}

// Usage
<FeatureErrorBoundary fallback={<CampaignErrorState />}>
  <CampaignDetail />
</FeatureErrorBoundary>
```

---

### F3. Form Library Integration [P4 | M | Low Impact]

**Current State:**
Forms use controlled components with manual state management. No form library.

**Recommendation:**
Consider `react-hook-form` for complex forms (character design, campaign creation):
- Better validation UX
- Less re-rendering
- Built-in dirty state tracking

---

## Testing Improvements

### G1. Expand E2E Test Coverage [P2 | L | High Impact]

**Current State:**
Only `dashboard.spec.ts` exists.

**Recommendation:**
Add critical user flows:
```
tests/e2e/
├── dashboard.spec.ts          # ✓ Existing
├── model-creation.spec.ts     # Model wizard flow
├── campaign-workflow.spec.ts  # Campaign creation + generation
├── publishing.spec.ts         # Schedule + publish flow
└── authentication.spec.ts     # Login + role-based access
```

---

### G2. Add Component Tests [P3 | M | Medium Impact]

**Current State:**
Limited React component testing.

**Recommendation:**
Add tests for:
- `model-wizard.tsx` - Test step navigation, autosave
- `generation-progress.tsx` - Test progress display
- `creative-controls` components

---

### G3. Integration Test Scenarios [P2 | M | Medium Impact]

**Current State:**
`ssot-scenarios.test.ts` only has placeholder tests.

**Recommendation:**
Implement actual integration tests:
```typescript
describe("Model workflow integration", () => {
  it("creates model, uploads photos, generates canonical pack", async () => {
    // Full workflow test
  });
});
```

---

## Developer Experience

### H1. Add API Documentation [P3 | M | Medium Impact]

**Recommendation:**
Consider adding OpenAPI/Swagger documentation:
```typescript
// Use tRPC or add swagger-jsdoc for auto-generated API docs
```

---

### H2. Improve Error Messages [P3 | S | Low Impact]

**Current State:**
Generic error messages in some places.

**Recommendation:**
Add request IDs to all error responses for debugging:
```typescript
throw new ApiError(400, "VALIDATION_ERROR", "Invalid input", {
  requestId: crypto.randomUUID(),
  details: parsed.error.flatten()
});
```

---

### H3. Add Development Seed Data [P4 | S | Low Impact]

**Current State:**
Seed script exists but could be richer.

**Recommendation:**
Add comprehensive seed scenarios:
- Complete model with approved canonical pack
- Campaign with mixed asset statuses
- Scheduled publishing queue items

---

## Monitoring & Observability

### I1. Add Request Timing [P3 | S | Low Impact]

**Recommendation:**
```typescript
// Middleware or wrapper
const start = performance.now();
// ... handler
log.info("Request completed", { duration_ms: performance.now() - start });
```

---

### I2. Structured Error Context [P3 | S | Low Impact]

**Recommendation:**
Ensure all errors include:
- Request ID
- User ID
- Operation context
- Stack trace (in dev)

---

### I3. Add Health Check Endpoints [P4 | S | Low Impact]

**Current State:**
Basic `/api/health` exists.

**Recommendation:**
Expand to include:
- Database connectivity
- External service status (GCS, Supabase)
- GPU provider health

---

## Summary Table

| ID | Improvement | Priority | Effort | Impact |
|----|-------------|----------|--------|--------|
| A1 | Split large service files | P2 | L | High |
| A2 | Extract Gemini code | P3 | M | Medium |
| A3 | Decompose demo store | P3 | L | Medium |
| B1 | ~~Retry logic~~ | ✓ | - | Complete |
| B2 | Demo mode pattern | P3 | M | Low |
| B3 | Pagination consistency | P3 | S | Low |
| C1 | Consolidate types | P3 | M | Medium |
| C2 | Strict Zod validation | P2 | M | Medium |
| D1 | Fix N+1 queries | P2 | M | Medium |
| D2 | Replace polling with SSE | P2 | M | Medium |
| D3 | Cache headers | P4 | S | Low |
| E1 | Implement rate limiting | P1 | M | High |
| E2 | Webhook security | P2 | S | Low |
| E3 | Auth bypass warning | P1 | S | Low |
| F1 | Extract wizard hooks | P3 | M | High |
| F2 | Error boundaries | P3 | M | Medium |
| F3 | Form library | P4 | M | Low |
| G1 | E2E test expansion | P2 | L | High |
| G2 | Component tests | P3 | M | Medium |
| G3 | Integration tests | P2 | M | Medium |
| H1 | API documentation | P3 | M | Medium |
| H2 | Error messages | P3 | S | Low |
| H3 | Development seeds | P4 | S | Low |
| I1 | Request timing | P3 | S | Low |
| I2 | Error context | P3 | S | Low |
| I3 | Health checks | P4 | S | Low |

---

## Recommended Implementation Order

### Phase 1 (Immediate - P1 items)
1. **E1** - Implement rate limiting (security critical)
2. **E3** - Add auth bypass warning (quick win)
3. **E2** - Fix webhook timing comparison (security)

### Phase 2 (Short-term - P2 items)
4. **A1** - Split canonical-pack.service.ts
5. **D1** - Fix N+1 queries in canonical pack
6. **G1** - Add E2E tests for critical flows
7. **C2** - Stricten Zod validation
8. **D2** - Consider SSE for long operations

### Phase 3 (Medium-term - P3 items)
9. **F1** - Extract hooks from model wizard
10. **C1** - Consolidate type definitions
11. **A2** - Extract Gemini code
12. **G2** - Add component tests
13. **B2** - Demo mode pattern wrapper

### Phase 4 (Long-term - P4 items)
14. **F3** - Form library evaluation
15. **D3** - Add cache headers
16. **H1** - API documentation
17. **A3** - Decompose demo store

---

*Analysis completed March 2026*
