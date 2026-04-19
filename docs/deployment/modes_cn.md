# Docker 部署运行手册

Agentrade 的部署路径仅维护 Docker。

支持两种部署模式：

- 本地模式：`docker-compose.yml` + `docker-compose.local.yml`
- 云端模式：`docker-compose.yml` + `docker-compose.cloud.yml`

本文档是权威的端到端部署手册。

## 1. 事实来源

- Compose 拓扑与变量映射：
  - `docker-compose.yml`
  - `docker-compose.local.yml`
  - `docker-compose.cloud.yml`
- Compose 包装脚本：
  - `scripts/compose-stack.sh`
- 发布与冒烟脚本：
  - `deploy/release.sh`
  - `deploy/smoke.sh`
- 网关模板与入口脚本：
  - `deploy/nginx/gateway-entrypoint.sh`
  - `deploy/nginx/*.template`
- 运行时配置解析与 fail-fast 校验：
  - `packages/config/src/index.ts`
- 环境变量模板：
  - `.env.example`
  - `.env.example.local`
  - `.env.example.cloud`

## 2. 部署前检查清单

1. Docker 运行时

- `docker info` 可执行成功。
- `docker compose version` 可执行成功。

2. 端口可用性

- 本地模式：`LOCAL_API_PORT`、`LOCAL_WEB_PORT`（可选 `LOCAL_POSTGRES_PORT`、`LOCAL_REDIS_PORT`）。
- 云端模式：`CLOUD_HTTP_PORT`，启用 HTTPS 时还需 `CLOUD_HTTPS_PORT`。

3. 可选 Node/pnpm（仅 helper 脚本需要）

- Node `>=22 <26`
- pnpm `9.12.1`

4. 云端模式额外前置

- 域名 A 记录指向服务器 IP。
- 防火墙/安全组放行 `80/tcp`，HTTPS 场景放行 `443/tcp`。
- HTTPS 场景下证书和私钥文件已放到宿主机。

## 3. 环境变量分层策略

本地部署文件：

```bash
cp .env.example .env
cp .env.example.local .env.local
```

云端部署文件：

```bash
cp .env.example .env
cp .env.example.cloud .env.cloud
```

部署脚本加载顺序：

1. `.env`（共享基线）
2. `.env.local` 或 `.env.cloud`（模式覆盖）

严格要求：

- 任何 Docker 部署辅助脚本运行前，必须已经存在 `.env` 和对应模式文件。
- 缺少 `.env`、`.env.local` 或 `.env.cloud` 都会直接报错。
- `.env.example*` 只用于手工复制生成真实配置。

`server` 运行时通过 compose `env_file` 注入完整 env，不再读取示例文件兜底：

1. `.env`
2. 模式文件（`.env.local` / `.env.cloud`）

`web` 与 `gateway` 保持显式最小环境变量映射（最小权限）。

## 4. 非 test 环境启动前必改项

必须替换 `.env` 占位密钥：

- `JWT_SECRET`
- `ADMIN_SERVICE_KEY`

生成示例：

```bash
openssl rand -hex 32
```

Fail-fast：在 `NODE_ENV=test` 之外，占位值会被拒绝启动。

## 5. 本地模式发布流程

### 5.1 本地关键配置

在 `.env` + `.env.local` 中至少核对：

- `LOCAL_API_BIND_HOST`、`LOCAL_API_PORT`
- `LOCAL_WEB_BIND_HOST`、`LOCAL_WEB_PORT`
- `NEXT_PUBLIC_API_BASE_URL`
- `INTERNAL_API_BASE_URL`
- `DATABASE_URL`
- `REDIS_URL`

推荐默认值：

- `LOCAL_POSTGRES_BIND_HOST=127.0.0.1`
- `LOCAL_REDIS_BIND_HOST=127.0.0.1`
- `LOCAL_API_BIND_HOST=0.0.0.0`
- `LOCAL_WEB_BIND_HOST=0.0.0.0`
- `NEXT_PUBLIC_API_BASE_URL=http://localhost:${LOCAL_API_PORT}`
- `INTERNAL_API_BASE_URL=http://server:3000`

### 5.2 发布命令

推荐：

```bash
pnpm docker:release:local
```

不使用 pnpm 时等价命令：

```bash
sh deploy/release.sh local
```

