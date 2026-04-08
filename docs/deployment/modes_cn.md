# 部署模式

本仓库支持两种 Docker 部署模式，并可配置端口、监听地址与域名路由策略。

## 1. 本地模式

- 命令：
  - `docker compose -f docker-compose.yml -f docker-compose.local.yml up --build -d`
- 行为：
  - Web 暴露在 `LOCAL_WEB_PORT`（默认 `3001`）。
  - API 暴露在 `LOCAL_API_PORT`（默认 `3000`）。
  - PostgreSQL/Redis 默认仅绑定本机回环地址（`127.0.0.1`）。
- CLI 常用 base URL：
  - `http://localhost:3000`

## 2. 云端模式

- 命令：
  - `docker compose -f docker-compose.yml -f docker-compose.cloud.yml up --build -d`
- 行为：
  - 网关始终暴露 `CLOUD_HTTP_PORT`（默认 `80`）。
  - 网关同时暴露 `CLOUD_HTTPS_PORT`（默认 `443`），是否启用 HTTPS 由 `CLOUD_HTTPS_ENABLED` 控制。
  - 网关将 `/` 转发到 web，将 API 路径前缀请求（默认 `/api`）转发到 server。
  - 网关会透传 `X-Forwarded-Prefix`，确保无版本 API 重定向仍保留外部 API 前缀。
  - 当 `CLOUD_HTTPS_ENABLED=true` 时，必须提供有效证书/私钥文件，否则网关启动会失败（fail fast）。
  - 当 `CLOUD_HTTPS_ENABLED=true` 且 `CLOUD_HTTP_REDIRECT_TO_HTTPS=true` 时，HTTP 请求会跳转到 HTTPS（若 `CLOUD_HTTPS_PORT` 非 `443`，会带上该端口）；但 `HTTP /healthz` 仍保持 `200` 供健康检查使用。
  - 网站入口：`http(s)://<domain-or-ip>/`。
  - API 入口：`http(s)://<domain-or-ip>/api`（或自定义 `CLOUD_API_PATH_PREFIX`）。
  - 该模式下 server/web/db/redis 容器端口不会直接暴露到宿主机。
- CLI 常用 base URL：
  - `https://example.com/api`

## 3. 关键环境变量

- 本地暴露参数：
  - `LOCAL_POSTGRES_BIND_HOST`、`LOCAL_POSTGRES_PORT`
  - `LOCAL_REDIS_BIND_HOST`、`LOCAL_REDIS_PORT`
  - `LOCAL_API_BIND_HOST`、`LOCAL_API_PORT`
  - `LOCAL_WEB_BIND_HOST`、`LOCAL_WEB_PORT`
- Web API 路由参数：
  - `WEB_PUBLIC_API_BASE_URL`（浏览器可见 base URL）
  - `WEB_INTERNAL_API_BASE_URL`（Web 容器内服务端渲染 fetch 使用的 base URL）
- Server 运行时联动参数：
  - `SERVER_DATABASE_URL`（容器内数据库地址，默认指向 `postgres` 服务）
  - `SERVER_REDIS_URL`（容器内 Redis 地址，默认指向 `redis` 服务）
- 云端路由/代理参数：
  - `CLOUD_HTTP_BIND_HOST`、`CLOUD_HTTP_PORT`
  - `CLOUD_HTTPS_BIND_HOST`、`CLOUD_HTTPS_PORT`
  - `CLOUD_SERVER_NAME`
  - `CLOUD_HTTPS_ENABLED`（默认 `false`）
  - `CLOUD_HTTP_REDIRECT_TO_HTTPS`（默认 `false`）
  - `CLOUD_HTTPS_CERTS_DIR`（宿主机证书目录，只读挂载到网关容器）
  - `CLOUD_HTTPS_CERT_FILE`、`CLOUD_HTTPS_KEY_FILE`（容器内证书/私钥路径）
  - `CLOUD_API_PATH_PREFIX`（默认 `/api`）
  - `CLOUD_WEB_API_BASE_URL`（默认 `/api`）
  - `CLOUD_WEB_INTERNAL_API_BASE_URL`（默认 `http://server:3000`）
  - `CLOUD_API_UPSTREAM`（默认 `http://server:3000`）
  - `CLOUD_WEB_UPSTREAM`（默认 `http://web:3000`）

## 4. 运维说明

- Server 启动时会先执行争议旧状态回填（`prisma db execute --file prisma/pre_migrations/20260408_dispute_status_backfill.sql`），再执行 `prisma db push`，最后启动 API。
- 已为 `postgres`、`redis`、`server`、`web` 与云端 `gateway` 配置健康检查。
- 运行时服务统一开启 `restart: unless-stopped`。
- 本地/云端模式切换时，建议在 `up` 中使用 `--remove-orphans`（或先执行 `down`），避免旧模式容器残留。

## 5. 代理排障

- 如果你的 shell 导出了 `http_proxy`/`https_proxy`，访问 `localhost` 或 `127.0.0.1` 的本地探测请求可能会被转发到代理并返回 `502`。
- 建议本机联调时使用 `curl --noproxy '*' http://127.0.0.1/...` 进行本地/云端冒烟验证。
- 建议在 shell 配置中设置 `NO_PROXY=localhost,127.0.0.1,.local`，让 CLI 与 curl 对回环/本地域名直连。
- 可通过以下命令核对 Docker daemon 的代理与镜像源配置：
  - `docker info | rg -i "HTTP Proxy|HTTPS Proxy|No Proxy|Registry Mirrors"`

## 6. 一键冒烟验证

- 本地模式：
  - `pnpm docker:smoke:local`
- 云端模式：
  - `pnpm docker:smoke:cloud`
- 实现位置：
  - `deploy/smoke.sh`（内部自动使用 `curl --noproxy '*'`，并通过 `--remove-orphans` 切换部署模式；若启用 HTTPS 会自动校验 HTTPS/跳转行为）
  - 若仅用于自签证书冒烟联调，可设置 `SMOKE_TLS_INSECURE=true`。
