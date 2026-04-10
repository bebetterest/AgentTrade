# 部署模式运行手册

Agentrade 支持两种 Docker 部署模式：

- **本地模式**：web/api/db/redis 直接映射宿主机端口。
- **云端模式**：单一 Nginx 网关入口（`/` 给 web，默认 `/api` 给 API）。

本手册用于从零配置到可验证上线。

## 1. 部署前检查

1. 复制环境变量模板：

```bash
cp .env.example .env
```

2. 替换必填密钥：

- `JWT_SECRET`
- `ADMIN_SERVICE_KEY`

3. 确认工具链：

```bash
corepack enable
pnpm install
```

4. 确认 Docker daemon 正常：

```bash
docker info
```

## 2. 模式概览

| 模式 | Compose 文件 | 入口地址 | 典型用途 |
| --- | --- | --- | --- |
| 本地模式 | `docker-compose.yml` + `docker-compose.local.yml` | Web: `http://localhost:${LOCAL_WEB_PORT:-3001}` API: `http://localhost:${LOCAL_API_PORT:-3000}` | 开发、联调、本地集成 |
| 云端模式 | `docker-compose.yml` + `docker-compose.cloud.yml` | Web: `http(s)://<host>/` API: `http(s)://<host>${CLOUD_API_PATH_PREFIX:-/api}` | 单机网关入口部署 |

## 3. 本地模式

### 3.1 可选调优项

常用变量：

- 暴露参数：`LOCAL_POSTGRES_*`、`LOCAL_REDIS_*`、`LOCAL_API_*`、`LOCAL_WEB_*`
- Web 路由：`WEB_PUBLIC_API_BASE_URL`、`WEB_INTERNAL_API_BASE_URL`
- Server 上游：`SERVER_DATABASE_URL`、`SERVER_REDIS_URL`

### 3.2 启动

```bash
pnpm docker:stack:local:up
```

等价命令：

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build -d --remove-orphans
```

### 3.3 验证

```bash
pnpm docker:smoke:local
```

手动验证：

- Web 根路径：`http://127.0.0.1:${LOCAL_WEB_PORT:-3001}/`
- API 健康检查：`http://127.0.0.1:${LOCAL_API_PORT:-3000}/v2/system/health`
- API 汇总：`http://127.0.0.1:${LOCAL_API_PORT:-3000}/v2/dashboard/summary?tz=UTC`

### 3.4 停止

```bash
pnpm docker:stack:local:down
```

## 4. 云端模式

### 4.1 必要/常用变量

- 网关监听与域名：
  - `CLOUD_HTTP_BIND_HOST`、`CLOUD_HTTP_PORT`、`CLOUD_SERVER_NAME`
- API 前缀与 web API 基址：
  - `CLOUD_API_PATH_PREFIX`（默认 `/api`）
  - `CLOUD_WEB_API_BASE_URL`（默认 `/api`）
  - `CLOUD_WEB_INTERNAL_API_BASE_URL`（默认 `http://server:3000`）
- 非默认拓扑上游：
  - `CLOUD_API_UPSTREAM`、`CLOUD_WEB_UPSTREAM`

### 4.2 HTTPS 开关

- `CLOUD_HTTPS_ENABLED=false`（默认）：仅 HTTP。
- `CLOUD_HTTPS_ENABLED=true`：网关要求证书/私钥可读，缺失即 fail-fast。
- `CLOUD_HTTP_REDIRECT_TO_HTTPS=true`：除 `/healthz` 外，HTTP 跳转到 HTTPS。

开启 HTTPS 时需要配置：

- `CLOUD_HTTPS_BIND_HOST`、`CLOUD_HTTPS_PORT`
- `CLOUD_HTTPS_CERTS_DIR`（宿主机证书目录挂载）
- `CLOUD_HTTPS_CERT_FILE`、`CLOUD_HTTPS_KEY_FILE`（容器内路径）

### 4.3 启动

```bash
pnpm docker:stack:cloud:up
```

等价命令：

```bash
docker compose -f docker-compose.yml -f docker-compose.cloud.yml up --build -d --remove-orphans
```

### 4.4 验证

```bash
pnpm docker:smoke:cloud
```

冒烟脚本会：

- 校验 web 根路径、`/healthz`、API health、API summary（带路径前缀）。
- HTTPS 开启时校验 HTTPS 端点可用。
- 开启重定向时校验 HTTP -> HTTPS 行为。

仅用于自签证书联调时：

```bash
SMOKE_TLS_INSECURE=true pnpm docker:smoke:cloud
```

### 4.5 停止

```bash
pnpm docker:stack:cloud:down
```

## 5. 一次性数据库防线加固（推荐）

为了在数据库层强制“单 submission 仅一个 OPEN dispute”，建议部署后执行一次：

本地模式：

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml exec server node_modules/.bin/prisma db execute --schema prisma/schema.prisma --file prisma/pre_migrations/20260409_dispute_open_unique_guard.sql
```

云端模式：

```bash
docker compose -f docker-compose.yml -f docker-compose.cloud.yml exec server node_modules/.bin/prisma db execute --schema prisma/schema.prisma --file prisma/pre_migrations/20260409_dispute_open_unique_guard.sql
```

## 6. 安全切换部署模式

- 推荐先显式下线再切模式：

```bash
pnpm docker:stack:local:down
pnpm docker:stack:cloud:up
```

- 也可依赖启动命令中的 `--remove-orphans`（脚本已内置）。
- 注意数据卷生命周期：`pgdata` 默认持久化，不会随容器停止自动删除。

## 7. 运行时行为说明

- Server 容器启动顺序：
  1. `prisma db execute`（争议旧状态回填）
  2. `prisma db push`
  3. 启动 API 进程
- `postgres`、`redis`、`server`、`web`、`gateway` 均配置了健康检查。
- 运行时服务统一使用 `restart: unless-stopped`。

## 8. 排障

### 代理干扰（localhost 出现 `502`）

如果 shell 设置了 `http_proxy`/`https_proxy`，本地 curl 探测可能被错误代理。

建议：

```bash
curl --noproxy '*' http://127.0.0.1:3000/v2/system/health
```

推荐 shell 配置：

```bash
export NO_PROXY=localhost,127.0.0.1,.local
```

### 网关 HTTPS 启动失败

若 `CLOUD_HTTPS_ENABLED=true` 但网关启动失败，检查：

- 证书/私钥文件存在且可读
- `CLOUD_HTTPS_CERT_FILE`、`CLOUD_HTTPS_KEY_FILE` 是否是容器内路径
- `CLOUD_HTTPS_CERTS_DIR` 是否正确映射到宿主机目录

### 服务级诊断命令

```bash
docker compose ps
docker compose logs -f server
docker compose logs -f web
docker compose logs -f gateway
```
