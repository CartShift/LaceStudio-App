# Creative Feature Implementation Plan + Delivery

Last updated: 2026-03-03

## Scope

This document maps the premium editorial creative workflow requirements into implemented API, domain, and UI changes.

## Completed Implementation

### 1) Pinterest Reference Integration

- Campaign-level `reference_board` controls with:
  - URL import (`POST /api/campaigns/:id/references`)
  - Multi-reference support with `primary/secondary` weighting
  - Active version + history tracking
  - Similarity scoring from deterministic embedding extraction
  - Side-by-side reference preview in campaign detail UI
- Persisted in `campaigns.creative_controls` and `campaign_reference_versions`

### 2) Outfit Adjustment Controls

- Structured outfit controls:
  - Fabric/color/fit/texture descriptors
  - Silhouette mode
  - Accessory layering list
  - Material realism mode
  - Movement preset
  - Wardrobe lock
  - Micro-adjustment vector (hem/sleeve/collar)
- Wired into prompt builder + generate overrides

### 3) Pose Customization Module

- Pose preset support
- ControlNet pose lock flag
- Body proportion protection + limb correction flags
- Micro pose rotation controls (shoulder/hip/chin)
- Batch variation count
- Selective regeneration supports per-image pose micro-adjustments

### 4) Facial Expression Tuning

- Expression preset support
- Smile intensity slider
- Eye focus, brow tension, lip tension controls
- Consistency + lock flags
- Used in prompt composition and per-generation override

### 5) Identity Consistency Engine

- Face lock, body ratio lock, skin mapping, imperfection persistence controls
- Identity drift score estimation
- Drift alert threshold + alert output in generation response
- Rollback version field in control schema

### 6) Realism Control Layer

- Skin/pore/lighting/shadow/noise/fabric realism controls
- Lens simulation and depth-of-field controls
- Artifact detection flag
- Artifact moderation support at asset-level (`artifacts_flagged`)

### 7) Batch Refinement Workflow

- Generate -> review -> refine loop
- Selective regeneration: `regenerate_asset_id` in generate API
- Per-asset refinement state route:
  - `POST /api/campaigns/:id/assets/:assetId/refine`
- Refinement state persistence:
  - `asset_refinement_states` table
  - `assets.refinement_index` + `assets.refinement_history`

### 8) Aesthetic Preset Management

- Extended `creative_controls.aesthetic` support for:
  - Mood tags
  - Lighting profile name
  - LUT URL
  - Campaign-wide aesthetic lock
- Surfaced in create-campaign UI and prompt builder fragments

### 9) Creative Moderation Dashboard

- Review UI now includes:
  - Approve / reject / flag actions
  - Quality score
  - Notes
  - Issue tags
  - Artifact flag
  - Save refinement state per image
- Asset moderation fields persisted:
  - `quality_score`
  - `moderation_notes`
  - `issue_tags`
  - `artifacts_flagged`

### 10) Multi-Model Image Generation (GPU + OpenAI + Nano Banana 2)

- New model-provider abstraction:
  - `gpu`
  - `openai`
  - `nano_banana_2`
- Provider implementations:
  - GPU adapter to existing callback pipeline
  - OpenAI image generation provider
  - Nano Banana 2 provider (configurable endpoint/key)
- Campaign-level provider + model id persisted:
  - `campaigns.image_model_provider`
  - `campaigns.image_model_id`
- Routed by `POST /api/campaigns/:id/generate`

## New/Updated API Endpoints

- `PATCH /api/campaigns/:id/creative-controls`
- `GET /api/campaigns/:id/creative-controls`
- `POST /api/campaigns/:id/references`
- `GET /api/campaigns/:id/references`
- `POST /api/campaigns/:id/assets/:assetId/refine`
- Updated:
  - `POST /api/campaigns`
  - `POST /api/campaigns/:id/generate`
  - `POST /api/campaigns/:id/assets/:assetId/review`
  - `GET /api/campaigns/:id`

## New Persistence Objects

- Enum: `ImageModelProvider`
- Columns:
  - `campaigns.image_model_provider`
  - `campaigns.image_model_id`
  - `campaigns.creative_controls`
  - `campaigns.reference_board_version`
  - `assets.quality_score`
  - `assets.moderation_notes`
  - `assets.issue_tags`
  - `assets.artifacts_flagged`
  - `assets.identity_drift_score`
  - `assets.refinement_index`
  - `assets.refinement_history`
- Tables:
  - `campaign_reference_versions`
  - `asset_refinement_states`

## Delivered UI Surfaces

- `/campaigns/new`:
  - Provider/model selection
  - Pinterest URLs
  - Outfit/pose/expression/identity/realism controls
  - Moderation threshold + mood tags
- `/campaigns/:id`:
  - Side-by-side reference view
  - Generate + selective regeneration
  - Micro-adjustment sliders
  - Reference URL import
- `/campaigns/:id/review`:
  - Moderation controls
  - Asset issue tagging
  - Refinement save action

## Validation Status

- `pnpm lint` passed
- `pnpm typecheck` passed
- `pnpm test` passed
- `pnpm build` passed

## Environment Additions

- `OPENAI_IMAGE_MODEL`
- `NANO_BANANA_API_URL`
- `NANO_BANANA_API_KEY`
- `NANO_BANANA_MODEL`
- `IMAGE_PROVIDER_DEFAULT`

