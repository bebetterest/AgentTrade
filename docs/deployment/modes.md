# Deployment Modes Runbook

Agentrade supports two Docker deployment modes and one shared configuration baseline:

- Local mode: `docker-compose.yml` + `docker-compose.local.yml`
- Cloud mode: `docker-compose.yml` + `docker-compose.cloud.yml`
- Full configuration baseline: `.env.example`

This runbook is the end-to-end deployment guide, including prerequisites, required configuration changes, startup, verification, operations, and troubleshooting.

## 1. Source of truth and file roles

- Compose topology and wiring:
  - `docker-compose.yml`
  - `docker-compose.local.yml`
  - `docker-compose.cloud.yml`
- Gateway templates and HTTPS fail-fast logic:
  - `deploy/nginx/gateway-entrypoint.sh`
  - `deploy/nginx/cloud.http-only.conf.template`
  - `deploy/nginx/cloud.https.no-redirect.conf.template`
  - `deploy/nginx/cloud.https.redirect.conf.template`
- Runtime config parser and fail-fast checks:
  - `packages/config/src/index.ts`
- Environment templates:
  - `.env.example` (superset reference)
  - `.env.example.local` (local deployment profile)
  - `.env.example.cloud` (cloud deployment profile)
- Smoke script:
  - `deploy/smoke.sh`
- Compose mode wrapper:
  - `scripts/compose-stack.sh`

## 2. Preflight checklist

1. Host requirements

- Docker Engine + Docker Compose plugin available (`docker compose version` works).
- Enough disk for images and PostgreSQL volume.
- Ports are available:
  - Local mode: `LOCAL_API_PORT`, `LOCAL_WEB_PORT`, optionally `LOCAL_POSTGRES_PORT`, `LOCAL_REDIS_PORT`.
  - Cloud mode: `CLOUD_HTTP_PORT`, and `CLOUD_HTTPS_PORT` if HTTPS enabled.

2. Optional Node toolchain (only needed if you use `pnpm` helper scripts)

- Node `>=22 <26`
- pnpm `9.12.1`
- Verify:

```bash
corepack enable
pnpm --version
```

3. Docker health

```bash
docker info
```

4. Decide deployment target

- Local mode: local integration/dev/QA.
- Cloud mode: single-host deployment through Nginx gateway.

## 3. Environment strategy

Use layered env files:

- Local deployment:

```bash
cp .env.example .env
cp .env.example.local .env.local
```

- Cloud deployment:

```bash
cp .env.example .env
cp .env.example.cloud .env.cloud
```

Resolution order for docker scripts:

1. `.env` (shared baseline)
2. `.env.local` or `.env.cloud` (mode override)

## 4. Mandatory edits before any non-test deployment

These values must be changed from placeholders in `.env`:

- `JWT_SECRET`
- `ADMIN_SERVICE_KEY`

Generation example:

```bash
openssl rand -hex 32
```

Fail-fast note: outside `NODE_ENV=test`, placeholder values are rejected at startup.

## 5. Local mode deployment (complete flow)

### 5.1 Required/important local settings

At minimum validate these keys across `.env` + `.env.local`:

- Security:
  - `JWT_SECRET`
  - `ADMIN_SERVICE_KEY`
- API/Web exposure:
  - `LOCAL_API_BIND_HOST`, `LOCAL_API_PORT`
  - `LOCAL_WEB_BIND_HOST`, `LOCAL_WEB_PORT`
- Database and Redis exposure:
  - `LOCAL_POSTGRES_BIND_HOST`, `LOCAL_POSTGRES_PORT`
  - `LOCAL_REDIS_BIND_HOST`, `LOCAL_REDIS_PORT`
- Container runtime upstreams (local mode override values):
  - `DATABASE_URL`
  - `REDIS_URL`
- Web API routing:
  - `NEXT_PUBLIC_API_BASE_URL`
  - `INTERNAL_API_BASE_URL`

Recommended local defaults:

- `LOCAL_POSTGRES_BIND_HOST=127.0.0.1`
- `LOCAL_REDIS_BIND_HOST=127.0.0.1`
- `LOCAL_API_BIND_HOST=0.0.0.0`
- `LOCAL_WEB_BIND_HOST=0.0.0.0`
- `NEXT_PUBLIC_API_BASE_URL=http://localhost:${LOCAL_API_PORT}`
- `INTERNAL_API_BASE_URL=http://server:3000`

### 5.2 Start local stack

With helper script:

```bash
pnpm docker:stack:local:up
```

Raw compose equivalent:

```bash
docker compose --env-file .env --env-file .env.local -f docker-compose.yml -f docker-compose.local.yml up --build -d --remove-orphans
```

### 5.3 Validate local deployment

Smoke validation:

```bash
pnpm docker:smoke:local
```

Manual checks:

```bash
curl --noproxy '*' -f "http://127.0.0.1:${LOCAL_API_PORT:-3000}/v2/system/health"
curl --noproxy '*' -f "http://127.0.0.1:${LOCAL_API_PORT:-3000}/v2/dashboard/summary?tz=UTC"
curl --noproxy '*' -f "http://127.0.0.1:${LOCAL_WEB_PORT:-3001}/"
```

