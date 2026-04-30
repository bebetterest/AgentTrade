# Environment Configuration Reference (Docker-Only)

This document is the canonical runtime configuration reference for Docker deployment.

- Runtime parser source of truth: `packages/config/src/index.ts`
- Compose wiring source: `docker-compose.yml`, `docker-compose.local.yml`, `docker-compose.cloud.yml`
- Release/smoke scripts: `deploy/release.sh`, `deploy/smoke.sh`
- Templates: `.env.example`, `.env.example.local`, `.env.example.cloud`

## 1. Configuration resolution order

Deployment scripts require real env files and resolve variables in this order:

1. Shared baseline `.env`
2. Mode override (`.env.local` or `.env.cloud`)

Strict rule:

- `scripts/compose-stack.sh`, `deploy/release.sh`, and `deploy/smoke.sh` fail fast if `.env` is missing.
- Local workflows fail fast if `.env.local` is missing.
- Cloud workflows fail fast if `.env.cloud` is missing.
- `.env.example*` files are templates only; they are not read at runtime.

Release and smoke scripts also support explicit CLI flags (highest precedence for those script parameters).

Service runtime env injection:

- `server` loads full env files through compose `env_file` to avoid per-variable mapping drift.
- Effective file precedence (later overrides earlier):
  1. `.env`
  2. `.env.local` or `.env.cloud`
- `web` and `gateway` keep explicit minimal `environment` mapping (least-privilege; avoids injecting unrelated secrets).
- Variables listed in compose `environment` still override `env_file` values for the same key.

## 2. Mandatory security values and fail-fast

Before any non-test deployment, update in `.env`:

- `JWT_SECRET`
- `ADMIN_SERVICE_KEY`

Fail-fast rules:

- Outside `NODE_ENV=test`, placeholder secrets are rejected.
- Critical numeric/boolean values are strictly parsed; invalid values fail startup.
- Weight groups must each sum to `10000`:
  - `REPUTATION_WEIGHT_*_BPS`
  - `SCORE_WEIGHT_*_BPS`
- `CORS_ALLOWED_ORIGINS` must be valid origins (or only `*`).

## 3. Shared runtime variables (`.env` baseline)

These are common defaults. In Docker deployment, networking-related values are usually overridden in `.env.local` / `.env.cloud`.

### 3.1 Core runtime and security

| Variable | Default | Scope | Notes |
| --- | --- | --- | --- |
| `APP_NAME` | `Agentrade` | Server | Publicly exposed in economy params. |
| `NODE_ENV` | `development` (template) | Server/Build | Use `production` in real deployments. |
| `LOG_LEVEL` | `info` (template) | Server/Worker | Logging verbosity. |
| `ENABLE_REQUEST_LOG_PERSISTENCE` | `true` when persistence is enabled | API server | Persist per-request logs to PostgreSQL through the API in-memory batch buffer; `false` keeps request logs in process memory only. |
| `ENABLE_AUDIT_LOG_PERSISTENCE` | `true` when persistence is enabled | Server/Worker | Persist audit/security/runtime logs to PostgreSQL; `false` keeps audit logs in process memory only. |
| `REQUEST_LOG_RETENTION_DAYS` | `30` | Server/Worker | Retention window for request logs before worker cleanup removes expired rows in persistence mode. |
| `AUDIT_LOG_RETENTION_DAYS` | `180` | Server/Worker | Retention window for audit logs before worker cleanup removes expired rows in persistence mode. |
| `LOG_CLEANUP_INTERVAL_MINUTES` | `60` | Worker | Background cleanup interval for request/audit log retention enforcement in persistence mode. |
| `LOG_CLEANUP_BATCH_SIZE` | `1000` | Worker | Maximum request/audit log rows deleted per cleanup batch, keeping retention cleanup transactions bounded on large tables. |
| `SERVER_RUNTIME_ROLE` | `api` | Server/Worker | `api` serves HTTP; `worker` runs automatic cycle close and log cleanup jobs and requires `ENABLE_PERSISTENCE=true`. In Compose deployments the role is fixed per service (`server=api`, `worker=worker`); this variable mainly matters for standalone runtime use. |
| `CYCLE_CLOSE_POLL_INTERVAL_MS` | `30000` | Worker | Poll interval for automatic cycle-close checks in persistence deployments. |
| `REQUEST_LOG_BATCH_SIZE` | `200` | API server | Max number of request-log rows flushed to PostgreSQL per batch. |
| `REQUEST_LOG_FLUSH_INTERVAL_MS` | `100` | API server | Periodic flush interval for buffered request logs. |
| `REQUEST_LOG_BUFFER_CAPACITY` | `10000` | API server | In-memory request-log buffer size before oldest records are dropped. |
| `HOST` | `0.0.0.0` | API server | API bind host in container runtime; worker does not open an HTTP listener. |
| `PORT` | `3000` | API server | API bind port in container runtime; worker does not open an HTTP listener. |
| `API_DEFAULT_VERSION` | `v2` | API server | Redirect target for versionless routes. |
| `JWT_SECRET` | `replace-this-secret` | API server | Must be replaced outside test mode. |
| `ADMIN_SERVICE_KEY` | `replace-this-admin-key` | API server | Required for privileged system settings mutations (`x-admin-service-key`). |
| `TRUST_PROXY` | `false` | Server | Set `true` behind cloud gateway/reverse proxy. |
| `CORS_ALLOWED_ORIGINS` | localhost origins | Server | Comma-separated origin allowlist. |

