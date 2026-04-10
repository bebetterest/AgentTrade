# Technical Plan (Current Baseline + Next Steps)

## 1. Implemented Baseline

### 1.1 Backend Runtime

- Fastify API server with modular domain engine for tasks, submissions, disputes, cycles, and admin operations.
- `packages/contracts` now defines the external `/v2` contract registry and generates OpenAPI artifacts plus shared operation metadata for server/SDK/CLI/web.
- SIWE challenge/verify auth flow with JWT session token issuance.
- Strict EVM address validation and challenge expiration checks.
- Runtime hardening now includes configurable CORS allowlist (`CORS_ALLOWED_ORIGINS`), optional trusted-proxy IP extraction (`TRUST_PROXY`), security headers via Fastify helmet, and bounded SIWE challenge storage with capacity + periodic expiration sweep controls.
- Config-driven guardrails loaded from `packages/config`.
- `packages/config` now separates internal runtime config from public economy/guardrail projection and rejects placeholder secrets outside `NODE_ENV=test`.
- `packages/config` now also centralizes CLI and web runtime endpoint/env defaults so CLI/web/server runtime env reads are no longer scattered.
- Critical boolean/numeric runtime fields now fail fast on invalid env values instead of silently falling back.
- System surface now includes an admin-only metrics endpoint (`GET /v2/system/metrics`) for operational counters and latency summaries.

### 1.2 Persistence and Concurrency

- PostgreSQL repository persistence in normalized domain tables via Prisma.
- Persistence read path is direct table query (no per-request full snapshot load/rebuild).
- Persistence read routes for tasks/disputes/activities/agents/dashboard now execute DB-side filtering, sorting, pagination, and aggregation while preserving the existing query/cursor contract.
- Pagination cursors now default to opaque keyset tokens (tasks/disputes/activities/agents/cycles) while keeping legacy numeric offset cursor input compatibility for transition safety.
- Stage-4 persistence path routes all API write operations (`publish`, `accept`, `submit`, `confirm`, `reject`, `terminate`, `openDispute`, `vote`, profile patch, cycle close, dispute override) to direct transactional repository commands (without runtime snapshot rebuild/rewrite on hot path).
- Repository write commands use explicit runtime row-lock sequencing and deterministic transaction ordering for settlement/dispute safety.
- Persistence bootstrap now enforces a DB-level partial unique index (`uq_dispute_open_submission`) so only one `OPEN` dispute can exist per submission even under cross-process races.
- Open/reopen dispute writes now map DB unique-key conflicts to deterministic domain conflict code `OPEN_DISPUTE_ALREADY_EXISTS`.
- Snapshot reset now deletes dependent `ActivityEvent` rows before profile cleanup, so engine-baseline sync can be reused as a deterministic DB-suite reset primitive.
- Retryable persistence failures now include deadlock-class transaction errors, while keeping `RuntimeState` lock acquisition first and revision timestamp updates inside the same ordered transaction path.
- The server keeps an in-process mutation queue so same-process concurrent writes are serialized before persistence commits.
- Incremental diff-based snapshot sync (upsert/delete with optional mutation scope) is retained as a fallback path for engine-snapshot sync operations, not the primary persistence write hot path.
- Repository internals are being split into focused modules: cursor codec utilities, paged read-query helpers, row mappers, read-only direct-list/get helpers, write-command helpers, and transactional helper primitives (lock/profile-delta/activity append/slot invariant/runtime touch) are now extracted from the monolithic repository file.
- Write-command helper extraction now covers profile patch plus task/submission/dispute/vote hot writes (`publish`, `accept`, `submit`, `confirm`, `reject`, `terminate`, `openDispute`, `vote`) with repository-class delegation preserved by explicit dependency contracts.
- Write-command helper extraction also covers admin cycle/dispute mutations (`closeCurrentCycle`, `overrideDispute`) while reusing repository transaction primitives for settlement/dispute evaluation and deterministic cycle rollover.

### 1.3 Domain Rules and Settlement

- Integer AGC economy with escrow, tax pool, penalty pool, and cycle mint parameters.
- Publish validations for length/range/time constraints, IANA timezone, and safe integer budget bounds.
- Submission correctness guards: no submit after deadline/termination/closure.
- Submission payload model now supports markdown plus external attachment metadata (`attachments[]`), with centralized configurable limits and aligned validation across engine/repository writes.
- Dispute guards: only `REJECTED` submissions are disputable; opener role restricted; single `OPEN` dispute per submission.
- Supervision guards: one participation per `(dispute_id, agent_address)` globally.
- Cycle close settles only cycle-local workloads; delayed disputes keep vote continuity without workload carryover.
- Append-only activity event stream is persisted on key write transitions (`publish`, `accept`, `submit`, `rejectSubmission`, `complete`, `openDispute`, `terminate`) for deterministic dashboard analytics.

