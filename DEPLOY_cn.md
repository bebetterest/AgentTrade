# Docker 部署入口

本文档是快速入口。完整流程请使用：

- [docs/deployment/modes_cn.md](./docs/deployment/modes_cn.md)
- [docs/configuration/environment_cn.md](./docs/configuration/environment_cn.md)

## 1. 选择部署模式与模板

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

- `.env`（共享基线）
- `.env.local` 或 `.env.cloud`（模式覆盖）

## 2. 启动前必改项

必须替换 `.env` 中两个占位值：

- `JWT_SECRET`
- `ADMIN_SERVICE_KEY`

生成示例：

```bash
openssl rand -hex 32
```

## 3. 本地模式快速启动

建议先核对 `.env`：

- `LOCAL_API_PORT`、`LOCAL_WEB_PORT`
- `LOCAL_POSTGRES_PORT`、`LOCAL_REDIS_PORT`
- `WEB_PUBLIC_API_BASE_URL`
- `SERVER_DATABASE_URL`、`SERVER_REDIS_URL`

启动：

```bash
pnpm docker:stack:local:up
```

验证：

```bash
pnpm docker:smoke:local
```

停止：

```bash
pnpm docker:stack:local:down
```

## 4. 云端模式快速启动

建议先核对 `.env`：

- `TRUST_PROXY=true`
- `CORS_ALLOWED_ORIGINS` 包含你的域名 origin
- `CLOUD_SERVER_NAME`
- `CLOUD_API_PATH_PREFIX`、`CLOUD_WEB_API_BASE_URL`
- `CLOUD_HTTPS_ENABLED`、`CLOUD_HTTP_REDIRECT_TO_HTTPS`
- `CLOUD_HTTPS_CERTS_DIR`、`CLOUD_HTTPS_CERT_FILE`、`CLOUD_HTTPS_KEY_FILE`

启动：

```bash
pnpm docker:stack:cloud:up
```

验证：

```bash
pnpm docker:smoke:cloud
```

仅自签证书联调：

```bash
SMOKE_TLS_INSECURE=true pnpm docker:smoke:cloud
```

停止：

```bash
pnpm docker:stack:cloud:down
```

## 5. 关键说明

- 在 `NODE_ENV=test` 之外，占位密钥会被 fail-fast 拒绝启动。
- HTTPS 模式下，证书或私钥缺失/不可读会导致网关启动失败。
- 即使启用 HTTP->HTTPS 跳转，`/healthz` 仍保持 HTTP 200。
- 若本地探活受代理干扰，请使用 `curl --noproxy '*' ...`。
