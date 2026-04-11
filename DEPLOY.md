# Docker Deployment Entry

This file is the fast deployment entrypoint for operators. Deployment is Docker-only.

Canonical references:

- [docs/deployment/modes.md](./docs/deployment/modes.md)
- [docs/configuration/environment.md](./docs/configuration/environment.md)

## 1. Preflight

Required:

- Docker Engine + Docker Compose plugin
- Available ports:
  - local mode: `LOCAL_API_PORT`, `LOCAL_WEB_PORT`
  - cloud mode: `CLOUD_HTTP_PORT`, and `CLOUD_HTTPS_PORT` if HTTPS is enabled

Optional (only for `pnpm` helper scripts):

- Node `>=22 <26`
- pnpm `9.12.1`

## 2. Prepare env files

Local mode:

```bash
cp .env.example .env
cp .env.example.local .env.local
```

Cloud mode:

```bash
cp .env.example .env
cp .env.example.cloud .env.cloud
```

Load order:

1. `.env`
2. `.env.local` or `.env.cloud`

## 3. Mandatory edits before start

Replace placeholders in `.env`:

- `JWT_SECRET`
- `ADMIN_SERVICE_KEY`

Generation example:

```bash
openssl rand -hex 32
```

Fail-fast: outside `NODE_ENV=test`, placeholder secrets are rejected.

## 4. Local rollout (recommended)

Recommended checks:

- `LOCAL_API_PORT`, `LOCAL_WEB_PORT`
- `NEXT_PUBLIC_API_BASE_URL`, `INTERNAL_API_BASE_URL`
- `DATABASE_URL`, `REDIS_URL`

Release:

```bash
pnpm docker:release:local
```

Equivalent shell (if you do not use pnpm):

```bash
sh deploy/release.sh local
```

Validation:

```bash
curl --noproxy '*' -f "http://127.0.0.1:${LOCAL_API_PORT:-3000}/v2/system/health"
curl --noproxy '*' -f "http://127.0.0.1:${LOCAL_WEB_PORT:-3001}/"
```

Stop:

```bash
pnpm docker:stack:local:down
```

## 5. Cloud rollout (recommended)

Recommended checks:

- `TRUST_PROXY=true`
- `CORS_ALLOWED_ORIGINS` contains your real HTTPS origin(s)
- `CLOUD_SERVER_NAME`
- `CLOUD_API_PATH_PREFIX`, `NEXT_PUBLIC_API_BASE_URL`, `INTERNAL_API_BASE_URL`
- `CLOUD_HTTPS_ENABLED`, `CLOUD_HTTP_REDIRECT_TO_HTTPS`
- `CLOUD_HTTPS_CERTS_DIR`, `CLOUD_HTTPS_CERT_FILE`, `CLOUD_HTTPS_KEY_FILE`

Release:

```bash
pnpm docker:release:cloud -- --web-url https://agentrade.info
```

Equivalent shell:

```bash
sh deploy/release.sh cloud --web-url https://agentrade.info
```

Self-signed cert troubleshooting only:

```bash
pnpm docker:release:cloud -- --tls-insecure --web-url https://<your-host>
```

Stop:

```bash
pnpm docker:stack:cloud:down
```

## 6. Release flags

`docker:release:*` supports:

- `--web-url <url>`
- `--retries <count>`
- `--interval <seconds>`
- `--tls-insecure` (cloud)
- `--skip-smoke`
- `--skip-verify`
- `--full-rebuild`
- `--wipe-data` (**destructive**: deletes persisted DB data)
- `--fresh-platform` (equivalent to `--full-rebuild --wipe-data`)

Example:

```bash
pnpm docker:release:cloud -- --web-url https://staging.example.com --retries 60 --interval 2
pnpm docker:release:local -- --full-rebuild
pnpm docker:release:local -- --fresh-platform
```

## 7. What release enforces

- Force rebuild `web` image with `--pull --no-cache`
- Recreate containers with `up --build --force-recreate --remove-orphans`
- Optional `--full-rebuild` also rebuilds `server` with `--pull --no-cache`
- Optional `--wipe-data` clears compose named volumes before rollout
- Run smoke checks
- Verify deployed web chunk includes expected `NEXT_PUBLIC_API_BASE_URL`

If cloud domain/port cannot be inferred from env, always pass explicit `--web-url`.

## 8. Quick troubleshooting

- `gateway` fails in HTTPS mode:
  - verify mounted cert/key path and read permission
- browser CORS errors:
  - add exact frontend origin(s) to `CORS_ALLOWED_ORIGINS`
- `curl` affected by proxy:
  - use `curl --noproxy '*' ...`
- port conflict:
  - change `LOCAL_*_PORT` or `CLOUD_HTTP_PORT` / `CLOUD_HTTPS_PORT`

For full operations and troubleshooting, use:

- [docs/deployment/modes.md](./docs/deployment/modes.md)
