# 部署模式运行手册

Agentrade 支持两种 Docker 部署模式，并有一个共享的全量配置基线：

- 本地模式：`docker-compose.yml` + `docker-compose.local.yml`
- 云端模式：`docker-compose.yml` + `docker-compose.cloud.yml`
- 全量配置基线：`.env.example`

本文档是完整部署手册，覆盖前置条件、必改配置、启动、验证、运维与排障。

## 1. 事实来源与文件职责

- Compose 拓扑与连线：
  - `docker-compose.yml`
  - `docker-compose.local.yml`
  - `docker-compose.cloud.yml`
- 网关模板与 HTTPS fail-fast 逻辑：
  - `deploy/nginx/gateway-entrypoint.sh`
  - `deploy/nginx/cloud.http-only.conf.template`
  - `deploy/nginx/cloud.https.no-redirect.conf.template`
  - `deploy/nginx/cloud.https.redirect.conf.template`
- 运行时配置解析与校验：
  - `packages/config/src/index.ts`
- 环境变量模板：
  - `.env.example`（全量参考）
  - `.env.example.local`（本地部署画像）
  - `.env.example.cloud`（云端部署画像）
- 冒烟脚本：
  - `deploy/smoke.sh`
- Compose 模式包装脚本：
  - `scripts/compose-stack.sh`

## 2. 部署前检查清单

1. 主机要求

- 已安装 Docker Engine + Docker Compose 插件（`docker compose version` 可执行）。
- 磁盘容量足够保存镜像和 PostgreSQL 数据卷。
- 端口未被占用：
  - 本地模式：`LOCAL_API_PORT`、`LOCAL_WEB_PORT`，可选 `LOCAL_POSTGRES_PORT`、`LOCAL_REDIS_PORT`。
  - 云端模式：`CLOUD_HTTP_PORT`，若启用 HTTPS 还需 `CLOUD_HTTPS_PORT`。

2. 可选 Node 工具链（仅当你使用 `pnpm` 脚本时需要）

- Node `>=22 <26`
- pnpm `9.12.1`
- 验证：

```bash
corepack enable
pnpm --version
```

3. Docker 健康检查

```bash
docker info
```

4. 确认部署目标

- 本地模式：本机开发/联调/测试。
- 云端模式：通过 Nginx 网关单入口部署。

## 3. 环境变量策略

采用分层 env 文件：

- 本地部署：

```bash
cp .env.example .env
cp .env.example.local .env.local
```

- 云端部署：

```bash
cp .env.example .env
cp .env.example.cloud .env.cloud
```

docker 脚本加载顺序：

1. `.env`（共享基线）
2. `.env.local` 或 `.env.cloud`（模式覆盖）

## 4. 非 test 环境启动前的必改项

`.env` 中以下值必须替换占位值：

- `JWT_SECRET`
- `ADMIN_SERVICE_KEY`

生成示例：

```bash
openssl rand -hex 32
```

Fail-fast 说明：在 `NODE_ENV=test` 之外，若仍为占位值会直接启动失败。

## 5. 本地模式部署（完整流程）

### 5.1 本地模式关键配置

至少核对 `.env` + `.env.local` 中以下项：

- 安全：
  - `JWT_SECRET`
  - `ADMIN_SERVICE_KEY`
- API/Web 对外暴露：
  - `LOCAL_API_BIND_HOST`、`LOCAL_API_PORT`
  - `LOCAL_WEB_BIND_HOST`、`LOCAL_WEB_PORT`
- 数据库与 Redis 暴露：
  - `LOCAL_POSTGRES_BIND_HOST`、`LOCAL_POSTGRES_PORT`
  - `LOCAL_REDIS_BIND_HOST`、`LOCAL_REDIS_PORT`
- 容器内上游地址：
  - `SERVER_DATABASE_URL`
  - `SERVER_REDIS_URL`
- Web API 路由：
  - `WEB_PUBLIC_API_BASE_URL`
  - `WEB_INTERNAL_API_BASE_URL`

