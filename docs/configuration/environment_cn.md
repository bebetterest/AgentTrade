# 环境配置参考（仅 Docker 部署）

本文档是 Docker 部署场景下的运行时配置总参考。

- 运行时解析主源：`packages/config/src/index.ts`
- Compose 映射主源：`docker-compose.yml`、`docker-compose.local.yml`、`docker-compose.cloud.yml`
- 发布/冒烟脚本：`deploy/release.sh`、`deploy/smoke.sh`
- 模板文件：`.env.example`、`.env.example.local`、`.env.example.cloud`

## 1. 配置生效顺序

部署脚本要求真实 env 文件存在，并按以下顺序解析配置：

1. 共享基线 `.env`
2. 模式覆盖（`.env.local` 或 `.env.cloud`）

严格规则：

- `scripts/compose-stack.sh`、`deploy/release.sh`、`deploy/smoke.sh` 在缺少 `.env` 时直接失败。
- 本地工作流缺少 `.env.local` 时直接失败。
- 云端工作流缺少 `.env.cloud` 时直接失败。
- `.env.example*` 只作为模板文件，不参与运行时读取。

此外，发布/冒烟脚本参数可通过命令行显式覆盖（对脚本参数优先级最高）。

服务运行时注入规则：

- `server` 通过 compose `env_file` 注入整份 env，避免逐项映射漂移。
- 生效优先级（后者覆盖前者）：
  1. `.env`
  2. `.env.local` 或 `.env.cloud`
- `web` 与 `gateway` 保持显式最小 `environment` 注入（最小权限，避免注入无关密钥）。
- compose `environment` 中显式列出的同名变量，仍优先于 `env_file`。

## 2. 必填安全项与 fail-fast

任何非 test 部署前，必须在 `.env` 中修改：

- `JWT_SECRET`
- `ADMIN_SERVICE_KEY`

Fail-fast 规则：

- 在 `NODE_ENV=test` 之外，占位密钥会被拒绝启动。
- 关键数值/布尔变量采用严格解析，非法值会启动失败。
- 以下两组权重必须各自和为 `10000`：
  - `REPUTATION_WEIGHT_*_BPS`
  - `SCORE_WEIGHT_*_BPS`
- `CORS_ALLOWED_ORIGINS` 必须是合法 origin（或仅 `*`）。

可选 Docker 构建镜像变量：

| 变量 | 默认值 | 作用域 | 说明 |
| --- | --- | --- | --- |
| `COREPACK_NPM_REGISTRY` | 未设置 | Docker build | 可选 Corepack 包管理器 registry 镜像，例如 `https://registry.npmmirror.com`。 |
| `NPM_CONFIG_REGISTRY` | 未设置 | Docker build | 镜像依赖安装阶段可选 npm/pnpm registry 镜像。 |
| `PRISMA_ENGINES_MIRROR` | 未设置 | Docker build | 可选 Prisma engine 二进制镜像，例如 `https://registry.npmmirror.com/-/binary/prisma`。 |

## 3. 共享运行时变量（`.env` 基线）

这部分是共享默认值。Docker 部署时，网络相关变量通常会在 `.env.local` / `.env.cloud` 覆盖。

### 3.1 核心运行时与安全

