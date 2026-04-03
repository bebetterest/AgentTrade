# Web Information Center Build Progress

## Goal

Deliver a read-only web information center with:

- Home overview metrics (`today` and `current cycle`) for task publish/accept/complete/dispute counts.
- Three tab views (`Tasks`, `Users`, and `Cycles`) with masonry cards, infinite scroll, search/filter/sort where applicable.
- Drawer + detail page drill-down.
- Cycle reward pool/distribution/workload drill-down and agent balance readout.
- Trend and leaderboard modules.
- Full URL state sync.

## Module Tracker

| Module | Scope | Status | Notes |
| --- | --- | --- | --- |
| M1 | Progress docs setup | DONE | This file + Chinese mirror created |
| M2 | Backend event log + read APIs | DONE | `ActivityEvent` model + write-path event append + dashboard/activities/agents routes |
| M3 | Shared types + SDK + CLI parity | DONE | New shared contracts, SDK methods, CLI command surface and tests updated |
| M4 | Web UI rebuild and interactions | DONE | New information center home, tabs, masonry cards, infinite scroll, drawer + detail pages |
| M5 | Docs sync and verification | DONE | API/CLI/docs mirror updates + lint/tests green |

## Phase 2 Module Tracker

| Module | Scope | Status | Notes |
| --- | --- | --- | --- |
| M6 | Context panels (cycle + live activity stream) | DONE | Added active cycle health card + global activity feed with deep-link open behavior |
| M7 | Filter usability refinement | DONE | Added quick task-status pills and one-click reset for task/user filters |
| M8 | Build hardening and regression verification | DONE | Fixed Next.js App Router compatibility and reran lint/build checks |

## Phase 3 Module Tracker

| Module | Scope | Status | Notes |
| --- | --- | --- | --- |
| M9 | Observability states (error/retry/empty hierarchy) | DONE | Added overview/feed/tasks/agents error states, retry entry, filter-aware empty states, and manual load-more fallback |
| M10 | Web E2E automation (search/filter/sort/detail/pagination) | DONE* | Playwright config + mocked API tests implemented; runtime execution blocked in current environment by Chromium launch permission |

## Phase 4 Module Tracker

| Module | Scope | Status | Notes |
| --- | --- | --- | --- |
| M11 | CI integration for Web E2E | DONE | Added dedicated `web-e2e` GitHub Actions job with Playwright browser install, E2E run, and report artifact upload |

## Phase 5 Module Tracker

| Module | Scope | Status | Notes |
| --- | --- | --- | --- |
| M12 | Cycles tab + cycle drill-down | DONE | Added cycle list tab, active-cycle deep links, drawer view, and full page route |
| M13 | Richer task/agent detail surfaces | DONE | Task detail now shows escrow/slot/dispute detail; agent detail now shows ledger balance and expanded stats |
| M14 | Reward/distribution contract alignment | DONE* | `cycles/{id}/rewards` now exposes `rewardPool` + `distributions`; unit tests updated and E2E mocks aligned, but full browser execution remains environment-blocked here |

## Phase 2 API Delta

- Extended `GET /v2/cycles/{id}/rewards` to return `cycle`, `rewardPool`, `distributions[]`, and `workloads[]`.
- Consumed existing read APIs for richer detail pages: `GET /v2/ledger/{address}`, `GET /v2/cycles`, `GET /v2/cycles/{id}`, and `GET /v2/disputes/{id}`.
- No new write APIs were added.

## Acceptance Checklist

- [x] Metrics are accurate by timezone day-window and active-cycle window.
- [x] `Tasks` tab supports masonry + infinite scroll + search/filter/sort.
- [x] `Users` tab defaults to active agents and supports leaderboard score sort.
- [x] `Cycles` tab supports list pagination, active-cycle deep links, and reward/workload drill-down.
- [x] Drawer detail and full detail pages are linked and URL-shareable.
- [x] Agent detail shows current ledger balance and task detail shows escrow/slot/dispute context.
- [x] Markdown fields are rendered via safe subset strategy.
- [x] SDK and CLI expose new read routes.
- [x] OpenAPI and bilingual docs are updated in the same commit.

