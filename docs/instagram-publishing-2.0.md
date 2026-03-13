# Instagram Publishing 2.0

## Update

This document describes the profile-centric publishing foundation.

The March 13, 2026 optimization pass that adds:

- Reel publishing
- async reel-variant generation
- views-first analytics
- experiment tagging
- auto-queue materialization
- per-format strategy tuning

is documented in [`instagram-optimization-2026.md`](./instagram-optimization-2026.md).

## Summary

Instagram publishing has been rebuilt around explicit profile ownership instead of a single global account.
Each model now gets its own publishing profile, strategy, recommendation plan, queue context, and strategy-aware analytics surface.

This upgrade adds:

- normalized Instagram profile records per model
- encrypted per-profile auth storage
- OAuth-based account connection
- strategy pillars and slot templates
- recommendation/planning items above the queue
- profile-aware publish and analytics services
- a profile-centric cockpit UI and profile drilldown workspace

The implementation is operator-confirmed in v1.
Recommendations generate next-post suggestions and schedule skeletons, but publishing still requires explicit approval/scheduling actions.

## Data Model

The following Prisma models were added in [`prisma/schema.prisma`](/C:/Users/yotam/Desktop/Personal%20Projects/ModelsOS/aptos-app/prisma/schema.prisma):

- `InstagramProfile`
- `InstagramProfileAuth`
- `PostingStrategy`
- `StrategyPillar`
- `StrategySlotTemplate`
- `PostingPlanItem`

`PublishingQueue` was extended with:

- `profile_id`
- `plan_item_id`
- `pillar_key`
- `slot_start`
- `strategy_snapshot`

Related migration:

- [`prisma/migrations/0006_instagram_profiles_strategy/migration.sql`](/C:/Users/yotam/Desktop/Personal%20Projects/ModelsOS/aptos-app/prisma/migrations/0006_instagram_profiles_strategy/migration.sql)

## Backend Changes

Core services:

- [`src/server/services/instagram-profiles.service.ts`](/C:/Users/yotam/Desktop/Personal%20Projects/ModelsOS/aptos-app/src/server/services/instagram-profiles.service.ts)
  - profile bootstrap from models
  - explicit OAuth start/callback flow
  - encrypted token persistence
  - per-profile account loading
  - token refresh
  - cockpit summary aggregation
- [`src/server/services/posting-strategy.service.ts`](/C:/Users/yotam/Desktop/Personal%20Projects/ModelsOS/aptos-app/src/server/services/posting-strategy.service.ts)
  - legacy social track normalization
  - default strategy generation
  - strategy persistence
  - recommendation/plan generation
  - skip handling
- [`src/server/services/publishing-schedule.service.ts`](/C:/Users/yotam/Desktop/Personal%20Projects/ModelsOS/aptos-app/src/server/services/publishing-schedule.service.ts)
  - shared scheduling logic for manual scheduling and recommendation acceptance
- [`src/server/services/analytics-reporting.service.ts`](/C:/Users/yotam/Desktop/Personal%20Projects/ModelsOS/aptos-app/src/server/services/analytics-reporting.service.ts)
  - profile/pillar/post-type filters
  - strategy-aware analytics aggregation
- [`src/server/services/publish-scheduled.ts`](/C:/Users/yotam/Desktop/Personal%20Projects/ModelsOS/aptos-app/src/server/services/publish-scheduled.ts)
  - per-profile publish execution
  - per-profile budget tracking
  - auth failure mapping to owning profile
- [`src/server/services/ingest-analytics.ts`](/C:/Users/yotam/Desktop/Personal%20Projects/ModelsOS/aptos-app/src/server/services/ingest-analytics.ts)
  - per-profile analytics fetch and sync updates

Encryption helper:

- [`src/server/services/secret-box.ts`](/C:/Users/yotam/Desktop/Personal%20Projects/ModelsOS/aptos-app/src/server/services/secret-box.ts)

Timezone helper:

- [`src/lib/timezone.ts`](/C:/Users/yotam/Desktop/Personal%20Projects/ModelsOS/aptos-app/src/lib/timezone.ts)

## API Surface

New routes:

- `GET/POST /api/instagram/profiles`
- `POST /api/instagram/profiles/:id/oauth/start`
- `GET /api/instagram/oauth/callback`
- `POST /api/instagram/profiles/:id/disconnect`
- `GET/PUT /api/instagram/profiles/:id/strategy`
- `GET /api/publishing/recommendations`
- `POST /api/publishing/recommendations/:id/accept`
- `POST /api/publishing/recommendations/:id/skip`
- `GET /api/analytics/strategy`

Updated routes:

- `POST /api/publishing/schedule`
- `GET /api/publishing/calendar`
- `GET /api/publishing/assets`
- `GET /api/analytics/dashboard`
- `GET /api/analytics/posts`

## Frontend

Main publishing surfaces:

- [`src/app/(app)/publish/page.tsx`](/C:/Users/yotam/Desktop/Personal%20Projects/ModelsOS/aptos-app/src/app/(app)/publish/page.tsx)
  - profile-centric publishing cockpit
  - connection health
  - cadence/readiness summaries
  - next-post previews
