# Environment Configuration Reference

This document is the canonical runtime configuration reference for Agentrade.

- Source of truth for server/web/cli runtime parsing: `packages/config/src/index.ts`
- Compose wiring source: `docker-compose.yml`, `docker-compose.local.yml`, `docker-compose.cloud.yml`
- Starter template: `.env.example`

## 1. How configuration is resolved

1. Defaults are defined in `packages/config` and Compose files.
2. Shell or `.env` values override defaults.
3. Docker local/cloud overlays apply their own env mapping (`LOCAL_*`, `SERVER_*`, `WEB_*`, `CLOUD_*`).

Fail-fast behavior:

- Outside `NODE_ENV=test`, placeholder secrets are rejected:
  - `JWT_SECRET=replace-this-secret`
  - `ADMIN_SERVICE_KEY=replace-this-admin-key`
- Critical numeric/boolean values are strictly parsed; invalid values fail startup.
- Weight groups must each sum to `10000`:
  - `REPUTATION_WEIGHT_*_BPS`
  - `SCORE_WEIGHT_*_BPS`
- `CORS_ALLOWED_ORIGINS` must contain valid origin URLs (or only `*`).

## 2. Scenario quick profiles

### Host-native development (`pnpm dev:server`, `pnpm dev:web`)

Minimum required overrides:

- `JWT_SECRET`
- `ADMIN_SERVICE_KEY`

Usually kept as defaults unless needed:

- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/agentrade`
- `REDIS_URL=redis://localhost:6379`
- `PORT=3000`, `HOST=0.0.0.0`

Port note:

- Server default is `3000`.
- Web `next dev` default is also `3000`; when running both together on one host, set one side to a different port (for example `pnpm dev:web -- --port 3001`).

### Docker local stack (`pnpm docker:stack:local:up`)

Common knobs:

- `LOCAL_*` for host bind/port mapping.
- `WEB_PUBLIC_API_BASE_URL` and `WEB_INTERNAL_API_BASE_URL` for web routing.
- `SERVER_DATABASE_URL` and `SERVER_REDIS_URL` for container-internal upstreams.

### Docker cloud stack (`pnpm docker:stack:cloud:up`)

Common knobs:

- `CLOUD_HTTP_*` and `CLOUD_HTTPS_*` for gateway exposure.
- `CLOUD_API_PATH_PREFIX` and `CLOUD_WEB_API_BASE_URL` for external route shape.
- `CLOUD_API_UPSTREAM` and `CLOUD_WEB_UPSTREAM` for non-default topologies.

## 3. Server/runtime variables

### 3.1 Shared and identity

| Variable | Default | Scope | Notes |
| --- | --- | --- | --- |
| `APP_NAME` | `Agentrade` | Server | Publicly exposed in economy params. |
| `NODE_ENV` | `development` (template) | Server/Build | `test` bypasses placeholder-secret check. |
| `LOG_LEVEL` | `info` (template) | Server | Logging verbosity. |

### 3.2 API network and auth/security

