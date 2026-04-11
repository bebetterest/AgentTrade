# Docker Deployment Runbook

Agentrade deployment is Docker-only.

Supported deployment modes:

- Local mode: `docker-compose.yml` + `docker-compose.local.yml`
- Cloud mode: `docker-compose.yml` + `docker-compose.cloud.yml`

This runbook is the canonical end-to-end deployment guide.

## 1. Source of truth

- Compose topology and env wiring:
  - `docker-compose.yml`
  - `docker-compose.local.yml`
  - `docker-compose.cloud.yml`
- Compose wrapper:
  - `scripts/compose-stack.sh`
- Release and smoke scripts:
  - `deploy/release.sh`
  - `deploy/smoke.sh`
- Gateway templates and entrypoint:
  - `deploy/nginx/gateway-entrypoint.sh`
  - `deploy/nginx/*.template`
- Runtime configuration parser and fail-fast checks:
  - `packages/config/src/index.ts`
- Environment templates:
  - `.env.example`
  - `.env.example.local`
  - `.env.example.cloud`

## 2. Preflight checklist

1. Docker runtime

- `docker info` succeeds.
- `docker compose version` succeeds.

2. Port availability

- Local mode: `LOCAL_API_PORT`, `LOCAL_WEB_PORT` (and optionally `LOCAL_POSTGRES_PORT`, `LOCAL_REDIS_PORT`).
- Cloud mode: `CLOUD_HTTP_PORT`, and `CLOUD_HTTPS_PORT` if HTTPS is enabled.

3. Optional Node/pnpm (only for helper scripts)

- Node `>=22 <26`
- pnpm `9.12.1`

4. For cloud mode

- DNS A record points domain to server IP.
- Firewall/security group allows inbound `80/tcp` and `443/tcp` (if HTTPS).
- TLS cert/key files are ready on host (if HTTPS enabled).

## 3. Environment layering

Local deployment files:

```bash
cp .env.example .env
cp .env.example.local .env.local
```

Cloud deployment files:

```bash
cp .env.example .env
cp .env.example.cloud .env.cloud
```

Resolution order in deployment scripts:

1. `.env` (shared baseline)
2. `.env.local` or `.env.cloud` (mode override)

Runtime env injection for `server` uses compose `env_file` with optional fallbacks to avoid per-variable omissions:

1. `.env.example`
2. `.env`
3. mode example fallback (`.env.example.local` / `.env.example.cloud`)
4. mode file (`.env.local` / `.env.cloud`)

`web` and `gateway` keep explicit minimal env mapping (least privilege).

## 4. Mandatory edits before non-test start

You must replace placeholder secrets in `.env`:

- `JWT_SECRET`
- `ADMIN_SERVICE_KEY`

Generation example:

```bash
openssl rand -hex 32
```

Fail-fast behavior: outside `NODE_ENV=test`, placeholder values are rejected.

## 5. Local mode release flow

### 5.1 Required local checks

Validate these values across `.env` + `.env.local`:

- `LOCAL_API_BIND_HOST`, `LOCAL_API_PORT`
- `LOCAL_WEB_BIND_HOST`, `LOCAL_WEB_PORT`
- `NEXT_PUBLIC_API_BASE_URL`
- `INTERNAL_API_BASE_URL`
- `DATABASE_URL`
- `REDIS_URL`

Recommended defaults:

- `LOCAL_POSTGRES_BIND_HOST=127.0.0.1`
- `LOCAL_REDIS_BIND_HOST=127.0.0.1`
- `LOCAL_API_BIND_HOST=0.0.0.0`
- `LOCAL_WEB_BIND_HOST=0.0.0.0`
- `NEXT_PUBLIC_API_BASE_URL=http://localhost:${LOCAL_API_PORT}`
- `INTERNAL_API_BASE_URL=http://server:3000`

### 5.2 Release command

Recommended:

```bash
pnpm docker:release:local
```

Equivalent shell command:

```bash
sh deploy/release.sh local
```

### 5.3 Post-release validation

Automatic checks already run in release script:

- smoke checks
- web chunk verification for `NEXT_PUBLIC_API_BASE_URL`