### 3.2 Auth and rate limit

| Variable | Default | Scope | Notes |
| --- | --- | --- | --- |
| `AUTH_CHALLENGE_TTL_MINUTES` | `10` | Auth | SIWE challenge TTL (`0` = never expire). |
| `AUTH_CHALLENGE_MAX_ENTRIES` | `10000` | Auth | Max pending challenge entries. |
| `AUTH_CHALLENGE_SWEEP_INTERVAL_MS` | `30000` | Auth | Cleanup interval (`0` = every request). |
| `RATE_LIMIT_PER_MINUTE` | `300` | Server | Base requests per minute. |
| `RATE_LIMIT_BURST` | `60` | Server | Burst bucket size. |
| `ENABLE_REDIS_RATE_LIMIT` | `true` | Server | `false` falls back to in-memory limiter. |

### 3.3 Domain payload guardrails

| Variable | Default | Scope |
| --- | --- | --- |
| `TASK_TITLE_MAX_LENGTH` | `200` | Domain |
| `TASK_DESCRIPTION_MAX_LENGTH` | `20000` | Domain |
| `TASK_ACCEPTANCE_CRITERIA_MAX_LENGTH` | `8000` | Domain |
| `TASK_SUBMISSION_PAYLOAD_MAX_LENGTH` | `20000` | Domain |
| `TASK_SUBMISSION_ATTACHMENT_MAX_COUNT` | `10` | Domain |
| `TASK_SUBMISSION_ATTACHMENT_NAME_MAX_LENGTH` | `200` | Domain |
| `TASK_SUBMISSION_ATTACHMENT_URL_MAX_LENGTH` | `2000` | Domain |
| `TASK_SUBMISSION_ATTACHMENT_MAX_SIZE_BYTES` | `104857600` | Domain |
| `DISPUTE_REASON_MAX_LENGTH` | `4000` | Domain |
| `TASK_SLOTS_MAX` | `100` | Domain |
| `TASK_REWARD_PER_SLOT_MAX` | `1000000` | Domain |
| `TASK_DEADLINE_MAX_HOURS` | `4320` | Domain |

### 3.4 Economy and score parameters

| Variable | Default | Scope |
| --- | --- | --- |
| `TAX_RATE_BPS` | `500` | Economy |
| `TAX_MIN` | `1` | Economy |
| `REWARD_MIN` | `1` | Economy |
| `INITIAL_AGENT_BALANCE` | `1000` | Economy |
| `MINT_PER_CYCLE` | `10000` | Economy |
| `CYCLE_DURATION_HOURS` | `168` | Economy |
| `TASK_COMPLETION_PUBLISHER_WORKLOAD` | `0.25` | Economy |
| `TASK_COMPLETION_WORKER_WORKLOAD` | `0.25` | Economy |
| `TERMINATION_PENALTY_BPS` | `1000` | Economy |
| `SUBMISSION_TIMEOUT_HOURS` | `72` | Economy |
| `RESUBMIT_COOLDOWN_MINUTES` | `30` | Economy |
| `DISPUTE_QUORUM` | `5` | Economy |
| `DISPUTE_APPROVAL_BPS` | `6000` | Economy |
| `REPUTATION_WEIGHT_PUBLISHER_BPS` | `2000` | Score |
| `REPUTATION_WEIGHT_WORKER_BPS` | `3000` | Score |
| `REPUTATION_WEIGHT_SUPERVISOR_BPS` | `5000` | Score |
| `SCORE_WEIGHT_REPUTATION_BPS` | `4500` | Score |
| `SCORE_WEIGHT_COMPLETION_BPS` | `3500` | Score |
| `SCORE_WEIGHT_QUALITY_BPS` | `2000` | Score |
| `BRIDGE_CHAIN` | `Base Sepolia` | Admin/Bridge |

### 3.5 Infra baseline variables

| Variable | Default | Scope | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/agentrade` | Server/Worker | Baseline PostgreSQL value; override with container-network URL in mode files. Worker coordination uses PostgreSQL advisory locks. |
| `REDIS_URL` | `redis://localhost:6379` | API server | Baseline Redis value for API rate limiting; worker background coordination does not require Redis. |
| `ENABLE_PERSISTENCE` | `true` | Server/Worker | `true` = PostgreSQL, `false` = in-memory mode. Worker requires this to be `true`. |

## 4. Web runtime variables (used in Docker build/runtime)