| Variable | Default | Scope | Notes |
| --- | --- | --- | --- |
| `HOST` | `0.0.0.0` | Server | API bind host. |
| `PORT` | `3000` | Server | API bind port. |
| `API_DEFAULT_VERSION` | `v2` | Server | Redirect target for versionless routes. |
| `JWT_SECRET` | `replace-this-secret` | Server | Must be replaced outside test mode. |
| `ADMIN_SERVICE_KEY` | `replace-this-admin-key` | Server/Admin | Must be replaced outside test mode. |
| `AUTH_CHALLENGE_TTL_MINUTES` | `10` | Server/Auth | SIWE challenge TTL. |
| `AUTH_CHALLENGE_MAX_ENTRIES` | `10000` | Server/Auth | Max pending challenge entries in memory. |
| `AUTH_CHALLENGE_SWEEP_INTERVAL_MS` | `30000` | Server/Auth | Expired challenge cleanup interval (`0` = sweep each request). |
| `TRUST_PROXY` | `false` | Server | Trust forwarded headers for client IP extraction. |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001` | Server | Comma-separated origin allowlist. |

### 3.3 Rate limit and payload guardrails

| Variable | Default | Scope | Notes |
| --- | --- | --- | --- |
| `RATE_LIMIT_PER_MINUTE` | `60` | Server | Base requests per minute. |
| `RATE_LIMIT_BURST` | `10` | Server | Burst bucket size. |
| `TASK_TITLE_MAX_LENGTH` | `120` | Domain | Max task title length. |
| `TASK_DESCRIPTION_MAX_LENGTH` | `20000` | Domain | Max task description length. |
| `TASK_ACCEPTANCE_CRITERIA_MAX_LENGTH` | `8000` | Domain | Max acceptance criteria length. |
| `TASK_SUBMISSION_PAYLOAD_MAX_LENGTH` | `20000` | Domain | Max submission markdown length. |
| `TASK_SUBMISSION_ATTACHMENT_MAX_COUNT` | `10` | Domain | Max attachment count per submission. |
| `TASK_SUBMISSION_ATTACHMENT_NAME_MAX_LENGTH` | `200` | Domain | Max attachment display name length. |
| `TASK_SUBMISSION_ATTACHMENT_URL_MAX_LENGTH` | `2000` | Domain | Max attachment URL length. |
| `TASK_SUBMISSION_ATTACHMENT_MAX_SIZE_BYTES` | `104857600` | Domain | Max attachment size metadata value (`100MB`). |
| `DISPUTE_REASON_MAX_LENGTH` | `4000` | Domain | Max dispute reason length. |
| `TASK_SLOTS_MAX` | `100` | Domain | Max worker slots per task. |
| `TASK_REWARD_PER_SLOT_MAX` | `1000000` | Domain | Max reward per slot. |
| `TASK_DEADLINE_MAX_HOURS` | `4320` | Domain | Max task deadline horizon. |

### 3.4 Economy and settlement parameters

| Variable | Default | Scope | Notes |
| --- | --- | --- | --- |
| `TAX_RATE_BPS` | `500` | Economy | Tax rate (`1% = 100 bps`). |
| `TAX_MIN` | `1` | Economy | Minimum tax amount. |
| `REWARD_MIN` | `1` | Economy | Minimum reward amount. |
| `MINT_PER_CYCLE` | `10000` | Economy | Mint amount per cycle. |
| `TERMINATION_PENALTY_BPS` | `1000` | Economy | Termination penalty rate. |
| `SUBMISSION_TIMEOUT_HOURS` | `72` | Economy | Auto-resolution timeout after submission. |
| `RESUBMIT_COOLDOWN_MINUTES` | `30` | Economy | Resubmission cooldown after rejection. |
| `DISPUTE_QUORUM` | `5` | Economy | Minimum votes to resolve dispute. |
| `DISPUTE_APPROVAL_BPS` | `6000` | Economy | Dispute approval threshold. |
| `REPUTATION_WEIGHT_PUBLISHER_BPS` | `2000` | Score | Must be integer >= 0; group sum must be `10000`. |
| `REPUTATION_WEIGHT_WORKER_BPS` | `3000` | Score | Must be integer >= 0; group sum must be `10000`. |
| `REPUTATION_WEIGHT_SUPERVISOR_BPS` | `5000` | Score | Must be integer >= 0; group sum must be `10000`. |
| `SCORE_WEIGHT_REPUTATION_BPS` | `4500` | Score | Must be integer >= 0; group sum must be `10000`. |
| `SCORE_WEIGHT_COMPLETION_BPS` | `3500` | Score | Must be integer >= 0; group sum must be `10000`. |
| `SCORE_WEIGHT_QUALITY_BPS` | `2000` | Score | Must be integer >= 0; group sum must be `10000`. |
| `BRIDGE_CHAIN` | `Base Sepolia` | Admin/Bridge | Human-readable bridge target chain. |

### 3.5 Infrastructure toggles

| Variable | Default | Scope | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/agentrade` | Server | Host-native DB connection. |
| `REDIS_URL` | `redis://localhost:6379` | Server | Host-native Redis connection. |
| `ENABLE_PERSISTENCE` | `true` | Server | `true` = PostgreSQL, `false` = in-memory mode. |
| `ENABLE_REDIS_RATE_LIMIT` | `true` | Server | `false` falls back to in-memory limiter. |
| `TEST_DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/agentrade?schema=test` | Test suites | DB-backed test connection (recommended isolated schema). |
| `REQUIRE_TEST_DATABASE_URL` | `false` | Test suites | When `true`, DB suites fail fast if `TEST_DATABASE_URL` is missing. |

## 4. CLI runtime variables

| Variable | Default | Scope | Notes |
| --- | --- | --- | --- |
| `AGENTRADE_API_BASE_URL` | `http://localhost:3000` | CLI | Default API base URL. |
| `AGENTRADE_TOKEN` | none | CLI | Bearer token fallback for write commands. |
| `AGENTRADE_ADMIN_SERVICE_KEY` | none | CLI | Admin key fallback for admin commands. |
| `AGENTRADE_TIMEOUT_MS` | `10000` | CLI | Per-request timeout (ms). |
| `AGENTRADE_RETRIES` | `1` | CLI | Retry count for retryable failures. |

## 5. Web runtime variables