## Verification Snapshot

- `npm --prefix apps/server run lint` passed.
- `npm --prefix apps/server test` passed (repository/persistence suites remain skipped without persistence env).
- `npm --prefix packages/sdk run lint` passed.
- `npm --prefix apps/cli run lint` passed.
- `npm --prefix apps/cli test` passed.
- `npm --prefix apps/web run lint` passed.
- `apps/web` unit tests passed (`vitest run`).
- `npm --prefix apps/web run build` passed (Next.js 15 production build).

## Incremental Update Log

- 2026-04-03: Delivered Phase 2 web product closure:
  - Added `Cycles` tab, cycle detail drawer, and full page route at `apps/web/src/app/cycles/[id]/page.tsx`.
  - Extended task detail and agent detail routes/components with escrow/slot/dispute context plus current ledger balance.
  - Added cycle/task/agent detail render tests in `apps/web/src/components/dashboard/detail-panels.test.tsx`.
  - Updated Playwright mock coverage in `apps/web/test/e2e/dashboard.spec.ts` for cycles, ledger, and single-dispute reads; full browser execution remains blocked in this environment by Chromium launch permission.

- 2026-03-31: Added/verified API integration tests for dashboard summary/trends and agents/activities list behavior in `apps/server/test/api.spec.ts`; server suite result now `29` tests passed in `api.spec.ts`.
- 2026-03-31: Fixed Next.js 15 build blockers in web details and home routing:
  - Updated app-router detail page props to Promise-based `params` in:
    - `apps/web/src/app/tasks/[id]/page.tsx`
    - `apps/web/src/app/agents/[address]/page.tsx`
  - Wrapped dashboard entry with `Suspense` in `apps/web/src/app/page.tsx` for `useSearchParams` CSR bailout requirement.
- 2026-03-31: Phase 2 web enhancement delivered:
  - Added active cycle fetch path (`fetchActiveCycle`) and home preload in `apps/web/src/lib/api.ts` + `apps/web/src/app/page.tsx`.
  - Expanded dashboard with:
    - cycle status card (status/start/uptime/generated-at),
    - live activity stream (event-tag visualization + deep-link open),
    - quick task status pill filters + reset action.
  - Updated style system for the new modules in `apps/web/src/app/globals.css`.
  - Re-verified web checks: `npm --prefix apps/web run lint` and `npm --prefix apps/web run build` both passed.
- 2026-03-31: Phase 3 enhancement delivered:
  - Added explicit observability UX for home and list modules:
    - overview error card + retry,
    - feed error state + loading state,
    - task/agent list error states + filter-aware empty copy,
    - manual `Load more` button fallback while keeping infinite scroll.
  - Added test hooks (`data-testid`) across tabs/filters/cards/drawer to stabilize E2E selectors.
  - Added Playwright E2E stack in `apps/web`:
    - `apps/web/playwright.config.ts`,
    - `apps/web/test/e2e/dashboard.spec.ts` (3 scenarios),
    - `apps/web/package.json` scripts and dependencies.
  - E2E verification in this machine:
    - `playwright test --list` passed (test discovery OK),
    - full `playwright test` run blocked by Chromium launch permission (`mach_port rendezvous permission denied`), not by test logic.
- 2026-03-31: Phase 4 CI enablement delivered:
  - Updated `.github/workflows/ci.yml` with `web-e2e` job (`needs: quality`):
    - installs dependencies via `pnpm`,
    - installs Chromium via `playwright install --with-deps chromium`,
    - runs `pnpm --filter @agentrade/web test:e2e`,
    - uploads `apps/web/playwright-report` and `apps/web/test-results` artifacts on every run.
