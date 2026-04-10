# Deployment Modes Runbook

Agentrade supports two Docker deployment modes:

- **Local mode**: direct host ports for web/api/db/redis.
- **Cloud mode**: single Nginx gateway entry (`/` for web, `/api` by default for API).

Use this runbook to go from clean environment to validated deployment.

## 1. Preflight checklist

1. Copy environment template:

```bash
cp .env.example .env
```

2. Replace required secrets:

- `JWT_SECRET`
- `ADMIN_SERVICE_KEY`

3. Confirm toolchain:

```bash
corepack enable
pnpm install
```

4. Ensure Docker daemon is healthy:

```bash
docker info
```

## 2. Mode overview

| Mode | Compose files | Entry URL | Typical use |
| --- | --- | --- | --- |
| Local | `docker-compose.yml` + `docker-compose.local.yml` | Web: `http://localhost:${LOCAL_WEB_PORT:-3001}` API: `http://localhost:${LOCAL_API_PORT:-3000}` | Dev, QA, local integration |
| Cloud | `docker-compose.yml` + `docker-compose.cloud.yml` | Web: `http(s)://<host>/` API: `http(s)://<host>${CLOUD_API_PATH_PREFIX:-/api}` | Single-host deployment behind gateway |

## 3. Local mode

### 3.1 Optional local tuning

Typical variables:

- Exposure: `LOCAL_POSTGRES_*`, `LOCAL_REDIS_*`, `LOCAL_API_*`, `LOCAL_WEB_*`
- Web routing: `WEB_PUBLIC_API_BASE_URL`, `WEB_INTERNAL_API_BASE_URL`
- Server upstreams: `SERVER_DATABASE_URL`, `SERVER_REDIS_URL`

### 3.2 Start stack

```bash
pnpm docker:stack:local:up
```

Equivalent command:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build -d --remove-orphans
```

### 3.3 Verify

```bash
pnpm docker:smoke:local
```

Manual checks:

- Web root: `http://127.0.0.1:${LOCAL_WEB_PORT:-3001}/`
- API health: `http://127.0.0.1:${LOCAL_API_PORT:-3000}/v2/system/health`
- API summary: `http://127.0.0.1:${LOCAL_API_PORT:-3000}/v2/dashboard/summary?tz=UTC`

### 3.4 Stop stack

```bash
pnpm docker:stack:local:down
```

## 4. Cloud mode

### 4.1 Required/typical cloud variables

- Gateway bind and server name:
  - `CLOUD_HTTP_BIND_HOST`, `CLOUD_HTTP_PORT`, `CLOUD_SERVER_NAME`
- API path and web API base:
  - `CLOUD_API_PATH_PREFIX` (default `/api`)
  - `CLOUD_WEB_API_BASE_URL` (default `/api`)
  - `CLOUD_WEB_INTERNAL_API_BASE_URL` (default `http://server:3000`)
- Optional non-default upstreams:
  - `CLOUD_API_UPSTREAM`, `CLOUD_WEB_UPSTREAM`

### 4.2 HTTPS options

- `CLOUD_HTTPS_ENABLED=false` (default): HTTP only.
- `CLOUD_HTTPS_ENABLED=true`: gateway requires readable cert/key files and fails fast if missing.
- `CLOUD_HTTP_REDIRECT_TO_HTTPS=true`: redirects HTTP requests to HTTPS except `/healthz`.

When HTTPS is enabled, configure:

- `CLOUD_HTTPS_BIND_HOST`, `CLOUD_HTTPS_PORT`
- `CLOUD_HTTPS_CERTS_DIR` (host mount)
- `CLOUD_HTTPS_CERT_FILE`, `CLOUD_HTTPS_KEY_FILE` (in-container paths)

### 4.3 Start stack

```bash
pnpm docker:stack:cloud:up
```

Equivalent command:

```bash
docker compose -f docker-compose.yml -f docker-compose.cloud.yml up --build -d --remove-orphans
```

### 4.4 Verify

```bash
pnpm docker:smoke:cloud
```

Smoke behavior:

- Checks web root, `/healthz`, API health, and API summary under path prefix.
- When HTTPS is enabled, validates HTTPS endpoints.
- When redirect is enabled, checks HTTP -> HTTPS redirect behavior.

For self-signed cert smoke checks only:

```bash
SMOKE_TLS_INSECURE=true pnpm docker:smoke:cloud
```

### 4.5 Stop stack

```bash
pnpm docker:stack:cloud:down
```

## 5. One-time DB guard hardening (recommended)

To enforce DB-level single-open-dispute guard on existing databases, run once after deployment:

Local mode:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml exec server node_modules/.bin/prisma db execute --schema prisma/schema.prisma --file prisma/pre_migrations/20260409_dispute_open_unique_guard.sql
```

Cloud mode:

```bash
docker compose -f docker-compose.yml -f docker-compose.cloud.yml exec server node_modules/.bin/prisma db execute --schema prisma/schema.prisma --file prisma/pre_migrations/20260409_dispute_open_unique_guard.sql
```

## 6. Switching modes safely

- Prefer explicit teardown before mode change:

```bash
pnpm docker:stack:local:down
pnpm docker:stack:cloud:up
```

- Or rely on `--remove-orphans` (already included in start scripts).
- Keep volume lifecycle in mind (`pgdata` is persistent unless removed explicitly).

## 7. Runtime behavior notes

- Server container boot sequence runs:
  1. `prisma db execute` legacy dispute-status backfill
  2. `prisma db push`
  3. API process start
- Health checks are configured for `postgres`, `redis`, `server`, `web`, and cloud `gateway`.
- Runtime services use `restart: unless-stopped`.

## 8. Troubleshooting

### Proxy interference (`502` on localhost)

If shell sets `http_proxy`/`https_proxy`, local curl checks can be sent to proxy by mistake.

Use:

```bash
curl --noproxy '*' http://127.0.0.1:3000/v2/system/health
```

Recommended shell setting:

```bash
export NO_PROXY=localhost,127.0.0.1,.local
```

### Gateway HTTPS boot failure

If `CLOUD_HTTPS_ENABLED=true` and startup fails, validate:

- cert/key files exist and are readable in mounted path
- `CLOUD_HTTPS_CERT_FILE` and `CLOUD_HTTPS_KEY_FILE` point to container paths
- `CLOUD_HTTPS_CERTS_DIR` maps to the correct host directory

### Service-level diagnostics

```bash
docker compose ps
docker compose logs -f server
docker compose logs -f web
docker compose logs -f gateway
```
