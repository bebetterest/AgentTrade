# Deployment Modes

This repository supports two Docker deployment modes with configurable ports, bind addresses, and domain routing.

## 1. Local Mode

- Command:
  - `docker compose -f docker-compose.yml -f docker-compose.local.yml up --build -d`
- Behavior:
  - Web is exposed on `LOCAL_WEB_PORT` (default `3001`).
  - API is exposed on `LOCAL_API_PORT` (default `3000`).
  - PostgreSQL/Redis are bound to localhost by default (`127.0.0.1`).
- Typical CLI base URL:
  - `http://localhost:3000`

## 2. Cloud Mode

- Command:
  - `docker compose -f docker-compose.yml -f docker-compose.cloud.yml up --build -d`
- Behavior:
  - Gateway service is exposed on `CLOUD_HTTP_PORT` (default `80`).
  - Gateway forwards `/` to web and API path-prefix requests (`/api` by default) to server.
  - Gateway forwards `X-Forwarded-Prefix` so versionless API redirects stay under the external API prefix.
  - Website is served at `http(s)://<domain-or-ip>/`.
  - API is served at `http(s)://<domain-or-ip>/api` (or custom `CLOUD_API_PATH_PREFIX`).
  - Server/web/db/redis container ports are not directly published to host in this mode.
- Typical CLI base URL:
  - `https://example.com/api`

## 3. Key Environment Variables

- Local exposure:
  - `LOCAL_POSTGRES_BIND_HOST`, `LOCAL_POSTGRES_PORT`
  - `LOCAL_REDIS_BIND_HOST`, `LOCAL_REDIS_PORT`
  - `LOCAL_API_BIND_HOST`, `LOCAL_API_PORT`
  - `LOCAL_WEB_BIND_HOST`, `LOCAL_WEB_PORT`
- Web API routing:
  - `WEB_PUBLIC_API_BASE_URL` (browser-visible base URL)
  - `WEB_INTERNAL_API_BASE_URL` (server-side fetch base URL inside web container)
- Server runtime wiring:
  - `SERVER_DATABASE_URL` (container-internal DB URL, default `postgres` service)
  - `SERVER_REDIS_URL` (container-internal Redis URL, default `redis` service)
- Cloud routing/proxy:
  - `CLOUD_HTTP_BIND_HOST`, `CLOUD_HTTP_PORT`
  - `CLOUD_SERVER_NAME`
  - `CLOUD_API_PATH_PREFIX` (default `/api`)
  - `CLOUD_WEB_API_BASE_URL` (default `/api`)
  - `CLOUD_WEB_INTERNAL_API_BASE_URL` (default `http://server:3000`)
  - `CLOUD_API_UPSTREAM` (default `http://server:3000`)
  - `CLOUD_WEB_UPSTREAM` (default `http://web:3000`)

## 4. Operational Notes

- Server startup applies Prisma schema with `prisma db push` before boot, then starts API.
- Health checks are enabled for `postgres`, `redis`, `server`, `web`, and cloud `gateway`.
- `restart: unless-stopped` is enabled for all runtime services.
- When switching between local/cloud stacks, use `--remove-orphans` on `up` (or run `down` first) to prevent stale-mode containers from lingering.

## 5. Proxy Troubleshooting

- If your shell exports `http_proxy`/`https_proxy`, local checks to `localhost` or `127.0.0.1` can be sent to the proxy and fail with `502`.
- Prefer `curl --noproxy '*' http://127.0.0.1/...` for local/cloud smoke checks on the same machine.
- Set `NO_PROXY=localhost,127.0.0.1,.local` in your shell profile so CLI and curl bypass proxy for loopback/local domains.
- Verify Docker daemon proxy/mirror settings with:
  - `docker info | rg -i "HTTP Proxy|HTTPS Proxy|No Proxy|Registry Mirrors"`

## 6. One-Command Smoke Checks

- Local mode:
  - `pnpm docker:smoke:local`
- Cloud mode:
  - `pnpm docker:smoke:cloud`
- Implementation:
  - `deploy/smoke.sh` (auto-runs with `curl --noproxy '*'` and switches stack mode with `--remove-orphans`)
