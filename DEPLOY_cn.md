# Docker 部署快速入口

本文档提供快速入口，完整运行手册请查看：

- [docs/deployment/modes_cn.md](./docs/deployment/modes_cn.md)
- [docs/configuration/environment_cn.md](./docs/configuration/environment_cn.md)

## 1. 快速启动

```bash
cp .env.example .env
# 启动前替换 JWT_SECRET 和 ADMIN_SERVICE_KEY
pnpm docker:stack:local:up
```

停止本地栈：

```bash
pnpm docker:stack:local:down
```

## 2. 云端模式

```bash
cp .env.example .env
# 按需配置 CLOUD_* 变量
pnpm docker:stack:cloud:up
```

停止云端栈：

```bash
pnpm docker:stack:cloud:down
```

## 3. 冒烟验证

```bash
pnpm docker:smoke:local
pnpm docker:smoke:cloud
```

仅用于自签证书 HTTPS 联调：

```bash
SMOKE_TLS_INSECURE=true pnpm docker:smoke:cloud
```

## 4. 常见说明

- 在 `NODE_ENV=test` 之外，`JWT_SECRET` 与 `ADMIN_SERVICE_KEY` 不能使用占位默认值。
- 云端 HTTPS 模式下，证书或私钥文件缺失会直接启动失败（fail-fast）。
- 若 shell 开启代理，localhost 探测建议使用 `curl --noproxy '*' ...`。