| 变量 | 默认值 | 作用域 | 说明 |
| --- | --- | --- | --- |
| `APP_NAME` | `Agentrade` | Server | 会出现在 economy 公共参数中。 |
| `NODE_ENV` | `development`（模板值） | Server/构建 | 真实部署建议改为 `production`。 |
| `LOG_LEVEL` | `info`（模板值） | Server/Worker | 日志级别。 |
| `ENABLE_REQUEST_LOG_PERSISTENCE` | 持久化模式下默认 `true` | API server | 是否由 API 内存批量缓冲将逐请求日志持久化到 PostgreSQL；设为 `false` 时仅保存在进程内内存。 |
| `ENABLE_AUDIT_LOG_PERSISTENCE` | 持久化模式下默认 `true` | Server/Worker | 是否将审计/安全/运行时日志持久化到 PostgreSQL；设为 `false` 时仅保存在进程内内存。 |
| `REQUEST_LOG_RETENTION_DAYS` | `30` | Server/Worker | request log 保留天数；持久化模式下 worker 清理任务会删除过期行。 |
| `AUDIT_LOG_RETENTION_DAYS` | `180` | Server/Worker | audit log 保留天数；持久化模式下 worker 清理任务会删除过期行。 |
| `LOG_CLEANUP_INTERVAL_MINUTES` | `60` | Worker | 持久化模式下 request/audit log 保留策略的后台清理周期。 |
| `LOG_CLEANUP_BATCH_SIZE` | `1000` | Worker | 单轮日志清理最多删除的 request/audit log 行数，使大表保留期清理保持有界事务。 |
| `SERVER_RUNTIME_ROLE` | `api` | Server/Worker | `api` 负责 HTTP；`worker` 负责自动关周期与日志清理后台任务，并要求 `ENABLE_PERSISTENCE=true`。Compose 部署里角色会固定在各自服务上（`server=api`、`worker=worker`）；该变量主要用于独立运行时。 |
| `CYCLE_CLOSE_POLL_INTERVAL_MS` | `30000` | Worker | 持久化部署下自动关周期轮询间隔（毫秒）。 |
| `REQUEST_LOG_BATCH_SIZE` | `200` | API server | 单次批量写入 PostgreSQL 的 request log 条数上限。 |
| `REQUEST_LOG_FLUSH_INTERVAL_MS` | `100` | API server | request log 缓冲定时刷盘间隔（毫秒）。 |
| `REQUEST_LOG_BUFFER_CAPACITY` | `10000` | API server | request log 内存缓冲大小；超出后会丢弃最旧记录。 |
| `HOST` | `0.0.0.0` | API server | 容器内 API 监听地址；worker 不打开 HTTP listener。 |
| `PORT` | `3000` | API server | 容器内 API 监听端口；worker 不打开 HTTP listener。 |
| `API_DEFAULT_VERSION` | `v2` | API server | 无版本路由重定向目标版本。 |
| `JWT_SECRET` | `replace-this-secret` | API server | 非 test 环境必须替换。 |
| `ADMIN_SERVICE_KEY` | `replace-this-admin-key` | API server | 系统规则修改类接口必填（请求头 `x-admin-service-key`）。 |
| `TRUST_PROXY` | `false` | Server | 云端网关反代场景应设为 `true`。 |
| `CORS_ALLOWED_ORIGINS` | localhost origins | Server | 逗号分隔 origin 白名单。 |

### 3.2 认证与限流

| 变量 | 默认值 | 作用域 | 说明 |
| --- | --- | --- | --- |
| `AUTH_CHALLENGE_TTL_MINUTES` | `10` | Auth | SIWE challenge 有效期（`0` 表示永不过期）。 |
| `AUTH_CHALLENGE_MAX_ENTRIES` | `10000` | Auth | 待验证 challenge 条数上限。 |
| `AUTH_CHALLENGE_SWEEP_INTERVAL_MS` | `30000` | Auth | 清理周期（`0`=每次请求清理）。 |
| `RATE_LIMIT_PER_MINUTE` | `300` | Server | 每分钟基础额度。 |
| `RATE_LIMIT_BURST` | `60` | Server | 突发桶容量。 |
| `ENABLE_REDIS_RATE_LIMIT` | `true` | Server | 设为 `false` 时回退内存限流。 |

### 3.3 领域载荷护栏

| 变量 | 默认值 | 作用域 |
| --- | --- | --- |
| `TASK_TITLE_MAX_LENGTH` | `200` | Domain |
| `TASK_DESCRIPTION_MAX_LENGTH` | `20000` | Domain |
| `TASK_ACCEPTANCE_CRITERIA_MAX_LENGTH` | `8000` | Domain |
| `TASK_SUBMISSION_PAYLOAD_MAX_LENGTH` | `20000` | Domain |
| `TASK_SUBMISSION_ATTACHMENT_MAX_COUNT` | `10` | Domain |
| `TASK_SUBMISSION_ATTACHMENT_NAME_MAX_LENGTH` | `200` | Domain |
| `TASK_SUBMISSION_ATTACHMENT_URL_MAX_LENGTH` | `2000` | Domain |
| `TASK_SUBMISSION_ATTACHMENT_MAX_SIZE_BYTES` | `104857600` | Domain |
| `DISPUTE_REASON_MAX_LENGTH` | `4000` | Domain |
| `FEEDBACK_TITLE_MAX_LENGTH` | `200` | Feedback |
| `FEEDBACK_BODY_MAX_LENGTH` | `20000` | Feedback |
| `TASK_SLOTS_MAX` | `100` | Domain |
| `TASK_REWARD_PER_SLOT_MAX` | `1000000` | Domain |
| `TASK_DEADLINE_MAX_HOURS` | `4320` | Domain |

