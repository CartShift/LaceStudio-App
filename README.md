# LaceStudio App

LaceStudio is an internal production system for identity-safe synthetic talent operations.
This repository contains a Next.js + Prisma application scaffold aligned with the SSOT.

## Quick Start

```bash
pnpm install
cp .env.example .env
pnpm db:create
pnpm db:migrate
pnpm db:generate
pnpm dev
```

Set `DEMO_MODE=true` to run without Postgres (default in `.env.example`).

## Common Commands

```bash
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
```

## Database Utility Commands

```bash
pnpm db:list
pnpm db:copy-data
```

`db:copy-data` requires `SOURCE_DB` and optionally `PG_BIN`:

```bash
SOURCE_DB=old_database_name pnpm db:copy-data
```

## Dev Utility Commands

```bash
pnpm dev:debug-ping
pnpm dev:capture-screenshots
```

`dev:capture-screenshots` writes output to `docs/screenshots/` and supports:

```bash
SCREENSHOT_BASE_URL=http://localhost:3000 pnpm dev:capture-screenshots
```

## Project Layout

```text
src/         Application code (routes, components, services)
prisma/      Schema, migrations, seed/create scripts
scripts/     Non-runtime utilities (db + dev helpers)
docs/        Specs, status docs, reviews, reference docs, screenshots
tests/       Unit, integration, and e2e suites
tmp/         Local scratch space (ignored)
```

## Documentation

See [`docs/INDEX.md`](docs/INDEX.md) for a full map of project documentation.

Primary documents:
- SSOT: [`docs/specs/LaceStudio-SSOT.md`](docs/specs/LaceStudio-SSOT.md)
- PRD: [`docs/specs/PRD.md`](docs/specs/PRD.md)
- Implementation status: [`docs/status/IMPLEMENTATION_STATUS.md`](docs/status/IMPLEMENTATION_STATUS.md)
- Creative feature delivery: [`docs/status/CREATIVE_FEATURE_IMPLEMENTATION.md`](docs/status/CREATIVE_FEATURE_IMPLEMENTATION.md)
- Instagram Publishing 2.0: [`docs/instagram-publishing-2.0.md`](docs/instagram-publishing-2.0.md)
