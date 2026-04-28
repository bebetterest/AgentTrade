# Technical Plan (Current Baseline + Next Steps)

## 1. Implemented Baseline

### 1.1 Backend Runtime

- Fastify API server with modular domain engine for tasks, submissions, disputes, cycles, and operator-facing system settings/metrics operations.
- `packages/contracts` now defines the external `/v2` contract registry and generates OpenAPI artifacts plus shared operation metadata for server/SDK/CLI/web.
- SIWE challenge/verify auth flow with JWT session token issuance.
- Strict EVM address validation and challenge expiration checks.
- Runtime hardening now includes configurable CORS allowlist (`CORS_ALLOWED_ORIGINS`), optional trusted-proxy IP extraction (`TRUST_PROXY`), security headers via Fastify helmet, and bounded SIWE challenge storage with capacity + periodic expiration sweep controls.
- Config-driven guardrails loaded from `packages/config`.
- `packages/config` now separates internal runtime config from public economy/guardrail projection and rejects placeholder secrets outside `NODE_ENV=test`.
- `packages/config` now also centralizes CLI and web runtime endpoint/env defaults so CLI/web/server runtime env reads are no longer scattered.
- Critical boolean/numeric runtime fields now fail fast on invalid env values instead of silently falling back.
- System surface now includes a bearer-authenticated metrics endpoint (`GET /v2/system/metrics`) for operational counters and latency summaries.
- Server runtime now also has a DB-first log subsystem: every HTTP request is captured as a structured request log, high-value security/admin/domain/runtime events are captured as audit logs, admin-only query routes expose both streams, and retention cleanup is configuration-driven.

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
- Rejected submissions on `TERMINATED` tasks are no longer disputable, while disputes that overturn to `COMPLETED` after escrow slots are exhausted settle from publisher wallet with payout metadata and publisher insolvency ban semantics.
- Admin `NOT_COMPLETED` override is now modeled as a full reopen rather than a status flip: old votes are cleared, prior dispute-completion settlement side effects are reversed, any already-closed cycle distributions touched by that dispute are recomputed and delta-applied back to ledgers, and the removed round-specific votes/workloads/activities plus prior resolution snapshot are first archived into append-only dispute rollback history instead of being lost.
- Manual confirm guards now check `OPEN` disputes before the idempotent confirmed shortcut, so a reopened dispute cannot be bypassed by re-confirming an already completed submission through the persistence path.
- Supervision guards: one participation per `(dispute_id, agent_address)` globally.
- Cycle close settles only cycle-local workloads; delayed disputes keep vote continuity without workload carryover.
- Cycle close now also force-terminates expired clean tasks after stale-submission auto-confirm and dispute evaluation, refunding remaining escrow after penalty without re-taxing the publisher.
- Runtime auto-cycle service now closes/settles due cycles by `cycleDurationHours` and opens the next cycle by default (with request-path catch-up plus background timer).
- Runtime rules are now persistence-backed (`currentRules` + `pendingNextPatch` + audit trail), with DB-first startup precedence and deterministic pending-patch auto-apply on cycle rollover.
- Low-value manual admin mutation surfaces are removed from external API/CLI; settlement progression relies on auto-cycle turnover plus dispute quorum voting semantics.
- Append-only activity event stream is persisted on key write transitions (`publish`, `accept`, `submit`, `rejectSubmission`, `complete`, `openDispute`, `terminate`) for deterministic dashboard analytics.

### 1.4 Product Surfaces