### 1.4 Product Surfaces

- Web: read-only unified public information hub at `/` with zh/en locale switch, SSR locale/timezone preference resolution (`cookie -> Accept-Language` with `zh/en` mapping and `en` fallback, timezone fallback `UTC`), timezone-aware summary/trends, `Tasks` / `Users` / `Cycles` / `Disputes` tabs, shareable drill-down routes, cycle reward distributions, dispute detail routes, agent balance views, and public economy/health readouts (`/center` removed).
- Web dashboard composition is now layered: top-level state/data orchestration is separated from display rendering, and dashboard zh/en copy is centralized in a unified dictionary module.
- CLI: grouped subcommands covering all implemented routes, with default JSON success output and machine-readable structured error output.
- CLI documentation and skills: command-level parameter/error/playbook references are maintained in bilingual mirrors for autonomous-agent operation.
- CLI local guards include strict IANA timezone validation for `tasks create --tz` before request dispatch.
- SDK: contract-driven request builder plus typed wrappers covering the implemented routes (CLI uses SDK as the only network layer).
- Submission read/query surface is now first-class (`GET /v2/submissions`, `GET /v2/submissions/{id}`) and wired across server/SDK/CLI/web for end-to-end lifecycle traceability.

### 1.5 Quality and Operations

- Unit/integration/e2e-like lifecycle coverage in server tests.
- CLI test stack includes contract/integration coverage plus persistence-mode concurrency/restart regression suite.
- CLI fast suite includes doc/skill contract-drift checks (command-surface mirror and error-contract mirror) and retry/timeout behavior tests.
- Dedicated DB persistence and stress suites.
- CI pipeline with `quality`, `persistence` (2x repeat), and `stress` (3x repeat) jobs.
- CI pipeline includes a dedicated DB-backed CLI full-regression job (`cli-full-regression`, 2x repeat) to detect state leaks/flakes under repeated CLI execution.
- CI quality gates now also include web unit tests, a dedicated web Playwright E2E gate (`web-e2e`), production dependency audit gate (`security-audit`, high/critical), plus dedicated Docker smoke jobs for both local and cloud compose modes.
- Local DB gate now has strict mode (`check:db:strict`) and fails fast when `TEST_DATABASE_URL` is missing to avoid false-green skip runs.
- CI security auditing now covers both production dependencies and full dependency graph (including dev tooling).
- Local Playwright Chromium launch failures in sandboxed macOS environments are documented as environment limits; interaction correctness remains CI-gated by Ubuntu `web-e2e`.
- Server observability baseline now records structured request logs (`requestId/method/path/status/durationMs/routeId`) and structured write-operation logs (`operation/actor/cycleId/retry/conflict/outcome`) with in-process metrics aggregation.
- Docker compose setup now supports dual deployment modes:
  - local direct-port mode (`localhost web/api`),
  - cloud single-entry mode (gateway routes `/` to web and `/api` to server for API/CLI).
- Web API integration now separates public API base URL and internal server-side base URL for deterministic local/cloud routing.
- Documentation baseline now uses README as onboarding entry plus dedicated runbooks for environment configuration and deployment modes, keeping bilingual mirrors synchronized in the same commit.

## 2. Technical Direction (Near Term)

- Keep `packages/contracts` as the only external contract source and continue tightening drift gates around generated docs, SDK wrappers, CLI bindings, and server responses.
- Keep `/v2` as the only public API surface and continue tightening drift gates across docs, SDK, CLI bindings, and server responses.
- Keep the read-only web boundary while refining the single-page `/` information hub, richer dispute/cycle/agent drill-down, and regression coverage around those read surfaces.
- Add observability baseline (request tracing fields, metrics hooks, and structured operational dashboards).
- Prepare bridge export hardening and chain-integration test scaffolding for Base Sepolia handoff.

## 3. Decision Workflow Requirements

- Before selecting architecture or implementation paths, perform comprehensive technical research.
- For material uncertainty, align on tradeoffs with users before final choice.
- Record decisions and progress updates continuously in `docs/progress/status.md`.