推荐本地默认值：

- `LOCAL_POSTGRES_BIND_HOST=127.0.0.1`
- `LOCAL_REDIS_BIND_HOST=127.0.0.1`
- `LOCAL_API_BIND_HOST=0.0.0.0`
- `LOCAL_WEB_BIND_HOST=0.0.0.0`
- `WEB_PUBLIC_API_BASE_URL=http://localhost:${LOCAL_API_PORT}`
- `WEB_INTERNAL_API_BASE_URL=http://server:3000`

### 5.2 启动本地栈

使用脚本：

```bash
pnpm docker:stack:local:up
```

等价 compose 命令：

```bash
docker compose --env-file .env --env-file .env.local -f docker-compose.yml -f docker-compose.local.yml up --build -d --remove-orphans
```

### 5.3 验证本地部署

冒烟验证：

```bash
pnpm docker:smoke:local
```

手工检查：

```bash
curl --noproxy '*' -f "http://127.0.0.1:${LOCAL_API_PORT:-3000}/v2/system/health"
curl --noproxy '*' -f "http://127.0.0.1:${LOCAL_API_PORT:-3000}/v2/dashboard/summary?tz=UTC"
curl --noproxy '*' -f "http://127.0.0.1:${LOCAL_WEB_PORT:-3001}/"
```

查看容器与日志：

```bash
docker compose --env-file .env --env-file .env.local -f docker-compose.yml -f docker-compose.local.yml ps
docker compose --env-file .env --env-file .env.local -f docker-compose.yml -f docker-compose.local.yml logs -f server
docker compose --env-file .env --env-file .env.local -f docker-compose.yml -f docker-compose.local.yml logs -f web
```

### 5.4 停止本地栈

```bash
pnpm docker:stack:local:down
```

等价 compose 命令：

```bash
docker compose --env-file .env --env-file .env.local -f docker-compose.yml -f docker-compose.local.yml down
```

## 6. 云端模式部署（完整流程）

### 6.1 云端部署前置条件

1. DNS

- 域名 A 记录指向服务器 IP。
- 示例：`agentrade.info -> 43.156.161.81`。

2. 网络与安全组/防火墙

- 放行入站 `80/tcp`。
- 若启用 HTTPS，放行入站 `443/tcp`。

3. 证书材料（HTTPS 模式）

- 在宿主机准备证书和私钥文件。
- `CLOUD_HTTPS_CERTS_DIR` 必须指向该宿主机目录。
- `CLOUD_HTTPS_CERT_FILE` 与 `CLOUD_HTTPS_KEY_FILE` 必须是容器内路径（位于 `/etc/nginx/certs/...`）。

### 6.2 云端模式关键配置

至少核对 `.env` + `.env.cloud` 中以下项：

- 安全：
  - `JWT_SECRET`
  - `ADMIN_SERVICE_KEY`
- 代理感知：
  - `TRUST_PROXY=true`
- CORS：
  - `CORS_ALLOWED_ORIGINS` 包含你的 HTTPS 域名 origin
- 网关基础路由：
  - `CLOUD_SERVER_NAME`
  - `CLOUD_HTTP_BIND_HOST`、`CLOUD_HTTP_PORT`
  - `CLOUD_API_PATH_PREFIX`
  - `CLOUD_WEB_API_BASE_URL`
  - `CLOUD_WEB_INTERNAL_API_BASE_URL`
- 网关上游：
  - `CLOUD_API_UPSTREAM`
  - `CLOUD_WEB_UPSTREAM`
- HTTPS（启用时）：
  - `CLOUD_HTTPS_ENABLED`
  - `CLOUD_HTTP_REDIRECT_TO_HTTPS`
  - `CLOUD_HTTPS_BIND_HOST`、`CLOUD_HTTPS_PORT`
  - `CLOUD_HTTPS_CERTS_DIR`
  - `CLOUD_HTTPS_CERT_FILE`
  - `CLOUD_HTTPS_KEY_FILE`

