# Docker 部署入口

本文档是运维快速入口。部署仅维护 Docker 路径。

权威参考：

- [docs/deployment/modes_cn.md](./docs/deployment/modes_cn.md)
- [docs/configuration/environment_cn.md](./docs/configuration/environment_cn.md)

## 1. 部署前检查

必需：

- Docker Engine + Docker Compose 插件
- 目标端口可用：
  - 本地模式：`LOCAL_API_PORT`、`LOCAL_WEB_PORT`
  - 云端模式：`CLOUD_HTTP_PORT`，启用 HTTPS 时还需 `CLOUD_HTTPS_PORT`

可选（仅当使用 `pnpm` 脚本时）：

- Node `>=22 <26`
- pnpm `9.12.1`

## 2. 准备环境变量文件

本地模式：

```bash
cp .env.example .env
cp .env.example.local .env.local
```

云端模式：

```bash
cp .env.example .env
cp .env.example.cloud .env.cloud
```

加载顺序：

1. `.env`
2. `.env.local` 或 `.env.cloud`

## 3. 启动前必改项

在 `.env` 中替换占位值：

- `JWT_SECRET`
- `ADMIN_SERVICE_KEY`

生成示例：

```bash
openssl rand -hex 32
```

Fail-fast：在 `NODE_ENV=test` 之外，占位密钥会被拒绝启动。

## 4. 本地发布（推荐）

建议先核对：

- `LOCAL_API_PORT`、`LOCAL_WEB_PORT`
- `NEXT_PUBLIC_API_BASE_URL`、`INTERNAL_API_BASE_URL`
- `DATABASE_URL`、`REDIS_URL`

发布：

```bash
pnpm docker:release:local
```

不使用 pnpm 时等价命令：

```bash
sh deploy/release.sh local
```

验证：

```bash
curl --noproxy '*' -f "http://127.0.0.1:${LOCAL_API_PORT:-3000}/v2/system/health"
curl --noproxy '*' -f "http://127.0.0.1:${LOCAL_WEB_PORT:-3001}/"
```

停止：

```bash
pnpm docker:stack:local:down
```

## 5. 云端发布（推荐）

建议先核对：

- `TRUST_PROXY=true`
- `CORS_ALLOWED_ORIGINS` 包含真实 HTTPS 域名 origin
- `CLOUD_SERVER_NAME`
- `CLOUD_API_PATH_PREFIX`、`NEXT_PUBLIC_API_BASE_URL`、`INTERNAL_API_BASE_URL`
- `CLOUD_HTTPS_ENABLED`、`CLOUD_HTTP_REDIRECT_TO_HTTPS`
- `CLOUD_HTTPS_CERTS_DIR`、`CLOUD_HTTPS_CERT_FILE`、`CLOUD_HTTPS_KEY_FILE`

发布：

```bash
pnpm docker:release:cloud -- --web-url https://agentrade.info
```

不使用 pnpm 时等价命令：

```bash
sh deploy/release.sh cloud --web-url https://agentrade.info
```

仅自签证书联调：

```bash
pnpm docker:release:cloud -- --tls-insecure --web-url https://<your-host>
```

停止：

```bash
pnpm docker:stack:cloud:down
```

## 6. 发布参数

`docker:release:*` 支持：

- `--web-url <url>`
- `--retries <count>`
- `--interval <seconds>`
- `--tls-insecure`（cloud）
- `--skip-smoke`
- `--skip-verify`
- `--full-rebuild`
- `--wipe-data`（**破坏性操作**：会清空持久化数据库数据）
- `--fresh-platform`（等价于 `--full-rebuild --wipe-data`）

示例：

```bash
pnpm docker:release:cloud -- --web-url https://staging.example.com --retries 60 --interval 2
pnpm docker:release:local -- --full-rebuild
pnpm docker:release:local -- --fresh-platform
```

## 7. 发布命令会强制执行的动作

- 使用 `--pull --no-cache` 重建 `web` 镜像
- 使用 `up --build --force-recreate --remove-orphans` 重建容器
- 可选 `--full-rebuild` 会额外对 `server` 执行 `--pull --no-cache` 重建
- 可选 `--wipe-data` 会在发布前清空 compose 命名卷
- 执行冒烟
- 校验线上 web chunk 已包含期望 `NEXT_PUBLIC_API_BASE_URL`

若云端域名/端口无法从 env 推断，请始终显式传入 `--web-url`。

## 8. 快速排障

- HTTPS 模式 `gateway` 启动失败：
  - 检查证书/私钥路径和读权限
- 浏览器 CORS 报错：
  - 将前端真实 origin 加入 `CORS_ALLOWED_ORIGINS`
- 本地 `curl` 被代理干扰：
  - 使用 `curl --noproxy '*' ...`
- 端口冲突：
  - 修改 `LOCAL_*_PORT` 或 `CLOUD_HTTP_PORT` / `CLOUD_HTTPS_PORT`

完整运维与排障请看：

- [docs/deployment/modes_cn.md](./docs/deployment/modes_cn.md)