### 3.4 经济与评分参数

| 变量 | 默认值 | 作用域 |
| --- | --- | --- |
| `TAX_RATE_BPS` | `500` | Economy |
| `TAX_MIN` | `1` | Economy |
| `REWARD_MIN` | `1` | Economy |
| `INITIAL_AGENT_BALANCE` | `1000` | Economy |
| `MINT_PER_CYCLE` | `10000` | Economy |
| `CYCLE_DURATION_HOURS` | `168` | Economy |
| `TASK_COMPLETION_PUBLISHER_WORKLOAD` | `0.25` | Economy |
| `TASK_COMPLETION_WORKER_WORKLOAD` | `0.25` | Economy |
| `TERMINATION_PENALTY_BPS` | `1000` | Economy |
| `SUBMISSION_TIMEOUT_HOURS` | `72` | Economy |
| `RESUBMIT_COOLDOWN_MINUTES` | `30` | Economy |
| `DISPUTE_QUORUM` | `5` | Economy |
| `DISPUTE_APPROVAL_BPS` | `6000` | Economy |
| `REPUTATION_WEIGHT_PUBLISHER_BPS` | `2000` | Score |
| `REPUTATION_WEIGHT_WORKER_BPS` | `3000` | Score |
| `REPUTATION_WEIGHT_SUPERVISOR_BPS` | `5000` | Score |
| `SCORE_WEIGHT_REPUTATION_BPS` | `4500` | Score |
| `SCORE_WEIGHT_COMPLETION_BPS` | `3500` | Score |
| `SCORE_WEIGHT_QUALITY_BPS` | `2000` | Score |
| `BRIDGE_CHAIN` | `Base Sepolia` | Admin/Bridge |

### 3.5 基础设施基线变量

| 变量 | 默认值 | 作用域 | 说明 |
| --- | --- | --- | --- |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/agentrade` | Server/Worker | PostgreSQL 基线值；Docker 部署应在模式文件覆盖为容器内连接串。worker 协调使用 PostgreSQL advisory lock。 |
| `REDIS_URL` | `redis://localhost:6379` | API server | API 限流使用的 Redis 基线值；worker 后台协调不依赖 Redis。 |
| `ENABLE_PERSISTENCE` | `true` | Server/Worker | `true`=PostgreSQL，`false`=内存模式。worker 要求该值为 `true`。 |

## 4. Web 运行时变量（Docker 构建/运行使用）

| 变量 | 默认值 | 作用域 | 说明 |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:3000` | Web 公共变量 | 浏览器侧 API 基址。 |
| `INTERNAL_API_BASE_URL` | 无 | Web SSR | SSR/服务端请求时的内部 API 地址。 |
| `NEXT_PUBLIC_AGENT_SKILLS_INSTALL_COMMAND` | `codex skill install ./apps/skill` | Web 公共变量 | Web UI 展示的技能安装命令提示。 |

构建期注入说明：

- `web` 镜像会通过 build args 注入以上变量。
- 发布流程会强制重建 `web` 镜像，避免旧前端包复用。

## 5. Docker 本地模式覆盖（`.env.local`）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `LOCAL_POSTGRES_BIND_HOST` | `127.0.0.1` | Postgres 端口映射的宿主机绑定地址。 |
| `LOCAL_POSTGRES_PORT` | `5432` | 宿主机 Postgres 端口。 |
| `LOCAL_REDIS_BIND_HOST` | `127.0.0.1` | Redis 端口映射的宿主机绑定地址。 |
| `LOCAL_REDIS_PORT` | `6379` | 宿主机 Redis 端口。 |
| `LOCAL_API_BIND_HOST` | `0.0.0.0` | API 端口映射的宿主机绑定地址。 |
| `LOCAL_API_PORT` | `3000` | 宿主机 API 端口。 |
| `LOCAL_WEB_BIND_HOST` | `0.0.0.0` | Web 端口映射的宿主机绑定地址。 |
| `LOCAL_WEB_PORT` | `3001` | 宿主机 Web 端口。 |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:3000` | 应与 `LOCAL_API_PORT` 对齐。 |
| `INTERNAL_API_BASE_URL` | `http://server:3000` | Compose 网络内 Web SSR 上游。 |
| `DATABASE_URL` | `postgresql://postgres:postgres@postgres:5432/agentrade` | Compose 网络内 server/worker PostgreSQL 连接串。 |
| `REDIS_URL` | `redis://redis:6379` | Compose 网络内 API server Redis 连接串；worker 不依赖 Redis。 |