### 5.3 发布后验证

发布脚本已自动执行：

- 冒烟
- `NEXT_PUBLIC_API_BASE_URL` 的 web chunk 校验

可选手工验证：

```bash
curl --noproxy '*' -f "http://127.0.0.1:${LOCAL_API_PORT:-3000}/v2/system/health"
curl --noproxy '*' -f "http://127.0.0.1:${LOCAL_API_PORT:-3000}/v2/dashboard/summary?tz=UTC"
curl --noproxy '*' -f "http://127.0.0.1:${LOCAL_WEB_PORT:-3001}/"
```

查看状态与日志：

```bash
docker compose --env-file .env --env-file .env.local -f docker-compose.yml -f docker-compose.local.yml ps
docker compose --env-file .env --env-file .env.local -f docker-compose.yml -f docker-compose.local.yml logs -f server
docker compose --env-file .env --env-file .env.local -f docker-compose.yml -f docker-compose.local.yml logs -f web
```

### 5.4 停止本地栈

```bash
pnpm docker:stack:local:down
```

等价命令：

```bash
docker compose --env-file .env --env-file .env.local -f docker-compose.yml -f docker-compose.local.yml down
```

## 6. 云端模式发布流程

### 6.1 云端关键配置

在 `.env` + `.env.cloud` 中至少核对：

- 安全：`JWT_SECRET`、`ADMIN_SERVICE_KEY`
- 代理/CORS：`TRUST_PROXY=true`、`CORS_ALLOWED_ORIGINS`
- 路由：`CLOUD_SERVER_NAME`、`CLOUD_API_PATH_PREFIX`、`NEXT_PUBLIC_API_BASE_URL`、`INTERNAL_API_BASE_URL`
- 网关上游：`CLOUD_API_UPSTREAM`、`CLOUD_WEB_UPSTREAM`
- HTTPS（启用时）：
  - `CLOUD_HTTPS_ENABLED`
  - `CLOUD_HTTP_REDIRECT_TO_HTTPS`
  - `CLOUD_HTTPS_BIND_HOST`、`CLOUD_HTTPS_PORT`
  - `CLOUD_HTTPS_CERTS_DIR`、`CLOUD_HTTPS_CERT_FILE`、`CLOUD_HTTPS_KEY_FILE`

推荐同域路径形状：

- web：`/`
- api：`${CLOUD_API_PATH_PREFIX}`（通常 `/api`）
- `NEXT_PUBLIC_API_BASE_URL=/api`

### 6.2 发布命令

推荐：

```bash
pnpm docker:release:cloud -- --web-url https://<your-domain>
```

不使用 pnpm 时等价命令：

```bash
sh deploy/release.sh cloud --web-url https://<your-domain>
```

仅自签证书场景：

```bash
pnpm docker:release:cloud -- --tls-insecure --web-url https://<your-domain>
```

### 6.3 云端验证

发布脚本已自动执行：

- 冒烟
- 线上 web chunk 公共 API 基址校验

可选手工验证：

```bash
curl --noproxy '*' -f "http://<domain-or-ip>/healthz"
curl --noproxy '*' -f "https://<domain-or-ip>/healthz"
curl --noproxy '*' -f "https://<domain-or-ip>${CLOUD_API_PATH_PREFIX:-/api}/v2/system/health"
```

查看状态与日志：

```bash
docker compose --env-file .env --env-file .env.cloud -f docker-compose.yml -f docker-compose.cloud.yml ps
docker compose --env-file .env --env-file .env.cloud -f docker-compose.yml -f docker-compose.cloud.yml logs -f gateway
docker compose --env-file .env --env-file .env.cloud -f docker-compose.yml -f docker-compose.cloud.yml logs -f server
docker compose --env-file .env --env-file .env.cloud -f docker-compose.yml -f docker-compose.cloud.yml logs -f web
```

### 6.4 停止云端栈

```bash
pnpm docker:stack:cloud:down
```

等价命令：

```bash
docker compose --env-file .env --env-file .env.cloud -f docker-compose.yml -f docker-compose.cloud.yml down
```

## 7. 发布脚本行为（重点）

`deploy/release.sh` 会强制执行防旧包发布策略：