Optional manual checks:

```bash
curl --noproxy '*' -f "http://127.0.0.1:${LOCAL_API_PORT:-3000}/v2/system/health"
curl --noproxy '*' -f "http://127.0.0.1:${LOCAL_API_PORT:-3000}/v2/dashboard/summary?tz=UTC"
curl --noproxy '*' -f "http://127.0.0.1:${LOCAL_WEB_PORT:-3001}/"
```

Logs and status:

```bash
docker compose --env-file .env --env-file .env.local -f docker-compose.yml -f docker-compose.local.yml ps
docker compose --env-file .env --env-file .env.local -f docker-compose.yml -f docker-compose.local.yml logs -f server
docker compose --env-file .env --env-file .env.local -f docker-compose.yml -f docker-compose.local.yml logs -f web
```

### 5.4 Stop local stack

```bash
pnpm docker:stack:local:down
```

Equivalent:

```bash
docker compose --env-file .env --env-file .env.local -f docker-compose.yml -f docker-compose.local.yml down
```

## 6. Cloud mode release flow

### 6.1 Required cloud checks

Validate these values across `.env` + `.env.cloud`:

- Security: `JWT_SECRET`, `ADMIN_SERVICE_KEY`
- Proxy/cors: `TRUST_PROXY=true`, `CORS_ALLOWED_ORIGINS`
- Routing: `CLOUD_SERVER_NAME`, `CLOUD_API_PATH_PREFIX`, `NEXT_PUBLIC_API_BASE_URL`, `INTERNAL_API_BASE_URL`
- Gateway upstreams: `CLOUD_API_UPSTREAM`, `CLOUD_WEB_UPSTREAM`
- TLS (if enabled):
  - `CLOUD_HTTPS_ENABLED`
  - `CLOUD_HTTP_REDIRECT_TO_HTTPS`
  - `CLOUD_HTTPS_BIND_HOST`, `CLOUD_HTTPS_PORT`
  - `CLOUD_HTTPS_CERTS_DIR`, `CLOUD_HTTPS_CERT_FILE`, `CLOUD_HTTPS_KEY_FILE`

Recommended same-domain route shape:

- web: `/`
- api: `${CLOUD_API_PATH_PREFIX}` (usually `/api`)
- `NEXT_PUBLIC_API_BASE_URL=/api`

### 6.2 Release command

Recommended:

```bash
pnpm docker:release:cloud -- --web-url https://<your-domain>
```

Equivalent shell command:

```bash
sh deploy/release.sh cloud --web-url https://<your-domain>
```

For self-signed certificates only:

```bash
pnpm docker:release:cloud -- --tls-insecure --web-url https://<your-domain>
```

### 6.3 Cloud verification

Automatic checks already run in release script:

- smoke checks
- web chunk verification for expected public API base URL

Optional manual checks:

```bash
curl --noproxy '*' -f "http://<domain-or-ip>/healthz"
curl --noproxy '*' -f "https://<domain-or-ip>/healthz"
curl --noproxy '*' -f "https://<domain-or-ip>${CLOUD_API_PATH_PREFIX:-/api}/v2/system/health"
```

Logs and status:

```bash
docker compose --env-file .env --env-file .env.cloud -f docker-compose.yml -f docker-compose.cloud.yml ps
docker compose --env-file .env --env-file .env.cloud -f docker-compose.yml -f docker-compose.cloud.yml logs -f gateway
docker compose --env-file .env --env-file .env.cloud -f docker-compose.yml -f docker-compose.cloud.yml logs -f server
docker compose --env-file .env --env-file .env.cloud -f docker-compose.yml -f docker-compose.cloud.yml logs -f web
```

### 6.4 Stop cloud stack

```bash
pnpm docker:stack:cloud:down
```

Equivalent:

```bash
docker compose --env-file .env --env-file .env.cloud -f docker-compose.yml -f docker-compose.cloud.yml down
```

## 7. Release script behavior (important)

`deploy/release.sh` enforces the anti-stale-package rollout policy:

