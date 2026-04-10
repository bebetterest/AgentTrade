# Docker Deployment Entry

This file is the fast entrypoint. Use the full runbook for complete procedures:

- [docs/deployment/modes.md](./docs/deployment/modes.md)
- [docs/configuration/environment.md](./docs/configuration/environment.md)

## 1. Choose deployment mode and template

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

- `.env` (shared baseline)
- `.env.local` or `.env.cloud` (mode override)

## 2. Required edits before startup

You must replace both placeholders in `.env`:

- `JWT_SECRET`
- `ADMIN_SERVICE_KEY`

Generation example:

```bash
openssl rand -hex 32
```

## 3. Local mode quick start

Recommended checks in `.env`:

- `LOCAL_API_PORT`, `LOCAL_WEB_PORT`
- `LOCAL_POSTGRES_PORT`, `LOCAL_REDIS_PORT`
- `WEB_PUBLIC_API_BASE_URL`
- `SERVER_DATABASE_URL`, `SERVER_REDIS_URL`

Start:

```bash
pnpm docker:stack:local:up
```

Validate:

```bash
pnpm docker:smoke:local
```

Stop:

```bash
pnpm docker:stack:local:down
```

## 4. Cloud mode quick start

Recommended checks in `.env`:

- `TRUST_PROXY=true`
- `CORS_ALLOWED_ORIGINS` includes your domain origin(s)
- `CLOUD_SERVER_NAME`
- `CLOUD_API_PATH_PREFIX`, `CLOUD_WEB_API_BASE_URL`
- `CLOUD_HTTPS_ENABLED`, `CLOUD_HTTP_REDIRECT_TO_HTTPS`
- `CLOUD_HTTPS_CERTS_DIR`, `CLOUD_HTTPS_CERT_FILE`, `CLOUD_HTTPS_KEY_FILE`

Start:

```bash
pnpm docker:stack:cloud:up
```

Validate:

```bash
pnpm docker:smoke:cloud
```

Self-signed cert debugging only:

```bash
SMOKE_TLS_INSECURE=true pnpm docker:smoke:cloud
```

Stop:

```bash
pnpm docker:stack:cloud:down
```

## 5. Critical notes

- Outside `NODE_ENV=test`, placeholder secrets are rejected (fail-fast).
- In HTTPS mode, gateway fails fast if cert/key are missing or unreadable.
- `/healthz` remains HTTP 200 even when HTTP->HTTPS redirect is enabled.
- If shell proxy affects localhost checks, use `curl --noproxy '*' ...`.