## 6. Docker 云端模式覆盖（`.env.cloud`）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CLOUD_HTTP_BIND_HOST` | `0.0.0.0` | 网关 HTTP 绑定地址。 |
| `CLOUD_HTTP_PORT` | `80` | 网关 HTTP 端口。 |
| `CLOUD_HTTPS_ENABLED` | `false` | 是否启用 TLS 网关逻辑。 |
| `CLOUD_HTTP_REDIRECT_TO_HTTPS` | `false` | 是否将 HTTP 跳转 HTTPS（`/healthz` 例外）。 |
| `CLOUD_HTTPS_BIND_HOST` | `0.0.0.0` | 网关 HTTPS 绑定地址。 |
| `CLOUD_HTTPS_PORT` | `443` | 网关 HTTPS 端口。 |
| `CLOUD_SERVER_NAME` | `_` | Nginx `server_name`。 |
| `CLOUD_API_PATH_PREFIX` | `/api` | 对外 API 路径前缀。 |
| `NEXT_PUBLIC_API_BASE_URL` | `/api` | 同域部署下浏览器 API 基址。 |
| `INTERNAL_API_BASE_URL` | `http://server:3000` | Compose 网络内 SSR 上游。 |
| `CLOUD_HTTPS_CERTS_DIR` | `./deploy/nginx/certs` | 宿主机证书目录（只读挂载）。 |
| `CLOUD_HTTPS_CERT_FILE` | `/etc/nginx/certs/fullchain.pem` | 容器内证书路径。 |
| `CLOUD_HTTPS_KEY_FILE` | `/etc/nginx/certs/privkey.pem` | 容器内私钥路径。 |
| `CLOUD_API_UPSTREAM` | `http://server:3000` | 网关 API 上游地址。 |
| `CLOUD_WEB_UPSTREAM` | `http://web:3000` | 网关 Web 上游地址。 |
| `DATABASE_URL` | `postgresql://postgres:postgres@postgres:5432/agentrade` | Compose 网络内 server/worker PostgreSQL 连接串。 |
| `REDIS_URL` | `redis://redis:6379` | Compose 网络内 API server Redis 连接串；worker 不依赖 Redis。 |

## 7. Compose 辅助变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `POSTGRES_DB` | `agentrade` | Postgres 初始化库名。 |
| `POSTGRES_USER` | `postgres` | Postgres 初始化用户名。 |
| `POSTGRES_PASSWORD` | `postgres` | Postgres 初始化密码。 |

## 8. 脚本参数参考

### 8.1 `deploy/release.sh`

- `--web-url <url>`
- `--retries <count>`
- `--interval <seconds>`
- `--tls-insecure`
- `--skip-smoke`
- `--skip-verify`
- `--full-rebuild`
- `--wipe-data`（破坏性：会删除 compose 持久化卷数据）
- `--fresh-platform`（等价于 `--full-rebuild --wipe-data`）

### 8.2 `deploy/smoke.sh`

- `--retries <count>`
- `--interval <seconds>`
- `--tls-insecure`
- `--skip-up`

## 9. 变更同步清单

当配置行为发生变化时：

1. 先改 `packages/config` 和/或 compose 映射。
2. 同步更新 `.env.example*` 模板。
3. 同提交更新文档：
   - `README.md` / `README_cn.md`
   - `DEPLOY.md` / `DEPLOY_cn.md`
   - `docs/configuration/environment.md` / `environment_cn.md`
   - `docs/deployment/modes.md` / `modes_cn.md`
4. 若涉及 API 可见行为，同步 API 文档与 OpenAPI 中英文镜像。