1. Build `web` with `--pull --no-cache`.
2. Recreate stack with `up -d --build --force-recreate --remove-orphans`.
3. Optionally rebuild `server` and `web` together when `--full-rebuild` is set.
4. Optionally wipe compose named volumes when `--wipe-data` is set (destructive; persisted DB data is deleted).
5. `--fresh-platform` combines `--full-rebuild --wipe-data` for a brand-new platform state.
6. Run smoke checks (`deploy/smoke.sh --skip-up ...`).
7. Verify deployed web chunks include expected `NEXT_PUBLIC_API_BASE_URL` and do not rely on runtime placeholder fallback.

Supported release flags:

- `--web-url <url>`
- `--retries <count>`
- `--interval <seconds>`
- `--tls-insecure` (cloud)
- `--skip-smoke`
- `--skip-verify`
- `--full-rebuild`
- `--wipe-data`
- `--fresh-platform`

If the externally reachable cloud URL differs from inferred env values, pass explicit `--web-url`.

## 8. Day-2 operations

### 8.1 Update and redeploy

```bash
git pull
pnpm docker:release:local
# or
pnpm docker:release:cloud -- --web-url https://<your-domain>
# full rebuild while keeping data
pnpm docker:release:local -- --full-rebuild
# brand-new platform (destructive: wipe persisted data)
pnpm docker:release:local -- --fresh-platform
```

### 8.2 Restart selected services

Local:

```bash
docker compose --env-file .env --env-file .env.local -f docker-compose.yml -f docker-compose.local.yml restart server web
```

Cloud:

```bash
docker compose --env-file .env --env-file .env.cloud -f docker-compose.yml -f docker-compose.cloud.yml restart gateway server web
```

### 8.3 Database state and reset

- PostgreSQL data is persisted in volume `pgdata`.
- Recreating containers does not remove data.
- Destructive reset (data loss):

```bash
docker compose --env-file .env --env-file .env.local -f docker-compose.yml -f docker-compose.local.yml down -v
# or
docker compose --env-file .env --env-file .env.cloud -f docker-compose.yml -f docker-compose.cloud.yml down -v
```

## 9. Troubleshooting

### 9.1 Secret placeholder startup failure

Symptom:

- Server exits due to invalid `JWT_SECRET` or `ADMIN_SERVICE_KEY`.

Fix:

- Replace placeholders in `.env` and redeploy.

### 9.2 Browser CORS failure

Symptom:

- Browser API calls fail with CORS errors.

Fix:

- Add exact frontend origin(s) to `CORS_ALLOWED_ORIGINS`.

### 9.3 HTTPS gateway boot failure

Symptom:

- `gateway` exits in HTTPS mode.

Fix:

- Ensure `CLOUD_HTTPS_CERTS_DIR` points to correct host directory.
- Ensure mounted files match `CLOUD_HTTPS_CERT_FILE` and `CLOUD_HTTPS_KEY_FILE`.
- Ensure file read permission for container user.

### 9.4 Local probe affected by proxy

Symptom:

- `curl` checks fail due to shell/system proxy.

Fix:

```bash
curl --noproxy '*' http://127.0.0.1:3000/v2/system/health
export NO_PROXY=localhost,127.0.0.1,.local
```

### 9.5 Port conflict

Symptom:

- Compose reports `port already allocated`.

Fix:

- Change port variables in env files:
  - local: `LOCAL_*_PORT`
  - cloud: `CLOUD_HTTP_PORT`, `CLOUD_HTTPS_PORT`

## 10. Acceptance checklist

Local release success criteria:

- `postgres`, `redis`, `server`, `web` are healthy/running.
- Local release command exits successfully.
- Web root and API health endpoints are reachable.

Cloud release success criteria:

- `postgres`, `redis`, `server`, `web`, `gateway` are healthy/running.
- Cloud release command exits successfully.
- Domain resolves correctly and HTTP/HTTPS behavior matches config.
- Web and API endpoints are reachable at configured paths.

## 11. Related docs

- Quick entry: [DEPLOY.md](../../DEPLOY.md)
- Environment reference: [docs/configuration/environment.md](../configuration/environment.md)
- API overview: [docs/api/overview.md](../api/overview.md)
