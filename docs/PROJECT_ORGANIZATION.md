# Project Organization Guide

This repository uses a simple split to keep runtime code separate from utilities and documentation.

## Runtime Directories

- `src/`: Next.js app routes, components, server services, providers, and shared libs.
- `prisma/`: Schema, migrations, seed, and DB bootstrap scripts.
- `public/`: Static assets served by Next.js.
- `supabase/`: Edge functions and cron SQL.

## Non-Runtime Directories

- `scripts/db/`: Database utility scripts (`list-databases`, `copy-db-data`).
- `scripts/dev/`: Local developer utilities (debug helpers, screenshot capture).
- `docs/`: Product specs, status docs, technical references, and screenshots.
- `tests/`: Unit/integration/e2e suites.
- `tmp/`: Local scratch files (ignored).

## Conventions

- Keep feature code under `src/` and avoid adding one-off scripts there.
- Put reusable scripts under `scripts/` with descriptive names (avoid `temp-*` naming).
- Keep long-form documentation under `docs/` and link it from `docs/INDEX.md`.
- Keep root-level files minimal: config, lock files, and main `README.md`.