云端默认路径形状（单机同域）为：

- API 对外路径：`${CLOUD_API_PATH_PREFIX}`（默认 `/api`）
- Web 对外路径：`/`
- Web 浏览器 API 基址：通常 `/api`

### 6.3 TLS 行为与 fail-fast

当 `CLOUD_HTTPS_ENABLED=true` 时，只要以下任一文件不存在或不可读，网关会立即启动失败：

- `CLOUD_HTTPS_CERT_FILE`
- `CLOUD_HTTPS_KEY_FILE`

当 `CLOUD_HTTP_REDIRECT_TO_HTTPS=true` 时：

- 普通 HTTP 请求会跳转到 HTTPS。
- `/healthz` 在 HTTP 下仍保持 200（用于健康探针）。

### 6.4 启动云端栈

使用脚本：

```bash
pnpm docker:stack:cloud:up
```

等价 compose 命令：

```bash
docker compose --env-file .env --env-file .env.cloud -f docker-compose.yml -f docker-compose.cloud.yml up --build -d --remove-orphans
```

建议先查看渲染后的配置：

```bash
docker compose --env-file .env --env-file .env.cloud -f docker-compose.yml -f docker-compose.cloud.yml config
```

### 6.5 验证云端部署

冒烟验证：

```bash
pnpm docker:smoke:cloud
```

仅自签证书联调时：

```bash
SMOKE_TLS_INSECURE=true pnpm docker:smoke:cloud
```

手工检查（按你的域名/IP替换）：

```bash
curl --noproxy '*' -f "http://<domain-or-ip>/healthz"
curl --noproxy '*' -f "https://<domain-or-ip>/healthz"
curl --noproxy '*' -f "https://<domain-or-ip>${CLOUD_API_PATH_PREFIX:-/api}/v2/system/health"
```

查看容器与日志：

```bash
docker compose --env-file .env --env-file .env.cloud -f docker-compose.yml -f docker-compose.cloud.yml ps
docker compose --env-file .env --env-file .env.cloud -f docker-compose.yml -f docker-compose.cloud.yml logs -f gateway
docker compose --env-file .env --env-file .env.cloud -f docker-compose.yml -f docker-compose.cloud.yml logs -f server
docker compose --env-file .env --env-file .env.cloud -f docker-compose.yml -f docker-compose.cloud.yml logs -f web
```

### 6.6 停止云端栈

```bash
pnpm docker:stack:cloud:down
```

等价 compose 命令：

```bash
docker compose --env-file .env --env-file .env.cloud -f docker-compose.yml -f docker-compose.cloud.yml down
```

## 7. 数据库与启动行为说明

Server 容器启动顺序：

1. 执行争议旧状态回填 SQL。
2. 执行 `prisma db push`。
3. 启动 API 进程。

运维含义：

- 每次启动会自动尝试应用 schema。
- PostgreSQL 数据持久化在 `pgdata` volume。
- 重建容器不会清空数据库，除非你显式删除 volume。

可选一次性数据库加固（针对已有库）：

本地模式：

```bash
docker compose --env-file .env --env-file .env.local -f docker-compose.yml -f docker-compose.local.yml exec server node_modules/.bin/prisma db execute --schema prisma/schema.prisma --file prisma/pre_migrations/20260409_dispute_open_unique_guard.sql
```

云端模式：

```bash
docker compose --env-file .env --env-file .env.cloud -f docker-compose.yml -f docker-compose.cloud.yml exec server node_modules/.bin/prisma db execute --schema prisma/schema.prisma --file prisma/pre_migrations/20260409_dispute_open_unique_guard.sql
```

## 8. 日常运维（Day-2）

### 8.1 更新代码并重部署

```bash
git pull
pnpm docker:stack:local:up
# 或
pnpm docker:stack:cloud:up
```

由于使用 `up --build -d --remove-orphans`，镜像会重建并按需重建容器。

### 8.2 重启指定服务

