# Web Information Center Build Progress

## Goal

Deliver a read-only web information center with:

- A unified single-page information hub at `/` that combines narrative framing and data-heavy research modules.
- Home overview metrics (`today` and `current cycle`) for task publish/intentions/complete/dispute counts.
- Four tab views (`Tasks`, `Users`, `Cycles`, and `Disputes`) with masonry/list cards, infinite scroll or load-more fallback, and search/filter/sort where applicable.
- Drawer + detail page drill-down.
- Cycle reward pool/distribution/workload drill-down and agent balance readout.
- Trend and leaderboard modules plus public economy/health trust surfaces.
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

## Phase 6 Module Tracker

| Module | Scope | Status | Notes |
| --- | --- | --- | --- |
| M15 | Public home + research center split | DONE | `/` rebuilt as narrative public home, old dashboard moved to `/center`, legacy `/?tab=...` share links redirect compatibly |
| M16 | Disputes tab + dispute detail routes | DONE | Added `Disputes` top-level tab, status/sort query state, drawer flow, and `/disputes/[id]` full page route |
| M17 | Trust surfaces + visual refresh | DONE | Added public economy/health readouts, sticky site header, unified card hierarchy, and research-style visual tokens across home/center |

## Phase 7 Module Tracker

| Module | Scope | Status | Notes |
| --- | --- | --- | --- |
| M18 | Single-page hub merge (`/center` removal) | DONE | Merged home + center into `/`, removed `/center` route (404), kept URL-state query semantics, and upgraded lifecycle flow into a visual diagram |

## Phase 2 API Delta

- Extended `GET /v2/cycles/{id}/rewards` to return `cycle`, `rewardPool`, `distributions[]`, and `workloads[]`.
- Consumed existing read APIs for richer detail pages: `GET /v2/ledger/{address}`, `GET /v2/cycles`, `GET /v2/cycles/{id}`, and `GET /v2/disputes/{id}`.
- No new write APIs were added.

## Acceptance Checklist

- [x] Metrics are accurate by timezone day-window and active-cycle window.
- [x] `Tasks` tab supports masonry + infinite scroll + search/filter/sort.
- [x] `Users` tab defaults to active agents and supports leaderboard score sort.
- [x] `Cycles` tab supports list pagination, active-cycle deep links, and reward/workload drill-down.
- [x] `Disputes` tab supports list browse, status filter, sort, drawer detail, and shareable full page detail.
- [x] Drawer detail and full detail pages are linked and URL-shareable.
- [x] `/` is the single dashboard-bearing route and `/center` is removed.
- [x] Agent detail shows current ledger balance and task detail shows escrow/slot/dispute context.
- [x] Public economy params and system health are visible in read-only trust modules.
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

- 2026-04-08: Delivered streams interaction and redundancy cleanup pass:
  - switched streams search trigger to explicit submit only (search button or Enter), removing blur-triggered auto-query behavior,
  - extracted streams filter toolbar into `apps/web/src/components/dashboard/streams-filter-toolbar.tsx`,
  - extracted a shared list shell (`apps/web/src/components/dashboard/list-panel-shell.tsx`) and reused it across task/agent/cycle/dispute panels for consistent error/loading/empty/load-more behavior.

- 2026-04-04: Delivered single-page hub merge:
  - Promoted `/` to the only Web information hub route and removed `apps/web/src/app/center/page.tsx` (`/center` now 404).
  - Rebuilt dashboard hero into runtime-first single-page structure with in-page anchors (`#overview`, `#flow`, `#streams`) and compact trust signals on the hero rail.
  - Added a dedicated lifecycle flow diagram module (`FlowDiagram`) and unit coverage for English/Chinese rendering.
  - Preserved query-driven tab/filter/detail state semantics on `/` and rewired all in-app deep links from `/center?...` to `/?...#streams`.
  - Updated direct detail pages (`tasks/agents/cycles/disputes`) so back-navigation and error guidance target the information hub instead of the removed center route.
  - Updated web E2E specs for the new single-page IA and added explicit `/center` removal expectation.

- 2026-04-03: Delivered second-pass Web V2 polish:
  - Upgraded `apps/web/src/components/site-header.tsx` into a mobile-aware navigation shell with overlay menu behavior.
  - Restructured the former home economy/trust area into richer rule-card and trust-block sections so public economy/guardrail data reads as a research surface instead of a plain metric list.
  - Added compact tracked-entity summary chips to `apps/web/src/components/dashboard/dashboard-view.tsx` and extended the center trust card with persistence/bridge visibility.
  - Unified detail drawers behind a reusable focus-trapped shell, restored consistent full-page deep links from task/agent drawers, and reflowed tabs/filter controls for mobile-first use.
  - Added arrow-key/Home/End keyboard navigation for center tabs, plus stronger focus-visible feedback for keyboard use.
  - Applied state-specific chip tones across task/agent/cycle/dispute cards and replaced raw dispute/event enums with reader-friendly labels in public home and dispute detail timelines.
  - Localized task, cycle, and agent status labels end-to-end so cards, detail shells, and task filter controls no longer expose raw enum values like `IN_PROGRESS` or `ACTIVE`.
  - Added a shared full-page detail shell so `/tasks/[id]`, `/agents/[address]`, `/cycles/[id]`, and `/disputes/[id]` now use the same hero-summary structure instead of four diverging layouts.
  - Extracted reusable task/agent detail content modules so drawer views and standalone detail pages stay behaviorally aligned.
  - Extended Playwright coverage with direct-route checks for task/agent/cycle/dispute full pages, so standalone detail URLs are now part of the web regression surface.
  - Added Playwright assertions that task, cycle, and agent surfaces render reader-facing status labels (`Open`, `In progress`, `Closed`, `Active`, `Idle`) rather than leaking raw enum literals.
  - Added an end-to-end locale persistence path covering home-page switch, `/center` client-state carryover, and direct detail-page SSR refresh via locale cookies/localStorage.
  - Added explicit detail-state cards for direct-route `404` and API-failure cases, and extended Playwright coverage so standalone detail pages now cover success, not-found, and load-failed states.
  - Added unit coverage for localized dashboard status helpers in both English and Chinese to keep public-facing terminology aligned with the shared copy source.
  - Hardened `apps/web` lint execution by prefixing `next typegen`, so route-type validation no longer depends on pre-existing `.next/types` artifacts.
  - Normalized remaining zh user-facing copy that still mixed in raw English domain terms such as `Agent`, `Mint`, and `workload`, and added overflow wrapping across detail surfaces/data tables for long ids, addresses, and summary values.
  - Revalidated with `npm --prefix apps/web run lint`, `npm --prefix apps/web run test:unit`, and `npm --prefix apps/web run build`.

- 2026-04-03: Delivered Web V2 public-surface restructure:
  - Moved the old dashboard entry from `/` to `/center` and rebuilt `/` as a narrative public information station.
  - Added `Disputes` as a first-class tab with status/sort URL state, detail drawer behavior, and full page route at `apps/web/src/app/disputes/[id]/page.tsx`.
  - Added public trust modules for economy params and system health, plus a shared sticky site header and refreshed research-style card system in `apps/web/src/app/globals.css`.
  - Added legacy share-link compatibility so old `/?tab=...` dashboard URLs redirect to `/center` without losing query state.
  - Revalidated with `npm --prefix apps/web run lint`, `npm --prefix apps/web run test:unit`, `npm --prefix apps/web run build`, and `npm --prefix apps/server run test`.

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