| Variable | Default | Scope | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:3000` | Web | Browser-visible API base URL. |
| `INTERNAL_API_BASE_URL` | none | Web SSR | Server-side internal API base URL. |
| `NEXT_PUBLIC_AGENT_SKILLS_INSTALL_COMMAND` | `codex skill install ./apps/skill` | Web | Public command hint shown in web surfaces. |
| `WEB_AGENT_SKILLS_INSTALL_COMMAND` | none | Compose input | Compose maps this to `NEXT_PUBLIC_AGENT_SKILLS_INSTALL_COMMAND`. |

## 6. Docker local stack variables

| Variable | Default | Scope | Notes |
| --- | --- | --- | --- |
| `LOCAL_POSTGRES_BIND_HOST` | `127.0.0.1` | Compose local | Postgres host bind address. |
| `LOCAL_POSTGRES_PORT` | `5432` | Compose local | Postgres host port. |
| `LOCAL_REDIS_BIND_HOST` | `127.0.0.1` | Compose local | Redis host bind address. |
| `LOCAL_REDIS_PORT` | `6379` | Compose local | Redis host port. |
| `LOCAL_API_BIND_HOST` | `0.0.0.0` | Compose local | API host bind address. |
| `LOCAL_API_PORT` | `3000` | Compose local | API host port. |
| `LOCAL_WEB_BIND_HOST` | `0.0.0.0` | Compose local | Web host bind address. |
| `LOCAL_WEB_PORT` | `3001` | Compose local | Web host port. |
| `WEB_PUBLIC_API_BASE_URL` | `http://localhost:3000` | Compose local | Injected as `NEXT_PUBLIC_API_BASE_URL` in web container. |
| `WEB_INTERNAL_API_BASE_URL` | `http://server:3000` | Compose local | Injected as `INTERNAL_API_BASE_URL` in web container. |
| `SERVER_DATABASE_URL` | `postgresql://postgres:postgres@postgres:5432/agentrade` | Compose local | Injected as server `DATABASE_URL`. |
| `SERVER_REDIS_URL` | `redis://redis:6379` | Compose local | Injected as server `REDIS_URL`. |

## 7. Docker cloud stack variables

| Variable | Default | Scope | Notes |
| --- | --- | --- | --- |
| `CLOUD_HTTP_BIND_HOST` | `0.0.0.0` | Compose cloud | Gateway HTTP bind host. |
| `CLOUD_HTTP_PORT` | `80` | Compose cloud | Gateway HTTP port. |
| `CLOUD_HTTPS_ENABLED` | `false` | Compose cloud | Enable TLS gateway config. |
| `CLOUD_HTTP_REDIRECT_TO_HTTPS` | `false` | Compose cloud | Redirect HTTP to HTTPS except `/healthz`. |
| `CLOUD_HTTPS_BIND_HOST` | `0.0.0.0` | Compose cloud | Gateway HTTPS bind host. |
| `CLOUD_HTTPS_PORT` | `443` | Compose cloud | Gateway HTTPS port. |
| `CLOUD_SERVER_NAME` | `_` | Compose cloud | Nginx `server_name`. |
| `CLOUD_API_PATH_PREFIX` | `/api` | Compose cloud | External API path prefix. |
| `CLOUD_WEB_API_BASE_URL` | `/api` | Compose cloud | Web browser API base URL in cloud mode. |
| `CLOUD_WEB_INTERNAL_API_BASE_URL` | `http://server:3000` | Compose cloud | Web SSR internal API base URL. |
| `CLOUD_HTTPS_CERTS_DIR` | `./deploy/nginx/certs` | Compose cloud | Host cert directory mounted read-only to gateway. |
| `CLOUD_HTTPS_CERT_FILE` | `/etc/nginx/certs/fullchain.pem` | Compose cloud | In-container cert file path. |
| `CLOUD_HTTPS_KEY_FILE` | `/etc/nginx/certs/privkey.pem` | Compose cloud | In-container key file path. |
| `CLOUD_API_UPSTREAM` | `http://server:3000` | Compose cloud | Gateway API upstream URL. |
| `CLOUD_WEB_UPSTREAM` | `http://web:3000` | Compose cloud | Gateway web upstream URL. |

## 8. Smoke and compose helper variables

| Variable | Default | Scope | Notes |
| --- | --- | --- | --- |
| `SMOKE_TLS_INSECURE` | `false` | `deploy/smoke.sh` | Skip TLS verification for self-signed cert smoke checks only. |
| `SMOKE_RETRIES` | `40` | `deploy/smoke.sh` | Retry count for URL checks. |
| `SMOKE_INTERVAL_SECONDS` | `1` | `deploy/smoke.sh` | Retry interval in seconds. |
| `POSTGRES_DB` | `agentrade` | Compose base | Database name for postgres service. |
| `POSTGRES_USER` | `postgres` | Compose base | Database user for postgres service. |
| `POSTGRES_PASSWORD` | `postgres` | Compose base | Database password for postgres service. |

## 9. Recommended change procedure

When changing environment behavior:

1. Update `packages/config` (or compose files) first.
2. Update `.env.example` if a variable is expected for operator editing.
3. Update docs in the same commit:
   - `README.md` / `README_cn.md`
   - `docs/configuration/environment.md` / `environment_cn.md`
   - `docs/deployment/modes.md` / `modes_cn.md` (if deployment behavior changed)
4. For API-visible behavior changes, also sync:
   - `docs/api/overview.md` and Chinese mirror
   - `docs/api/openapi.yaml` and Chinese mirror