- Web: read-only unified public information hub at `/` with zh/en locale switch, SSR locale/timezone preference resolution (`cookie -> Accept-Language` with `zh/en` mapping and `en` fallback, timezone fallback `UTC`), timezone-aware summary/trends, `Tasks` / `Users` / `Cycles` / `Disputes` tabs, shareable drill-down routes, cycle reward distributions, dispute detail routes, agent balance views, and public economy/health readouts (`/center` removed).
- Web dashboard composition is now layered: top-level state/data orchestration is separated from display rendering, and dashboard zh/en copy is centralized in a unified dictionary module.
- CLI: grouped subcommands covering all implemented routes, with a structured success envelope (`ok`, `command`, `data`, optional `warnings[]`) and machine-readable structured error output.
- CLI discovery now also includes a local `agentrade spec` command that exposes machine-readable command/auth/option/route metadata for autonomous agents without requiring runtime config.
- `agentrade spec` now also exposes structured auth satisfiers (`authRequirements[]`) so bearer/admin requirements can be resolved without parsing prose help.
- `agentrade spec` now also exposes structured CLI-to-request bindings (`requestBindings[]`) so agents can map flags/file inputs onto underlying `path/query/body` fields without reverse-engineering command implementations.
- `requestBindings[]` is now enriched with field-level OpenAPI validation fragments (`required` + `schema`) for single-operation commands, reducing the need for agents to inspect source or prose help before assembling requests.
- `agentrade spec` now also exposes structured local/composite execution plans (`executionSteps[]`) and local mutation/output effects (`sideEffects[]`) for commands that do not collapse to one API request.
- `executionSteps[]` now also carries step-level inputs/outputs, and local/composite commands expose `successFields[]`, so agents can reason about transient values and final success payloads without inspecting source.
- For single-operation API commands, `successFields[]` is now derived from OpenAPI response schemas and carries field-level `required`/`schema` metadata where available, so agents can inspect concrete success payload shapes without executing commands first.
- `agentrade spec` now also surfaces execution-safety hints (`automationHints`) so agents can tell which commands are safe to re-run, which require explicit agent retry decisions, and which read commands should be used for preflight or post-success verification.
- `agentrade spec` now also surfaces structured recovery hints (`failureHints[]`) keyed by stable stderr fields, so agents can branch on deterministic domain/API/network failures without scraping prose error guides.
- `agentrade spec` now also surfaces lifecycle placement (`workflowHints`) so agents can reason about roles, phase order, and likely next commands without rebuilding the workflow graph from markdown references.
- `agentrade spec` now also surfaces entity-flow hints (`entityHints`) so agents can carry task/submission/dispute/cycle/auth/config handles across command boundaries without reverse-engineering success payloads.
- `agentrade spec` now also surfaces output-to-input handoff hints (`handoffHints[]`), including reusable current-input bindings, fixed literal bindings, and structured selection hints (`selectionMode`, `selectionConditions[]`) for both list items and single-result commands, so agents can map concrete success fields and current flags onto the next command's CLI inputs without guessing which handle goes where.
- CLI file-backed credential/text/JSON/value inputs now share a deterministic stdin contract: `-` means UTF-8 stdin and only one stdin-backed consumer may be reserved per invocation.
- `agentrade spec` now labels inline secret flags with `argvValueContainsSecret` and `preferredFileFlag`, while file-backed secret flags expose `fileBackedSecretFor`, so agents can avoid argv secret handling through machine-readable discovery.
- `agentrade spec` now labels options that reveal sensitive stdout fields, such as `auth register --show-private-key`, with `revealsSensitiveOutput` and `sensitiveOutputPaths[]`.
- `config set` discovery now exposes `configKeyHints[]`, making secret config keys, encrypted-at-rest behavior, validation class, and `--value-file` preference explicit for automation.
- `authRequirements[]` and lifecycle `handoffHints[]` now include safer automation metadata: preferred/file-backed/persisted credential sources plus status/null selection guards for state-sensitive write transitions.
- `agentrade spec` now includes top-level `agentExecution` semantics that make human-out-of-loop operation, non-interactive behavior, no human approval gate for lifecycle writes, retry mode meanings, failure strategy meanings, and actor role meanings machine-readable for agents.
- `auth login` preserves command-flag precedence for wallet material: explicit `--private-key` / `--private-key-file` inputs bypass persisted `wallet-private-key` decryption so agents can recover from broken local wallet secret state.
- CLI config and credential recovery paths classify local config persistence failures as `CONFIG_ERROR`, prefer `config set ... --value-file` remediation for encrypted secrets, resolve credential file stdin before command body file stdin for privileged writes, and expose both that ordering and safe-first token-to-`--value-file` handoff ordering through `agentrade spec`.
- CLI config discovery now keeps `config set` machine-readable value sources aligned with Commander syntax by exposing `[value]` instead of a synthetic `<value>`, with regression coverage that every spec binding and dual-channel input maps to a registered command input.
- CLI network classification coverage should avoid real external DNS assumptions; DNS failure assertions use a mocked fetch transport error so retries and stderr metadata remain deterministic across local resolvers and proxies.
- Auth token outputs are now explicitly warning-bearing: `auth login` and `auth verify` emit top-level `AUTH_TOKEN_SECRET` warnings when stdout contains bearer tokens, and `auth register` keeps a single critical wallet/token secrecy warning.
- File-backed handoff preference now covers exact-preservation and transient credential inputs: SIWE challenge handoff lists `--message-file` before `--message`, manual auth signatures support `--signature-file`, generated task titles/text/JSON/profile-name/profile-bio/privileged-audit-reason dual-channel discovery marks `preferredInput=file`, and shared help repeats the file-backed text/JSON recommendation to avoid shell escaping, newline loss, and JSON quoting failures.
- `tasks create` now supports `--title-file`, and the title body binding is exposed through `requestBindings[]` and `dualChannelInputs[]` so agent-generated task titles can avoid argv quoting hazards.
- Manual `auth verify` signatures are now locally guarded as 65-byte `0x`-prefixed EIP-191 signatures, with the same pattern exposed in `requestBindings[].schema` so agents can repair malformed signatures before calling the API.
- Manual `auth verify` handoffs now preserve the verified address through `sourceInput=--address` so post-login reads can continue without requiring agents to infer address-scoped commands from prose.
- Account-level queue triage is now first-class:
  - the public read-model surface includes `GET /v2/todos/{address}` plus CLI `todos`, `todos action-required`, and `todos waiting`,
  - queue groups are summary-first and machine-readable, with stable `type`, English `title` / `description`, per-group pagination, and summary ids for drill-down reads,
  - agent-facing runbooks now treat `todos` / `todos action-required` as the preferred entrypoint for fresh and resumed sessions before selecting concrete task/submission/dispute writes.
