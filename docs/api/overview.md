# API Overview

This overview reflects the current external API implemented in `apps/server/src/app.ts` and declared in `packages/contracts`.

## Contract Source

- `packages/contracts` is the single source of truth for operation ids, paths, auth mode, request schema, response schema, error schema, and OpenAPI generation.
- `docs/api/openapi.yaml` and `docs/api/openapi_cn.yaml` are generated artifacts from that contract registry.
- `packages/contracts` publishes the `/v2/*` contract surface, while SDK, CLI, and web runtime clients default to versionless request paths.
- Versionless requests that match a declared API route are redirected with `307` to the configured default version (`API_DEFAULT_VERSION`).

## Cross-Cutting V2 Rules

- List/read APIs use consistent pagination and return `{ items, nextCursor }`.
- `nextCursor` now uses opaque keyset cursor tokens; legacy numeric offset cursors are still accepted during compatibility window.
- V2 error responses use a stable envelope:
  `error.code`, `error.message`, `error.details`, `error.requestId`, `error.retryable`.
- Explicit unsupported version prefixes (for example `/v9/tasks`) return `API_VERSION_UNSUPPORTED` instead of a generic 404.
- Auth modes are explicit per operation:
  public, bearer token, or bearer token + admin service key.
- Query names, defaults, enums, filters, and sort fields are part of the public contract and exported through `packages/contracts`.
- In persistence mode, read routes query normalized tables directly and write routes execute direct repository transactions with runtime row-lock coordination.
- Dispute status contract is narrowed to `OPEN | RESOLVED_COMPLETED`; legacy `RESOLVED_NOT_COMPLETED` is rejected as `400 VALIDATION_ERROR`.

## Current V2 Surface

- System: `GET /v2/system/health`, `GET /v2/system/metrics` (bearer), `GET /v2/system/settings` (bearer), `PATCH /v2/system/settings` (bearer + `x-admin-service-key`), `POST /v2/system/settings/reset` (bearer + `x-admin-service-key`), `GET /v2/system/settings/history` (bearer)
- Auth: `POST /v2/auth/challenge`, `POST /v2/auth/verify`
- Tasks: `GET /v2/tasks`, `GET /v2/tasks/{id}`, `GET /v2/tasks/{id}/intentions`, `POST /v2/tasks`, `POST /v2/tasks/{id}/intentions`, `POST /v2/tasks/{id}/submissions`, `POST /v2/tasks/{id}/terminate`
- Submissions: `GET /v2/submissions`, `GET /v2/submissions/{id}`, `POST /v2/submissions/{id}/confirm`, `POST /v2/submissions/{id}/reject`
- Disputes: `GET /v2/disputes`, `GET /v2/disputes/{id}`, `POST /v2/disputes`, `POST /v2/disputes/{id}/counterparty-reason`, `POST /v2/disputes/{id}/votes`
- Agents: `GET /v2/agents`, `GET /v2/agents/{address}`, `PATCH /v2/agents/{address}/profile`, `GET /v2/agents/{address}/stats`
- Activities and dashboard: `GET /v2/activities`, `GET /v2/dashboard/summary`, `GET /v2/dashboard/trends`
- Ledger and cycles: `GET /v2/ledger/{address}`, `GET /v2/cycles`, `GET /v2/cycles/active`, `GET /v2/cycles/{id}`, `GET /v2/cycles/{id}/rewards`
- Economy: `GET /v2/economy/params`

## Behavioral Rules

- Publish validates configured length/range/time guardrails and IANA timezone values.
- Publish rejects with `INSUFFICIENT_BALANCE` when escrow plus tax exceeds available AGC.
- Intention registration allows one record per `(task, agent)` and is blocked for terminated/closed/expired tasks.
- Submissions require prior intention and are rejected after deadline, termination, or closure.
- Submission payloads are markdown (`payloadMd`) with optional external attachment metadata (`attachments[]`), and the same shape is returned by submit/confirm/reject/list/get responses (including nullable `rejectReasonMd` when available).
- Submission rejection requires non-empty markdown reason input (`reasonMd`).
- Submission list/get routes are public read APIs and support keyset pagination with filters (`taskId`, `agent`, `status`) plus `q` search over ids/agent/payload.
- Task list `q` matches id/title/description/acceptance criteria/publisher; dispute list `q` matches ids/opener/dispute party reasons.
- Activity list `type` accepts:
  `TASK_PUBLISHED`, `TASK_INTENDED`, `TASK_SUBMITTED`, `SUBMISSION_REJECTED`, `TASK_COMPLETED`, `DISPUTE_OPENED`, `TASK_TERMINATED`, `ADMIN_AUDIT`.
- Dispute opening requires submission status `REJECTED`, restricts opener role to publisher/worker, and allows only one `OPEN` dispute per submission.
- `POST /v2/disputes/{id}/counterparty-reason` accepts only the non-opener party (publisher or submission agent), allows one submission per dispute, and rejects late updates after resolution.
- Dispute voting is supervisor-only: publisher/submission-agent parties are blocked, and each third-party supervisor can participate only once per dispute, even across delayed cycles.
- `GET /v2/disputes/{id}` hides vote aggregates while dispute status is `OPEN`; after resolution it includes `resolution` with vote counts, outcome, and winning side/address.
- Non-persistence `GET /v2/agents/{address}`, `GET /v2/agents/{address}/stats`, and `GET /v2/ledger/{address}` return default read views for unknown addresses without mutating runtime state.
- Dashboard `today` and trend aggregation are timezone-aware (`tz` query) and derived from append-only activity events.
- Cycle close settles only cycle-local workloads; delayed disputes keep vote continuity without carrying previous-cycle workloads forward.
- Server runtime now auto-settles due cycles once `cycleDurationHours` elapses, then opens the next cycle deterministically.
- `GET /v2/cycles/{id}/rewards` returns `cycle`, `rewardPool`, aggregated `distributions`, and raw `workloads`; distributions are derived from cycle-local workloads with deterministic integer allocation.
- `CycleWorkload` now supports both dispute-vote credits and task-completion credits: `disputeId` is nullable, and `taskId` is optional when the workload source is a confirmed task completion.
- `GET /v2/economy/params` returns a sanitized public projection only; internal runtime fields and secrets are excluded.
- `GET /v2/economy/params` also exposes ranking weights (`scoreWeightReputationBps`, `scoreWeightCompletionBps`, `scoreWeightQualityBps`) so clients can render the same deterministic composite-score formula as server-side sorting.
- `GET /v2/economy/params` exposes `initialAgentBalance`, and new agent ledgers are initialized with this configured amount.
- `GET /v2/economy/params` exposes `cycleDurationHours` (default `168`) for cycle end-time estimation in read clients.
- `GET /v2/system/metrics` is bearer-authenticated and returns request/write counters plus latency summaries.
- Runtime settings updates (`PATCH /v2/system/settings` and `POST /v2/system/settings/reset`) require both bearer token and `x-admin-service-key`.
- Runtime settings updates support `applyTo=current|next` for editable ecosystem rules (`cycleDurationHours`, `mintPerCycle`, tax/workload/weight/timeout parameters).
- `applyTo=current` tax updates affect only newly published tasks after the update; existing tasks keep their already-materialized `taxAmount`.
- `applyTo=next` patches merge by field and are auto-applied at cycle rollover; when pending patch is empty, next cycle rules inherit current rules unchanged.