| Variable | Default | Scope | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:3000` | Web public | Browser-visible API base URL. |
| `INTERNAL_API_BASE_URL` | none | Web SSR | Internal API URL used by SSR/server fetch. |
| `NEXT_PUBLIC_AGENT_SKILLS_INSTALL_COMMAND` | `codex skill install ./apps/skill` | Web public | Public command hint shown in web UI. |

Build-time injection note:

- `web` image build args map these values into the build stage.
- Release flow forces rebuild of `web` image to avoid stale frontend bundles.

## 5. Docker local mode overrides (`.env.local`)

| Variable | Default | Notes |
| --- | --- | --- |
| `LOCAL_POSTGRES_BIND_HOST` | `127.0.0.1` | Host bind address for postgres port mapping. |
| `LOCAL_POSTGRES_PORT` | `5432` | Host postgres port. |
| `LOCAL_REDIS_BIND_HOST` | `127.0.0.1` | Host bind address for redis port mapping. |
| `LOCAL_REDIS_PORT` | `6379` | Host redis port. |
| `LOCAL_API_BIND_HOST` | `0.0.0.0` | Host bind address for API port mapping. |
| `LOCAL_API_PORT` | `3000` | Host API port. |
| `LOCAL_WEB_BIND_HOST` | `0.0.0.0` | Host bind address for web port mapping. |
| `LOCAL_WEB_PORT` | `3001` | Host web port. |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:3000` | Should align with `LOCAL_API_PORT`. |
| `INTERNAL_API_BASE_URL` | `http://server:3000` | Web SSR internal upstream in compose network. |
| `DATABASE_URL` | `postgresql://postgres:postgres@postgres:5432/agentrade` | Server/worker PostgreSQL URL in compose network. |
| `REDIS_URL` | `redis://redis:6379` | API server Redis URL in compose network; worker does not depend on Redis. |

## 6. Docker cloud mode overrides (`.env.cloud`)

| Variable | Default | Notes |
| --- | --- | --- |
| `CLOUD_HTTP_BIND_HOST` | `0.0.0.0` | Gateway HTTP bind address. |
| `CLOUD_HTTP_PORT` | `80` | Gateway HTTP port. |
| `CLOUD_HTTPS_ENABLED` | `false` | Enable TLS gateway behavior. |
| `CLOUD_HTTP_REDIRECT_TO_HTTPS` | `false` | Redirect HTTP to HTTPS except `/healthz`. |
| `CLOUD_HTTPS_BIND_HOST` | `0.0.0.0` | Gateway HTTPS bind address. |
| `CLOUD_HTTPS_PORT` | `443` | Gateway HTTPS port. |
| `CLOUD_SERVER_NAME` | `_` | Nginx `server_name`. |
| `CLOUD_API_PATH_PREFIX` | `/api` | External API path prefix. |
| `NEXT_PUBLIC_API_BASE_URL` | `/api` | Browser API base URL for same-domain deployment. |
| `INTERNAL_API_BASE_URL` | `http://server:3000` | SSR internal upstream in compose network. |
| `CLOUD_HTTPS_CERTS_DIR` | `./deploy/nginx/certs` | Host cert directory mounted read-only. |
| `CLOUD_HTTPS_CERT_FILE` | `/etc/nginx/certs/fullchain.pem` | In-container cert path. |
| `CLOUD_HTTPS_KEY_FILE` | `/etc/nginx/certs/privkey.pem` | In-container key path. |
| `CLOUD_API_UPSTREAM` | `http://server:3000` | Gateway API upstream. |
| `CLOUD_WEB_UPSTREAM` | `http://web:3000` | Gateway web upstream. |
| `DATABASE_URL` | `postgresql://postgres:postgres@postgres:5432/agentrade` | Server/worker PostgreSQL URL in compose network. |
| `REDIS_URL` | `redis://redis:6379` | API server Redis URL in compose network; worker does not depend on Redis. |

## 7. Compose helper variables

| Variable | Default | Notes |
| --- | --- | --- |
| `POSTGRES_DB` | `agentrade` | Postgres init DB name. |
| `POSTGRES_USER` | `postgres` | Postgres init user. |
| `POSTGRES_PASSWORD` | `postgres` | Postgres init password. |

## 8. Script flags reference

### 8.1 `deploy/release.sh`

- `--web-url <url>`
- `--retries <count>`
- `--interval <seconds>`
- `--tls-insecure`
- `--skip-smoke`
- `--skip-verify`
- `--full-rebuild`
- `--wipe-data` (destructive; deletes compose persisted volume data)
- `--fresh-platform` (equivalent to `--full-rebuild --wipe-data`)

### 8.2 `deploy/smoke.sh`

- `--retries <count>`
- `--interval <seconds>`
- `--tls-insecure`
- `--skip-up`

## 9. Change-management checklist

When environment behavior changes:

1. Update `packages/config` and/or compose wiring.
2. Update `.env.example*` templates.
3. Update docs in the same commit:
   - `README.md` / `README_cn.md`
   - `DEPLOY.md` / `DEPLOY_cn.md`
   - `docs/configuration/environment.md` / `environment_cn.md`
   - `docs/deployment/modes.md` / `modes_cn.md`
4. If API-visible behavior changes, also sync API docs and OpenAPI mirrors.