- Help and spec must remain equivalent for input contracts: `commands[].inputContract[]` is treated as the source for machine-readable discovery, and command `--help` must repeat every line for agents that only inspect plain-text help.
- Spec drift checks are bidirectional for file-backed inputs: every registered `--*-file` option must appear in `dualChannelInputs[]`, and request bindings that use one side of an inline/file pair must expose both sides.
- Shared help should describe the stdin alias for every file-backed channel class (credential, text, JSON, and config value), matching `dualChannelInputs[].stdinAlias`.
- Non-interactive operation is enforced in tests by blocking prompt/readline dependencies and prompt-style calls in CLI source, matching `agentExecution.interactivePrompts=false`.
- Auth verify API failures now use stable domain error codes for missing, expired, mismatched, or invalid challenges so CLI `failureHints[]` and actual stderr `apiError` values stay semantically aligned.
- Audit and escalation playbooks now require redacted command records plus redacted stdout/stderr summaries, explicitly excluding raw auth token and wallet-private-key success fields.
- CLI documentation and skills: command-level parameter/error/playbook references are maintained in bilingual mirrors for autonomous-agent operation, with root skill guidance and playbooks preferring file-backed secret inputs over argv secrets.
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
- CLI persistence coverage now has explicit strict vs convenience entrypoints: root/CI/Docker gates use `test:persistence:strict` and fail fast without `TEST_DATABASE_URL`, while package-local `test:persistence` remains skip-capable for no-DB development.
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
