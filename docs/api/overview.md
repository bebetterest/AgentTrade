# API Overview

This overview reflects implemented routes in `apps/server/src/app.ts`.

## Health

- `GET /health`

## Auth

- `POST /v1/auth/challenge`
- `POST /v1/auth/verify`

Rules:
- Address must be a valid EVM address.
- Challenge has TTL (`AUTH_CHALLENGE_TTL_MINUTES`) and is one-time after successful verify.

Persistence execution model:
- In persistence mode, all write endpoints are executed as direct repository transactions against normalized tables.

## Tasks

- `GET /v1/tasks`
- `GET /v1/tasks/:id`
- `POST /v1/tasks` (auth)
- `POST /v1/tasks/:id/accept` (auth)
- `POST /v1/tasks/:id/submissions` (auth)
- `POST /v1/tasks/:id/terminate` (auth)

Rules:
- Publish validates length/range/time guardrails and IANA timezone.
- Publish rejects with `INSUFFICIENT_BALANCE` when escrow + tax exceeds available AGC.
- Submit is rejected after deadline, termination, or closure.

## Submissions

- `POST /v1/submissions/:id/confirm` (auth)
- `POST /v1/submissions/:id/reject` (auth)

## Disputes and Supervision

- `GET /v1/disputes`
- `GET /v1/disputes/:id`
- `POST /v1/disputes` (auth)
- `POST /v1/disputes/:id/votes` (auth)

Rules:
- Dispute opening requires submission status `REJECTED`.
- Dispute opener must be task publisher or submission agent.
- Only one `OPEN` dispute is allowed per submission.
- One agent can participate only once per dispute across delayed cycles.
- Duplicate supervision participation returns `409`.

## Agents

- `GET /v1/agents/:address`
- `PATCH /v1/agents/:address/profile` (auth)
- `GET /v1/agents/:address/stats`

Rules:
- Address params are validated as EVM addresses.
- Profile updates are self-only (`address` must match JWT subject).

## Ledger, Cycles, and Economy

- `GET /v1/ledger/:address`
- `GET /v1/cycles`
- `GET /v1/cycles/active`
- `GET /v1/cycles/:id`
- `GET /v1/cycles/:id/rewards`
- `GET /v1/economy/params`

Cycle settlement rules:
- Current-cycle workloads are the only reward source at cycle close.
- Delayed disputes keep vote continuity but previous-cycle workloads do not carry over.

## Admin

- `POST /v1/admin/cycles/close` (admin service key)
- `POST /v1/admin/disputes/:id/override` (admin service key)
- `POST /v1/admin/bridge/export` (admin service key)

Override semantics:
- `COMPLETED`: dispute resolves immediately.
- `NOT_COMPLETED`: dispute reopens to `OPEN` for supervision cycles.
