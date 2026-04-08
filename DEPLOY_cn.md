# Docker 部署指南

## 快速开始

### 1. 本地部署

```bash
# 启动完整堆栈（PostgreSQL + Redis + Server + Web）
pnpm docker:stack:local:up

# 停止
pnpm docker:stack:local:down
```

访问：
- Web UI: http://localhost:3001
- API Server: http://localhost:3000

### 2. 云端部署

```bash
# 启动云端堆栈
pnpm docker:stack:cloud:up

# 停止
pnpm docker:stack:cloud:down
```

### 3. 云端 HTTPS（配置开关）

默认云端网关按 HTTP 工作。若需要开启 HTTPS，请在 `.env` 中配置：

```bash
# HTTPS 开关
CLOUD_HTTPS_ENABLED=true
# 是否强制 HTTP 跳转 HTTPS（/healthz 保持 HTTP 200）
CLOUD_HTTP_REDIRECT_TO_HTTPS=true

# HTTPS 暴露地址
CLOUD_HTTPS_BIND_HOST=0.0.0.0
CLOUD_HTTPS_PORT=443

# 证书挂载与容器内路径
CLOUD_HTTPS_CERTS_DIR=./deploy/nginx/certs
CLOUD_HTTPS_CERT_FILE=/etc/nginx/certs/fullchain.pem
CLOUD_HTTPS_KEY_FILE=/etc/nginx/certs/privkey.pem
```

注意：
- 当 `CLOUD_HTTPS_ENABLED=true` 且证书/私钥文件不存在时，网关会启动失败（fail fast），不会自动降级到 HTTP。
- 自签证书联调时，可在冒烟脚本中设置 `SMOKE_TLS_INSECURE=true`。

## 环境变量

创建 `.env` 文件：

```bash
# 数据库
POSTGRES_DB=agentrade
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_secure_password

# 服务器
JWT_SECRET=your_jwt_secret_key
ADMIN_SERVICE_KEY=your_admin_key
DATABASE_URL=postgresql://postgres:your_secure_password@postgres:5432/agentrade
REDIS_URL=redis://redis:6379
ENABLE_PERSISTENCE=true
ENABLE_REDIS_RATE_LIMIT=true

# Web
WEB_PUBLIC_API_BASE_URL=http://localhost:3000
WEB_INTERNAL_API_BASE_URL=http://server:3000

# Cloud HTTPS (optional)
CLOUD_HTTPS_ENABLED=false
CLOUD_HTTP_REDIRECT_TO_HTTPS=false
CLOUD_HTTPS_BIND_HOST=0.0.0.0
CLOUD_HTTPS_PORT=443
CLOUD_HTTPS_CERTS_DIR=./deploy/nginx/certs
CLOUD_HTTPS_CERT_FILE=/etc/nginx/certs/fullchain.pem
CLOUD_HTTPS_KEY_FILE=/etc/nginx/certs/privkey.pem
```

## 服务说明

- **postgres**: PostgreSQL 16 数据库
- **redis**: Redis 7 缓存
- **server**: API 服务器 (端口 3000)
- **web**: Next.js Web UI (端口 3001)

## 健康检查

```bash
# 检查所有服务状态
docker compose ps

# 查看日志
docker compose logs -f web
docker compose logs -f server
```

## 生产部署建议

1. 修改默认密码和密钥
2. 使用 HTTPS（可直接使用内置网关 HTTPS 开关，或外置 Nginx/Caddy）
3. 配置持久化卷备份
4. 设置资源限制
5. 启用日志收集
