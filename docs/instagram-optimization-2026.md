# Instagram 2026 Optimization Upgrade

## Scope

This document covers the first pass of the March 13, 2026 Instagram optimization upgrade.
It documents:

- what changed in the product and codebase
- why those changes were made
- the strategy findings that informed the implementation
- current limitations and next steps

This document complements, and does not replace, [`instagram-publishing-2.0.md`](./instagram-publishing-2.0.md), which describes the earlier profile-centric publishing foundation.

## Executive Summary

The system has been upgraded from a feed/story-first publishing planner into a views-first Instagram optimization system with Reel support, per-account strategy learning, caption/SEO recommendation packaging, reel-variant generation, and guarded auto-queue materialization.

The core implementation direction is:

- Reels drive discovery.
- Feed posts drive saves, shares, and editorial identity.
- Stories drive retention, replies, and lightweight testing.
- Views are the lead KPI.
- Experiments should be explicit and tagged.
- Auto-queue should be gated by profile health, asset readiness, and confidence.

## Strategy Findings

### 1. Views are now the primary Instagram performance currency

High-confidence finding as of March 13, 2026:

- Instagram measurement has shifted away from impressions and toward views.
- Any optimization system that still treats impressions as the primary KPI is now behind the platform.

Research basis:

- Sprout Social support documentation on Instagram metric changes, March 2025:
  - [Important Update: Changes to Instagram Metrics in Sprout - March 2025](https://support.sproutsocial.com/hc/en-us/articles/35294459755533-Important-Update-Changes-to-Instagram-Metrics-in-Sprout-March-2025)
- Sprout Social support documentation for influencer metrics after the April 21, 2025 API change:
  - [Influencer Marketing: Changes to Instagram Metrics April 2025](https://support.sproutsocial.com/hc/en-us/articles/36060184236045-Influencer-Marketing-Changes-to-Instagram-Metrics-April-2025)
- Meta official Postman workspace for Instagram insights:
  - [Insights](https://www.postman.com/meta/instagram/folder/w5jo9vk/insights)
  - [Media Insights](https://www.postman.com/meta/instagram/request/qsr9h14/media-insights)

Implementation consequence:

- `AnalyticsSnapshot` now stores `views`.
- analytics dashboards lead with `views`, `share_rate`, `save_rate`, and watch quality.
- recommendation scoring prioritizes view-led outcomes.

### 2. Reels remain the main discovery surface

High-confidence finding:

- Reels are the best fit for non-follower reach and top-of-funnel discovery.
- Instagram still separates ranking behavior by surface: Feed, Stories, Explore, Reels, Search.

Research basis:

- [How the Instagram Algorithm Works [Updated 2026]](https://sproutsocial.com/insights/instagram-algorithm/)
- Meta official Postman workspace for Reel publishing:
  - [Reels Publishing](https://www.postman.com/meta/instagram/folder/u2uos9l/reels-publishing)
  - [Publish the container (Reels)](https://www.postman.com/meta/instagram/request/x3dbkbx/publish-the-container-reels)
  - [Publish Reel](https://www.postman.com/meta/instagram/request/8bjzwzf/publish-reel)

Implementation consequence:

- `reel_9x16` is now a first-class variant type.
- the live Instagram provider now creates `media_type=REELS` containers with `video_url`.
- the strategy engine includes `discoverability_reels` as a default pillar and schedules reel slots in the cold-start cadence.

### 3. Shares, saves, and watch quality matter more than vanity likes

High-confidence finding:

- Feed and Explore ranking continue to reward content that earns attention and interaction beyond likes.
- For Reels, watch quality and non-follower pickup matter.
- For Stories, replies and relationship signals matter more than generic feed-style engagement.

Research basis:

- [How the Instagram Algorithm Works [Updated 2026]](https://sproutsocial.com/insights/instagram-algorithm/)
- [Instagram Insights: How to Access and Use IG Data](https://sproutsocial.com/insights/instagram-insights/)
- [Instagram Best Practices in 2026: Go From Clicks to Conversions](https://sproutsocial.com/insights/instagram-best-practices/)

Implementation consequence:

- Reel slots are scored with `views`, share rate, save rate, and watch metrics.
- Feed slots are scored with share/save/comment behavior.
- Story slots are scored with replies and views where available.
- `AnalyticsSnapshot` now stores `replies_count`, `avg_watch_time_ms`, `total_watch_time_ms`, `profile_visits_count`, `follows_count`, and `raw_metrics`.

### 4. Timing should be account-specific, not one-size-fits-all

High-confidence finding:

- Early engagement still matters.
- Posting when followers are active improves the chance of stronger first-hour performance.

Research basis:

- [How the Instagram Algorithm Works [Updated 2026]](https://sproutsocial.com/insights/instagram-algorithm/)
- [Instagram Insights: How to Access and Use IG Data](https://sproutsocial.com/insights/instagram-insights/)
- Buffer timing research:
  - [Best Time to Post on Social Media in 2025: Every Platform](https://buffer.com/resources/best-time-to-post-social-media)

Implementation consequence:

- `PostingStrategy.best_time_windows` was added.
- the strategy engine seeds default windows and uses learned windows for slot scoring.
- the profile workspace exposes best-time-window editing.

### 5. Consistency beats inactivity, but there are diminishing returns

High-confidence finding:

- Sustainable consistency is more important than occasional bursts.
- Buffer's 2M-post study supports `3-5` in-feed Instagram posts weekly as a strong sustainable range for growth, with diminishing returns above that.
- Stories should not be treated as the primary non-follower acquisition surface.

Research basis:

- [How Often Should You Post on Instagram in 2026? What Data From 2 Million Posts Tells Us](https://buffer.com/resources/how-often-to-post-on-instagram/)
- [How Often to Post on Social Media in 2026 - Data-Backed Guide](https://buffer.com/resources/how-often-post-social-media/)
- [The State of Social Media Engagement in 2026: 52M+ Posts Analyzed](https://buffer.com/resources/state-of-social-media-engagement-2026/)

Implementation consequence:

- the default strategy uses a balanced weekly mix of `2 feed`, `2 reels`, and `3 stories`.
- the system exposes per-format weekly targets instead of a single undifferentiated post count.
- auto-queue and recommendation logic are built around weekly pacing rather than ad hoc manual queueing only.

### 6. Structured experimentation is now part of normal Instagram strategy

High-confidence finding:

- Testing hooks, sounds, and formats should be systematic rather than ad hoc.
- Trial Reels are a strong signal that structured experimentation is becoming normal operating procedure for growth teams.

Research basis:

- [3 Strategic Ways to Use Instagram Trial Reels for Growth (Now You Can Schedule Them in Later)](https://later.com/blog/instagram-trial-reels-strategy-how-to-use/)

Implementation consequence:

- the strategy engine reserves experimentation slots via `experimentation_rate_percent`.
- experiment tags are stored in `PostingPlanItem.autopilot_metadata` and queue snapshots.
- direct Trial Reels API support is not required in v1; experimentation is represented in our own planning layer.

### 7. Searchability and metadata now matter more

High-confidence finding:

- Keyword-aware captions, searchable hashtags, and descriptive metadata improve discoverability.
- Instagram search behavior is now important enough that caption strategy should include SEO-style packaging, not just creative copy.

Research basis:

- [How the Instagram Algorithm Works [Updated 2026]](https://sproutsocial.com/insights/instagram-algorithm/)
- [Instagram Best Practices in 2026: Go From Clicks to Conversions](https://sproutsocial.com/insights/instagram-best-practices/)

Implementation consequence:

- recommendations now include a `caption_package` with:
  - primary keyword
  - opening hook
  - call to action
  - hashtags
  - rationale
- the profile composer can load the SEO package into the caption field.

### 8. Authenticity still matters; automation should assist, not fake originality

Inference from sources:

- Sprout's 2026 content strategy guidance and best-practice guidance point toward human-generated, audience-specific, trusted content rather than generic output.
- That does not prohibit AI assistance, but it argues against generic, obviously templated posting.

Research basis:

- [The 2026 Social Media Content Strategy Report](https://sproutsocial.com/insights/data/2026-social-media-content-strategy-report/)
- [Instagram Best Practices in 2026: Go From Clicks to Conversions](https://sproutsocial.com/insights/instagram-best-practices/)

Implementation consequence:

- operator approval remains in the system.
- auto-queue only materializes approved, high-confidence opportunities.
- reel auto-publishing is constrained to original-audio workflows; trend-sound usage is intentionally left operator-assisted.

## What Was Implemented

## 1. Data Model

Prisma changes in [`../prisma/schema.prisma`](../prisma/schema.prisma):

- added `MediaKind`
- extended `VariantType` with `reel_9x16`
- added `VideoGenerationJob`
- expanded `AssetVariant` with:
  - `media_kind`
  - `duration_ms`
  - `mime_type`
  - `preview_image_gcs_uri`
- expanded `AnalyticsSnapshot` with:
  - `views`
  - `replies_count`
  - `avg_watch_time_ms`
  - `total_watch_time_ms`
  - `profile_visits_count`
  - `follows_count`
  - `raw_metrics`
- expanded `PostingStrategy` with:
  - `primary_goal`
  - `weekly_feed_target`
  - `weekly_reel_target`
  - `weekly_story_target`
  - `experimentation_rate_percent`
  - `auto_queue_min_confidence`
  - `best_time_windows`

Migration:

- [`../prisma/migrations/0010_instagram_2026_optimization/migration.sql`](../prisma/migrations/0010_instagram_2026_optimization/migration.sql)

## 2. Shared Types and Environment

Updated shared domain types:

- [`../src/types/domain.ts`](../src/types/domain.ts)

Updated environment schema and examples:

- [`../src/lib/env.ts`](../src/lib/env.ts)
- [`../.env.example`](../.env.example)

New environment variables:

- `VIDEO_PROVIDER_MODE`
- `VEO_API_URL`
- `VEO_API_KEY`
- `VEO_MODEL`

## 3. Video Generation Layer

New provider abstraction and services:

- [`../src/server/providers/video/types.ts`](../src/server/providers/video/types.ts)
- [`../src/server/providers/video/mock-video-provider.ts`](../src/server/providers/video/mock-video-provider.ts)
- [`../src/server/providers/video/live-video-provider.ts`](../src/server/providers/video/live-video-provider.ts)
- [`../src/server/services/video-generation.service.ts`](../src/server/services/video-generation.service.ts)

What this layer does:

- creates reel-generation jobs from approved assets
- polls provider jobs
- stores generated MP4 outputs as `AssetVariant`
- exposes variant/job listing for the UI

## 4. Instagram Publishing Provider

Updated provider files:

- [`../src/server/providers/instagram/types.ts`](../src/server/providers/instagram/types.ts)
- [`../src/server/providers/instagram/live-instagram-provider.ts`](../src/server/providers/instagram/live-instagram-provider.ts)
- [`../src/server/providers/instagram/mock-instagram-provider.ts`](../src/server/providers/instagram/mock-instagram-provider.ts)

Key behavior changes:

- Reel publishing is enabled in the live provider.
- `createMedia()` now supports:
  - `imageUrl`
  - `videoUrl`
  - `shareToFeed`
- Reel containers use:
  - `media_type=REELS`
  - `video_url=<asset>`
- insights fetching now normalizes:
  - views
  - replies
  - watch metrics
  - profile visits
  - follows

## 5. Strategy Engine

Main implementation file:

- [`../src/server/services/posting-strategy.service.ts`](../src/server/services/posting-strategy.service.ts)

What changed:

- default strategy became a four-pillar balanced-growth model:
  - `discoverability_reels`
  - `saveable_feed`
  - `editorial_identity`
  - `relationship_stories`
- default cadence is now:
  - 2 feed
  - 2 reels
  - 3 stories
- best-time-window support was added
- recommendation scoring became format-aware and recency-weighted
- caption/SEO packaging was added
- experimentation tagging was added
- auto-queue readiness metadata was added

Important recommendation metadata now emitted:

- `caption_package`
- `experiment_tag`
- `score_breakdown`
- `reel_variant_ready`
- `queue_eligible`

## 6. Auto-Queue Materialization

Implementation:

- [`../src/server/services/auto-queue.service.ts`](../src/server/services/auto-queue.service.ts)
- [`../src/app/api/cron/auto-queue/route.ts`](../src/app/api/cron/auto-queue/route.ts)

Behavior:

- generates or refreshes recommendations
- materializes queue items only when:
  - `auto_queue_enabled=true`
  - account health is acceptable
  - confidence exceeds `auto_queue_min_confidence`
  - reel slots have a reel-ready variant
  - queue conflicts are absent

## 7. Analytics

Implementation:

- [`../src/server/services/ingest-analytics.ts`](../src/server/services/ingest-analytics.ts)
- [`../src/server/services/analytics-reporting.service.ts`](../src/server/services/analytics-reporting.service.ts)
- [`../src/app/api/analytics/dashboard/route.ts`](../src/app/api/analytics/dashboard/route.ts)
- [`../src/app/api/analytics/strategy/route.ts`](../src/app/api/analytics/strategy/route.ts)
- [`../src/app/api/analytics/posts/route.ts`](../src/app/api/analytics/posts/route.ts)

Key changes:

- dashboards lead with `total_views`
- post tables support sorting by `views`
- reporting now returns:
  - `avg_share_rate`
  - `avg_save_rate`
  - `best_time_windows`
  - `experiment_win_rate`
  - `reel_readiness`

## 8. Scheduling and Publish Execution

Implementation:

- [`../src/server/services/publishing-schedule.service.ts`](../src/server/services/publishing-schedule.service.ts)
- [`../src/server/services/publish-scheduled.ts`](../src/server/services/publish-scheduled.ts)
- [`../src/app/api/publishing/schedule/route.ts`](../src/app/api/publishing/schedule/route.ts)
- [`../src/app/api/publishing/recommendations/[id]/accept/route.ts`](../src/app/api/publishing/recommendations/[id]/accept/route.ts)
- [`../src/app/api/cron/publish/route.ts`](../src/app/api/cron/publish/route.ts)

Behavior changes:

- reel schedule validation now requires a `reel_9x16` video variant
- publish execution resolves media URLs by variant type
- publish cron now:
  - processes pending video jobs
  - materializes auto-queue recommendations
  - publishes due items

## 9. UI and Operator Surfaces

Main files:

- [`../src/app/(app)/publish/profiles/[id]/page.tsx`](../src/app/(app)/publish/profiles/[id]/page.tsx)
- [`../src/app/(app)/analytics/page.tsx`](../src/app/(app)/analytics/page.tsx)
- [`../src/app/(app)/analytics/posts/page.tsx`](../src/app/(app)/analytics/posts/page.tsx)
- [`../src/app/(app)/publish/approvals/page.tsx`](../src/app/(app)/publish/approvals/page.tsx)

What the profile workspace now includes:

- optimization package panel
- reel generation lab
- reel-ready asset indicators
- post-type support for `reel`
- caption SEO package loading
- per-format weekly strategy controls
- best-time-window editing
- views-first performance cards

## 10. API Additions and Contract Changes

New routes:

- `POST /api/assets/:id/reel-variant`
- `GET /api/assets/:id/reel-variants`
- `POST /api/cron/auto-queue`

Updated route families:

- `GET/PUT /api/instagram/profiles/:id/strategy`
- `GET /api/publishing/recommendations`
- `POST /api/publishing/recommendations/:id/accept`
- `POST /api/publishing/schedule`
- `GET /api/publishing/assets`
- `GET /api/analytics/dashboard`
- `GET /api/analytics/strategy`
- `GET /api/analytics/posts`

## Validation Performed

Verified during implementation:

- `pnpm prisma generate --no-engine`
- `pnpm typecheck`
- targeted unit tests:
  - [`../tests/unit/posting-strategy.service.test.ts`](../tests/unit/posting-strategy.service.test.ts)
  - [`../tests/unit/live-instagram-provider.test.ts`](../tests/unit/live-instagram-provider.test.ts)
  - [`../tests/unit/analytics-dashboard-route.test.ts`](../tests/unit/analytics-dashboard-route.test.ts)
  - [`../tests/unit/analytics-posts-route.test.ts`](../tests/unit/analytics-posts-route.test.ts)
  - [`../tests/unit/analytics-reporting.service.test.ts`](../tests/unit/analytics-reporting.service.test.ts)
  - [`../tests/unit/publish-scheduled.test.ts`](../tests/unit/publish-scheduled.test.ts)

Not yet done in this pass:

- full repository test suite
- migration application against a live database
- full E2E coverage for the new reel-generation flow

## Current Limitations

- Trial Reels are represented in our planning model, but there is no direct Trial Reels publishing flow in v1.
- Trending-sound reel workflows remain operator-assisted.
- Carousel publishing remains deferred even though Meta supports it.
- Best-time windows can be edited and learned into the strategy model, but there is not yet a dedicated automated retraining job that rewrites them from analytics snapshots.
- The live video provider assumes a Veo/Gemini-style long-running prediction flow and may need endpoint-specific adaptation in production.

## Recommended Next Steps

1. Apply the `0010_instagram_2026_optimization` migration in the target environments.
2. Add an automated best-time-window learning job that rewrites `PostingStrategy.best_time_windows` from recent analytics.
3. Add integration tests for:
   - reel generation job lifecycle
   - reel-ready auto-queue materialization
   - live provider insight normalization with partial metric payloads
4. Add E2E coverage for:
   - generating a reel variant
   - queueing a reel recommendation
   - reviewing views-first analytics in the profile workspace
5. Decide whether v2 should support:
   - carousel publishing
   - direct Trial Reels workflow support
   - multiple video-generation providers