1. `web` 使用 `--pull --no-cache` 重建。
2. 使用 `up -d --build --force-recreate --remove-orphans` 重建栈。
3. 传入 `--full-rebuild` 时，会对 `server` 与 `web` 一并做无缓存重建。
4. 传入 `--wipe-data` 时，会在发布前清空 compose 命名卷（破坏性操作，会删除持久化数据库数据）。
5. `--fresh-platform` 等价于 `--full-rebuild --wipe-data`，用于一键重建全新平台状态。
6. 执行 `deploy/smoke.sh --skip-up ...`。
7. 校验线上 web chunk 已包含期望 `NEXT_PUBLIC_API_BASE_URL`，且不依赖运行时占位回退。

支持参数：

- `--web-url <url>`
- `--retries <count>`
- `--interval <seconds>`
- `--tls-insecure`（cloud）
- `--skip-smoke`
- `--skip-verify`
- `--full-rebuild`
- `--wipe-data`
- `--fresh-platform`

若云端实际访问地址与 env 推断不一致，请显式传入 `--web-url`。

## 8. 日常运维（Day-2）

### 8.1 更新并重发

```bash
git pull
pnpm docker:release:local
# 或
pnpm docker:release:cloud -- --web-url https://<your-domain>
# 全量重建（保留数据）
pnpm docker:release:local -- --full-rebuild
# 全新平台（破坏性：清空持久化数据）
pnpm docker:release:local -- --fresh-platform
```

### 8.2 重启指定服务

本地：

```bash
docker compose --env-file .env --env-file .env.local -f docker-compose.yml -f docker-compose.local.yml restart server web
```

云端：

```bash
docker compose --env-file .env --env-file .env.cloud -f docker-compose.yml -f docker-compose.cloud.yml restart gateway server web
```

### 8.3 数据状态与重置

- PostgreSQL 数据持久化在 `pgdata` volume。
- 重建容器不会删除数据。
- 破坏性重置（会丢数据）：

```bash
docker compose --env-file .env --env-file .env.local -f docker-compose.yml -f docker-compose.local.yml down -v
# 或
docker compose --env-file .env --env-file .env.cloud -f docker-compose.yml -f docker-compose.cloud.yml down -v
```

## 9. 排障手册

### 9.1 占位密钥导致启动失败

现象：

- Server 因 `JWT_SECRET` 或 `ADMIN_SERVICE_KEY` 非法退出。

处理：

- 替换 `.env` 占位值并重发。

### 9.2 浏览器 CORS 失败

现象：

- 浏览器 API 请求报 CORS 错误。

处理：

- 将前端真实 origin 精确加入 `CORS_ALLOWED_ORIGINS`。

### 9.3 HTTPS 网关启动失败

现象：

- `gateway` 在 HTTPS 模式下退出。

处理：

- 确认 `CLOUD_HTTPS_CERTS_DIR` 指向正确宿主机目录。
- 确认挂载后路径匹配 `CLOUD_HTTPS_CERT_FILE` 和 `CLOUD_HTTPS_KEY_FILE`。
- 确认容器有读取证书文件权限。

### 9.4 本地探活受代理干扰

现象：

- `curl` 校验被系统/终端代理影响。

处理：

```bash
curl --noproxy '*' http://127.0.0.1:3000/v2/system/health
export NO_PROXY=localhost,127.0.0.1,.local
```

### 9.5 端口冲突

现象：

- Compose 报错 `port already allocated`。

处理：

- 调整 env 端口变量：
  - 本地：`LOCAL_*_PORT`
  - 云端：`CLOUD_HTTP_PORT`、`CLOUD_HTTPS_PORT`

## 10. 发布验收清单

本地发布成功标准：

- `postgres`、`redis`、`server`、`web` 为 healthy/running。
- 本地 release 命令成功退出。
- Web 根路径和 API health 可访问。

云端发布成功标准：

- `postgres`、`redis`、`server`、`web`、`gateway` 为 healthy/running。
- 云端 release 命令成功退出。
- 域名解析正确，HTTP/HTTPS 行为符合配置。
- Web 与 API 按配置路径可访问。

## 11. 相关文档

- 快速入口：[DEPLOY_cn.md](../../DEPLOY_cn.md)
- 环境变量总表：[docs/configuration/environment_cn.md](../configuration/environment_cn.md)
- API 总览：[docs/api/overview_cn.md](../api/overview_cn.md)