本地模式：

```bash
docker compose --env-file .env --env-file .env.local -f docker-compose.yml -f docker-compose.local.yml restart server web
```

云端模式：

```bash
docker compose --env-file .env --env-file .env.cloud -f docker-compose.yml -f docker-compose.cloud.yml restart gateway server web
```

### 8.3 备份/恢复提醒

- 数据库状态在 PostgreSQL `pgdata` volume 中。
- 云端生产建议定期做逻辑备份（dump）。
- 若修改了 `POSTGRES_USER` 或 `POSTGRES_PASSWORD`，需同步更新：
  - `SERVER_DATABASE_URL`
  - `DATABASE_URL`（若你还在宿主机工具里使用）

### 8.4 全量重置（破坏性）

仅在确认要清空数据库时使用：

```bash
docker compose --env-file .env --env-file .env.local -f docker-compose.yml -f docker-compose.local.yml down -v
# 或
docker compose --env-file .env --env-file .env.cloud -f docker-compose.yml -f docker-compose.cloud.yml down -v
```

## 9. 上线验收矩阵

本地模式：

- `docker compose ps` 中 `postgres`、`redis`、`server`、`web` 为 running/healthy。
- 本地 smoke 全通过。
- 宿主机可访问 Web 根路径和 API health。

云端模式：

- `docker compose ps` 中 `postgres`、`redis`、`server`、`web`、`gateway` 为 running/healthy。
- 云端 smoke 全通过。
- 域名 DNS 解析到目标服务器 IP。
- HTTP/HTTPS 行为与 `CLOUD_HTTP_REDIRECT_TO_HTTPS` 设定一致。
- API 在 `${CLOUD_API_PATH_PREFIX}` 可用，Web 在 `/` 可用。

## 10. 排障手册

### 10.1 占位密钥导致启动失败

现象：

- Server 报 `JWT_SECRET` 或 `ADMIN_SERVICE_KEY` 配置错误并退出。

处理：

- 替换 `.env` 中两个占位值后重启部署。

### 10.2 浏览器 CORS 拒绝

现象：

- 浏览器调用 API 出现 CORS 错误。

处理：

- 将前端真实 origin 加入 `CORS_ALLOWED_ORIGINS`。
- 必须是完整 origin，如 `https://example.com`。

### 10.3 HTTPS 模式网关启动失败

现象：

- `gateway` 容器在 HTTPS 模式下直接退出。

处理清单：

- 仅在证书就绪时设置 `CLOUD_HTTPS_ENABLED=true`。
- `CLOUD_HTTPS_CERTS_DIR` 指向正确宿主机目录。
- `CLOUD_HTTPS_CERT_FILE` 与 `CLOUD_HTTPS_KEY_FILE` 对应挂载后的容器内文件路径。
- 文件权限允许容器读取。

### 10.4 本地 curl 被代理干扰或返回 `502`

现象：

- 本地检查请求被 shell 代理劫持。

处理：

```bash
curl --noproxy '*' http://127.0.0.1:3000/v2/system/health
export NO_PROXY=localhost,127.0.0.1,.local
```

### 10.5 端口冲突

现象：

- Compose 报错 `port already allocated`。

处理：

- 修改 `.env` 对应端口：
  - 本地模式：`LOCAL_*_PORT`
  - 云端模式：`CLOUD_HTTP_PORT`、`CLOUD_HTTPS_PORT`

### 10.6 数据库连接或认证失败

现象：

- Server 无法连接 PostgreSQL。

处理清单：

- 检查 `POSTGRES_DB`、`POSTGRES_USER`、`POSTGRES_PASSWORD`。
- 检查 `SERVER_DATABASE_URL` 是否与上述凭据一致。
- 查看 postgres 容器健康状态与日志。

## 11. 相关文档

- 环境变量总表：`docs/configuration/environment_cn.md`
- 快速入口：`DEPLOY_cn.md`
- API 总览：`docs/api/overview_cn.md`