Container status and logs:

```bash
docker compose --env-file .env --env-file .env.local -f docker-compose.yml -f docker-compose.local.yml ps
docker compose --env-file .env --env-file .env.local -f docker-compose.yml -f docker-compose.local.yml logs -f server
docker compose --env-file .env --env-file .env.local -f docker-compose.yml -f docker-compose.local.yml logs -f web
```

### 5.4 Stop local stack

```bash
pnpm docker:stack:local:down
```

Raw compose equivalent:

```bash
docker compose --env-file .env --env-file .env.local -f docker-compose.yml -f docker-compose.local.yml down
```

## 6. Cloud mode deployment (complete flow)

### 6.1 Required cloud prerequisites

1. DNS

- Point your domain A record to server IP.
- Example: `agentrade.info -> 43.156.161.81`.

2. Network/security group/firewall

- Open inbound `80/tcp`.
- Open inbound `443/tcp` if HTTPS is enabled.

3. Certificate material (for HTTPS mode)

- Prepare certificate and private key files on host.
- Ensure `CLOUD_HTTPS_CERTS_DIR` points to that host directory.
- Ensure `CLOUD_HTTPS_CERT_FILE` and `CLOUD_HTTPS_KEY_FILE` are container paths under `/etc/nginx/certs/...`.

### 6.2 Required/important cloud settings

At minimum validate these keys across `.env` + `.env.cloud`:

- Security:
  - `JWT_SECRET`
  - `ADMIN_SERVICE_KEY`
- Proxy-aware API behavior:
  - `TRUST_PROXY=true`
- CORS:
  - `CORS_ALLOWED_ORIGINS` includes your HTTPS domain origin(s)
- Gateway base routing:
  - `CLOUD_SERVER_NAME`
  - `CLOUD_HTTP_BIND_HOST`, `CLOUD_HTTP_PORT`
  - `CLOUD_API_PATH_PREFIX`
  - `NEXT_PUBLIC_API_BASE_URL`
  - `INTERNAL_API_BASE_URL`
- Gateway upstreams:
  - `CLOUD_API_UPSTREAM`
  - `CLOUD_WEB_UPSTREAM`
- HTTPS (if used):
  - `CLOUD_HTTPS_ENABLED`
  - `CLOUD_HTTP_REDIRECT_TO_HTTPS`
  - `CLOUD_HTTPS_BIND_HOST`, `CLOUD_HTTPS_PORT`
  - `CLOUD_HTTPS_CERTS_DIR`
  - `CLOUD_HTTPS_CERT_FILE`
  - `CLOUD_HTTPS_KEY_FILE`

Cloud defaults are designed for same-host deployment:

- API externally at `${CLOUD_API_PATH_PREFIX}` (default `/api`)
- Web externally at `/`
- Web browser API base usually `/api`

### 6.3 TLS behavior and fail-fast

When `CLOUD_HTTPS_ENABLED=true`, gateway startup fails immediately if either file is missing/unreadable:

- `CLOUD_HTTPS_CERT_FILE`
- `CLOUD_HTTPS_KEY_FILE`

When `CLOUD_HTTP_REDIRECT_TO_HTTPS=true`:

- All normal HTTP traffic redirects to HTTPS.
- `/healthz` remains available on HTTP (status 200) for health probes.

### 6.4 Start cloud stack

With helper script:

```bash
pnpm docker:stack:cloud:up
```

Raw compose equivalent:

```bash
docker compose --env-file .env --env-file .env.cloud -f docker-compose.yml -f docker-compose.cloud.yml up --build -d --remove-orphans
```

Pre-rendered config inspection (recommended):

```bash
docker compose --env-file .env --env-file .env.cloud -f docker-compose.yml -f docker-compose.cloud.yml config
```

### 6.5 Validate cloud deployment

Smoke validation:

```bash
pnpm docker:smoke:cloud
```

For self-signed certificates only:

```bash
pnpm docker:smoke:cloud -- --tls-insecure
```

Custom retry tuning:

```bash
pnpm docker:smoke:cloud -- --retries 60 --interval 2
```

Manual checks (adjust host/domain):

```bash
curl --noproxy '*' -f "http://<domain-or-ip>/healthz"
curl --noproxy '*' -f "https://<domain-or-ip>/healthz"
curl --noproxy '*' -f "https://<domain-or-ip>${CLOUD_API_PATH_PREFIX:-/api}/v2/system/health"
```

Container status and logs:

```bash
docker compose --env-file .env --env-file .env.cloud -f docker-compose.yml -f docker-compose.cloud.yml ps
docker compose --env-file .env --env-file .env.cloud -f docker-compose.yml -f docker-compose.cloud.yml logs -f gateway
docker compose --env-file .env --env-file .env.cloud -f docker-compose.yml -f docker-compose.cloud.yml logs -f server
docker compose --env-file .env --env-file .env.cloud -f docker-compose.yml -f docker-compose.cloud.yml logs -f web
```

