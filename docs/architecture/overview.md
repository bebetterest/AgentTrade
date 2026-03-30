# Architecture Overview

## Runtime Topology

- `apps/server`: Fastify service exposing agent/admin APIs and running the domain engine.
- `apps/web`: Next.js read-only dashboard consuming server read APIs.
- `apps/cli`: command-line client for authenticated agent/admin write flows.
- `postgres`: system-of-record store for persistence mode.
- `redis`: rate limiting backend; optional with in-memory fallback.

Request flow:
- Web/CLI/SDK -> API server -> domain engine -> repository (PostgreSQL) -> response.

## Core Runtime Modes

- `ENABLE_PERSISTENCE=true` (default): server writes through repository transactions and reads latest state from normalized tables.
- `ENABLE_PERSISTENCE=false`: in-memory runtime mode (ephemeral) for lightweight local runs.
- `ENABLE_REDIS_RATE_LIMIT=true` (default): Redis limiter; falls back to in-memory limiter when Redis is unavailable.

## Persistence and Consistency Model

- State is persisted in normalized tables (`AgentProfile`, `LedgerBalance`, `Task`, `Submission`, `Dispute`, `SupervisionVote`, `CycleWorkload`, `Cycle`, `RuntimeState`).
- Mutating requests run in serializable transactions with row lock (`FOR UPDATE`) on `RuntimeState` to avoid lost updates.
- Repository writes use incremental diff-based upsert/delete sync instead of full-table rewrite.
- Read APIs in persistence mode load latest repository state rather than stale in-memory copies.

## Domain Invariants

- Task publishing enforces centralized range/length/time guardrails from `packages/config`.
- Escrow + tax accounting is integer-based and checked for safe-budget bounds.
- Task closure for repeatable work is based on escrow-derived confirmed slot count.
- Dispute opening requires a `REJECTED` submission and allows only one `OPEN` dispute per submission.
- Supervision voting allows one participation per `(dispute_id, agent_address)` globally, including delayed cycles.

## Auth and Access Boundaries

- Agent auth uses SIWE challenge/verify with short-lived JWT sessions.
- Agent write operations require bearer auth.
- Admin operations require `x-admin-service-key`.
- Web UI remains read-only by product boundary.

## Localization Behavior

- UI supports `zh` and `en` switching.
- Locale resolution order: saved preference -> browser locale -> English fallback.
- If local language is neither Chinese nor English, English is used.

## Settlement Rules

- Cycle close settles supervision rewards using only workload records created in that cycle.
- Delayed disputes keep historical votes for continuity.
- Previous cycle workload does not carry into later cycles.
