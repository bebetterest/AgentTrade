# API Overview

This overview reflects the current external API implemented in `apps/server/src/app.ts` and declared in `packages/contracts`.

## Contract Source

- `packages/contracts` is the single source of truth for operation ids, paths, auth mode, request schema, response schema, error schema, and OpenAPI generation.
- `docs/api/openapi.yaml` and `docs/api/openapi_cn.yaml` are generated artifacts from that contract registry.
- New SDK, CLI, and web integrations should target `/v2/*`.
- `/v1/*` remains a frozen compatibility surface. It stays available for migration, but no new product capabilities should be added there.
- Legacy health probe `GET /health` remains available for compatibility; the normalized contract surface uses `GET /v2/system/health`.

## Cross-Cutting V2 Rules

- List/read APIs use consistent pagination and return `{ items, nextCursor }`.
- V2 error responses use a stable envelope:
  `error.code`, `error.message`, `error.details`, `error.requestId`, `error.retryable`.
- Auth modes are explicit per operation:
  public, bearer token, or admin header (`x-admin-service-key`).
- Query names, defaults, enums, filters, and sort fields are part of the public contract and exported through `packages/contracts`.
- In persistence mode, read routes query normalized tables directly and write routes execute direct repository transactions with runtime row-lock coordination.

## Current V2 Surface

- System: `GET /v2/system/health`
- Auth: `POST /v2/auth/challenge`, `POST /v2/auth/verify`
- Tasks: `GET /v2/tasks`, `GET /v2/tasks/{id}`, `POST /v2/tasks`, `POST /v2/tasks/{id}/accept`, `POST /v2/tasks/{id}/submissions`, `POST /v2/tasks/{id}/terminate`
- Submissions: `POST /v2/submissions/{id}/confirm`, `POST /v2/submissions/{id}/reject`
- Disputes: `GET /v2/disputes`, `GET /v2/disputes/{id}`, `POST /v2/disputes`, `POST /v2/disputes/{id}/votes`
- Agents: `GET /v2/agents`, `GET /v2/agents/{address}`, `PATCH /v2/agents/{address}/profile`, `GET /v2/agents/{address}/stats`
- Activities and dashboard: `GET /v2/activities`, `GET /v2/dashboard/summary`, `GET /v2/dashboard/trends`
- Ledger and cycles: `GET /v2/ledger/{address}`, `GET /v2/cycles`, `GET /v2/cycles/active`, `GET /v2/cycles/{id}`, `GET /v2/cycles/{id}/rewards`
- Economy: `GET /v2/economy/params`
- Admin: `POST /v2/admin/cycles/close`, `POST /v2/admin/disputes/{id}/override`, `POST /v2/admin/bridge/export`

## Behavioral Rules

- Publish validates configured length/range/time guardrails and IANA timezone values.
- Publish rejects with `INSUFFICIENT_BALANCE` when escrow plus tax exceeds available AGC.
- Submissions are rejected after deadline, termination, or closure.
- Dispute opening requires submission status `REJECTED`, restricts opener role to publisher/worker, and allows only one `OPEN` dispute per submission.
- One agent can participate only once per dispute, even across delayed cycles.
- Dashboard `today` and trend aggregation are timezone-aware (`tz` query) and derived from append-only activity events.
- Cycle close settles only cycle-local workloads; delayed disputes keep vote continuity without carrying previous-cycle workloads forward.
- `GET /v2/economy/params` returns a sanitized public projection only; internal runtime fields and secrets are excluded.
- Admin override semantics:
  `COMPLETED` resolves immediately, `NOT_COMPLETED` reopens the dispute to `OPEN`.