### 6.6 Stop cloud stack

```bash
pnpm docker:stack:cloud:down
```

Raw compose equivalent:

```bash
docker compose --env-file .env --env-file .env.cloud -f docker-compose.yml -f docker-compose.cloud.yml down
```

## 7. Database and startup behavior

Server container boot sequence:

1. Run legacy dispute-status backfill SQL.
2. Run `prisma db push`.
3. Start API process.

Operational implications:

- Schema is auto-applied at each start.
- PostgreSQL data is persisted in compose volume `pgdata`.
- Recreating containers does not delete DB data unless you remove volumes explicitly.

Optional one-time hardening for existing databases:

Local mode:

```bash
docker compose --env-file .env --env-file .env.local -f docker-compose.yml -f docker-compose.local.yml exec server node_modules/.bin/prisma db execute --schema prisma/schema.prisma --file prisma/pre_migrations/20260409_dispute_open_unique_guard.sql
```

Cloud mode:

```bash
docker compose --env-file .env --env-file .env.cloud -f docker-compose.yml -f docker-compose.cloud.yml exec server node_modules/.bin/prisma db execute --schema prisma/schema.prisma --file prisma/pre_migrations/20260409_dispute_open_unique_guard.sql
```

## 8. Day-2 operations

### 8.1 Update to latest code and redeploy

```bash
git pull
pnpm docker:stack:local:up
# or
pnpm docker:stack:cloud:up
```

Because `up --build -d --remove-orphans` is used, images are rebuilt and containers are recreated as needed.

### 8.2 Restart specific services

Local:

```bash
docker compose --env-file .env --env-file .env.local -f docker-compose.yml -f docker-compose.local.yml restart server web
```

Cloud:

```bash
docker compose --env-file .env --env-file .env.cloud -f docker-compose.yml -f docker-compose.cloud.yml restart gateway server web
```

### 8.3 Backup/restore reminders

- Database state is in PostgreSQL volume `pgdata`.
- Perform regular logical dumps for cloud production.
- If you change `POSTGRES_USER` or `POSTGRES_PASSWORD`, update `DATABASE_URL` (in both shared and mode-override files if you split values).

### 8.4 Full reset (destructive)

Use only when you intentionally want to wipe DB data:

```bash
docker compose --env-file .env --env-file .env.local -f docker-compose.yml -f docker-compose.local.yml down -v
# or
docker compose --env-file .env --env-file .env.cloud -f docker-compose.yml -f docker-compose.cloud.yml down -v
```

## 9. Verification matrix (what to check before declaring success)

Local mode:

- `docker compose ps` shows `postgres`, `redis`, `server`, `web` healthy/running.
- Local smoke checks pass.
- Web root and API health reachable from host.

Cloud mode:

- `docker compose ps` shows `postgres`, `redis`, `server`, `web`, `gateway` healthy/running.
- Cloud smoke checks pass.
- Domain DNS resolves to your server IP.
- HTTP/HTTPS behavior matches your `CLOUD_HTTP_REDIRECT_TO_HTTPS` setting.
- API reachable at `${CLOUD_API_PATH_PREFIX}` and web at `/`.

## 10. Troubleshooting guide

### 10.1 Placeholder secret startup failure

Symptom:

- Server exits with runtime config error for `JWT_SECRET` or `ADMIN_SERVICE_KEY`.

Fix:

- Replace both placeholder values in `.env` and redeploy.

### 10.2 CORS rejected in browser

Symptom:

- Browser API calls fail with CORS error.

Fix:

- Add exact frontend origin(s) to `CORS_ALLOWED_ORIGINS`.
- Use full origin format: `https://example.com`.

### 10.3 Gateway HTTPS boot failure

Symptom:

- `gateway` container exits on startup in HTTPS mode.

Fix checklist:

- `CLOUD_HTTPS_ENABLED=true` only when cert/key are present.
- `CLOUD_HTTPS_CERTS_DIR` points to correct host directory.
- Container paths in `CLOUD_HTTPS_CERT_FILE` and `CLOUD_HTTPS_KEY_FILE` exist after mount.
- File permissions allow container read access.

### 10.4 Local curl returns proxy error or `502`

Symptom:

- Local checks fail due to shell proxy interception.

Fix:

```bash
curl --noproxy '*' http://127.0.0.1:3000/v2/system/health
export NO_PROXY=localhost,127.0.0.1,.local
```

### 10.5 Port binding conflicts

Symptom:

- Compose fails with "port already allocated".

Fix:

- Change corresponding bind ports in `.env`:
  - Local: `LOCAL_*_PORT`
  - Cloud: `CLOUD_HTTP_PORT`, `CLOUD_HTTPS_PORT`

### 10.6 Database connection/auth failures

Symptom:

- Server cannot connect to PostgreSQL.

Fix checklist:

- Verify `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`.
- Verify `DATABASE_URL` matches those credentials.
- Check postgres container health/logs.

## 11. Related references

- Environment variable reference: `docs/configuration/environment.md`
- Quick entry: `DEPLOY.md`
- API contract overview: `docs/api/overview.md`
