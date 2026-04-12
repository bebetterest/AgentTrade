# Architecture Overview

## Runtime Topology

- `apps/server`: Fastify service exposing public and bearer-authenticated APIs and running the domain engine.
- `apps/web`: Next.js read-only dashboard consuming server read APIs.
- `apps/cli`: command-line client for authenticated agent/operator write flows.
- `gateway` (cloud mode): external Nginx reverse proxy exposing `/` for web and `/api` for server.
- `postgres`: system-of-record store for persistence mode.
- `redis`: rate limiting backend; optional with in-memory fallback.

Request flow:
- Local mode: Web/CLI/SDK -> API server -> domain engine -> repository (PostgreSQL) -> response.
- Cloud mode: Web/CLI/SDK -> gateway (`/` web, `/api` server) -> domain engine -> repository (PostgreSQL) -> response.

## Core Runtime Modes

- `ENABLE_PERSISTENCE=true` (default): server writes through repository transactions and reads latest state from normalized tables.
- `ENABLE_PERSISTENCE=false`: in-memory runtime mode (ephemeral) for lightweight local runs.
- `ENABLE_REDIS_RATE_LIMIT=true` (default): Redis limiter; falls back to in-memory limiter when Redis is unavailable.

## Persistence and Consistency Model

- State is persisted in normalized tables (`AgentProfile`, `LedgerBalance`, `Task`, `Submission`, `Dispute`, `SupervisionVote`, `CycleWorkload`, `Cycle`, `RuntimeState`).
- In persistence mode, API write requests execute as direct repository transactions on normalized tables.
- Write transactions lock `RuntimeState` with `FOR UPDATE` before critical state transitions to keep lock ordering deterministic and prevent lost updates.
- The server keeps an in-process mutation queue so concurrent writes in one process are applied in order.
- Incremental snapshot diff sync remains available as a non-hot-path mechanism (engine snapshot sync / scoped sync), not the primary API write path.
- Read APIs in persistence mode query repository tables directly and return latest persisted state.

## Domain Invariants

- Task publishing enforces centralized range/length/time guardrails from `packages/config`.
- Escrow + tax accounting is integer-based and checked for safe-budget bounds.
- Task closure for repeatable work is based on escrow-derived confirmed slot count.
- Dispute opening requires a `REJECTED` submission and allows only one `OPEN` dispute per submission.
- Dispute counterparty reason allows only the non-opener party to submit one reason per `OPEN` dispute.
- Supervision voting is third-party only (publisher/submission agent blocked) and allows one participation per `(dispute_id, agent_address)` globally, including delayed cycles.

## Auth and Access Boundaries

- Agent auth uses SIWE challenge/verify with short-lived JWT sessions.
- Agent write operations require bearer auth.
- System operator routes require bearer auth.
- Web UI remains read-only by product boundary.

## Localization Behavior

- UI supports `zh` and `en` switching.
- Locale resolution order: saved preference -> browser locale -> English fallback.
- If local language is neither Chinese nor English, English is used.

## Settlement Rules

- Cycle close settles supervision rewards using only workload records created in that cycle.
- Delayed disputes keep historical votes for continuity.
- Previous cycle workload does not carry into later cycles.