- [`src/app/(app)/publish/profiles/[id]/page.tsx`](/C:/Users/yotam/Desktop/Personal%20Projects/ModelsOS/aptos-app/src/app/(app)/publish/profiles/[id]/page.tsx)
  - per-profile workspace
  - tabs for `Strategy`, `Next Posts`, `Queue`, `Performance`
- [`src/app/(app)/publish/approvals/page.tsx`](/C:/Users/yotam/Desktop/Personal%20Projects/ModelsOS/aptos-app/src/app/(app)/publish/approvals/page.tsx)
  - approvals grouped with profile context
- [`src/app/(app)/analytics/page.tsx`](/C:/Users/yotam/Desktop/Personal%20Projects/ModelsOS/aptos-app/src/app/(app)/analytics/page.tsx)
  - strategy pattern and pillar reporting
- [`src/app/(app)/analytics/posts/page.tsx`](/C:/Users/yotam/Desktop/Personal%20Projects/ModelsOS/aptos-app/src/app/(app)/analytics/posts/page.tsx)
  - expanded post-level strategy fields

## Environment Variables

Defined in [`src/lib/env.ts`](/C:/Users/yotam/Desktop/Personal%20Projects/ModelsOS/aptos-app/src/lib/env.ts):

- `FACEBOOK_APP_ID`
- `FACEBOOK_APP_SECRET`
- `INSTAGRAM_OAUTH_REDIRECT_URI`
- `APP_ENCRYPTION_KEY`
- `INSTAGRAM_PROVIDER_MODE`

Current behavior:

- `INSTAGRAM_PROVIDER_MODE=live` enables the real provider
- `APP_ENCRYPTION_KEY` is required to store OAuth-derived account credentials
- legacy `INSTAGRAM_ACCESS_TOKEN` and `INSTAGRAM_USER_ID` are no longer used to auto-connect profiles

## Connection Flow

Current connection flow:

1. Operator opens the publishing cockpit.
2. Admin clicks `Connect` on a profile card.
3. `POST /api/instagram/profiles/:id/oauth/start` creates an expiring OAuth state and returns a Facebook authorization URL.
4. Meta redirects back to `/api/instagram/oauth/callback`.
5. The callback exchanges the code for a short-lived token, then a long-lived token.
6. The callback reads `/me/accounts` and looks for a Facebook Page with both:
   - `access_token`
   - `instagram_business_account.id`
7. On success, the profile is marked `CONNECTED` and encrypted credentials are saved in `instagram_profile_auth`.

Important behavior:

- connection is explicit only; there is no automatic env-based connection bootstrap
- the current implementation picks the first eligible Page returned by Meta
- there is no Page/account selection UI yet

## Current Limitations

- If the Facebook login user has access to multiple Pages, the backend currently selects the first eligible Page with an attached Instagram business account.
- There is no deterministic Page picker yet.
- OAuth will fail if Meta returns Pages without `instagram_business_account`.
- The app expects a professional Instagram account connected to a Facebook Page.
- Meta app configuration is still required for valid permissions and Facebook Login redirect handling.

## Debugging Notes

When OAuth succeeds but no eligible Instagram account is found:

- the callback records debug metadata on the profile under `profile_metadata`
- the error details include `oauth_debug.pages`

This helps identify whether:

- Meta returned zero Pages
- Meta returned Pages without `instagram_business_account`
- the wrong Facebook user was used during login

## Testing and Verification

Verified during implementation:

- `pnpm prisma generate`
- `pnpm typecheck`
- targeted unit tests:
  - [`tests/unit/live-instagram-provider.test.ts`](/C:/Users/yotam/Desktop/Personal%20Projects/ModelsOS/aptos-app/tests/unit/live-instagram-provider.test.ts)
  - [`tests/unit/analytics-dashboard-route.test.ts`](/C:/Users/yotam/Desktop/Personal%20Projects/ModelsOS/aptos-app/tests/unit/analytics-dashboard-route.test.ts)
  - [`tests/unit/analytics-posts-route.test.ts`](/C:/Users/yotam/Desktop/Personal%20Projects/ModelsOS/aptos-app/tests/unit/analytics-posts-route.test.ts)
  - [`tests/unit/publish-scheduled.test.ts`](/C:/Users/yotam/Desktop/Personal%20Projects/ModelsOS/aptos-app/tests/unit/publish-scheduled.test.ts)
  - [`tests/unit/posting-strategy.service.test.ts`](/C:/Users/yotam/Desktop/Personal%20Projects/ModelsOS/aptos-app/tests/unit/posting-strategy.service.test.ts)

## Operational Notes

- If Prisma generate fails on Windows with an engine DLL rename error, clear stale `query_engine-windows.dll.node*` files in `.prisma/client` and rerun generation.
- The `0006_instagram_profiles_strategy` migration must be applied before loading the cockpit in database mode.
- Existing wrongly auto-connected legacy rows were reset during implementation; future connections should happen only via OAuth.
