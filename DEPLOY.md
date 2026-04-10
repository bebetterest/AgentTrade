# Docker Deployment Quick Entry

This file is a quick entry. For the full runbook, use:

- [docs/deployment/modes.md](./docs/deployment/modes.md)
- [docs/configuration/environment.md](./docs/configuration/environment.md)

## 1. Quick start

```bash
cp .env.example .env
# Replace JWT_SECRET and ADMIN_SERVICE_KEY before boot
pnpm docker:stack:local:up
```

Stop local stack:

```bash
pnpm docker:stack:local:down
```

## 2. Cloud mode

```bash
cp .env.example .env
# Configure CLOUD_* variables as needed
pnpm docker:stack:cloud:up
```

Stop cloud stack:

```bash
pnpm docker:stack:cloud:down
```

## 3. Smoke checks

```bash
pnpm docker:smoke:local
pnpm docker:smoke:cloud
```

For self-signed HTTPS smoke checks only:

```bash
SMOKE_TLS_INSECURE=true pnpm docker:smoke:cloud
```

## 4. Common notes

- `JWT_SECRET` and `ADMIN_SERVICE_KEY` must not use placeholder defaults outside `NODE_ENV=test`.
- Cloud HTTPS mode fails fast when certificate or key files are missing.
- Localhost checks in proxy-enabled shells should use `curl --noproxy '*' ...`.
