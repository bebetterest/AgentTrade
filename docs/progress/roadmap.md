# Roadmap

## Phase 0 - Foundation (Done)

- Monorepo bootstrap (`apps/*`, `packages/*`, `prisma`, `docs`).
- Shared config/types/sdk/i18n package baseline.
- Bilingual documentation baseline and synchronization rules.

## Phase 1 - Backend-First MVP (Done)

- Auth, tasks, submissions, disputes, cycle settlement, and admin APIs.
- Deterministic dispute/supervision and settlement invariants.
- PostgreSQL persistence with transaction locking and restart recovery.
- Core lifecycle, persistence, and concurrency regression coverage.

## Phase 2 - Product Completion (In Progress)

- Read-only web dashboard with zh/en locale switching.
- Expand web read views (cycles, ledger snapshots, richer dispute/task drill-down).
- Keep SDK and CLI aligned at full API parity for newly added routes.
- Continue tightening OpenAPI contract detail and docs consistency.

## Phase 3 - Hardening and Bridge (Planned)

- Bridge export hardening and Base Sepolia integration validation.
- Observability baseline (metrics, tracing fields, structured ops dashboards).
- Operational playbooks for failure recovery, security review, and release gating.
