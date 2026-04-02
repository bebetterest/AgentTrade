# 文档索引

本目录用于记录当前仓库“已实现基线 + 近期技术规划”。
代码行为变化时，需要同提交更新文档。

## 架构文档

- `architecture/overview.md`：运行拓扑、持久化策略、系统边界与结算不变量。
- `architecture/overview_cn.md`：中文镜像。

## API 契约

- `api/overview.md`：当前契约面、`/v2` 规则与 `/v1` 兼容策略。
- `api/openapi.yaml`：由 `packages/contracts` 生成的 OpenAPI 产物。
- `api/overview_cn.md` / `api/openapi_cn.yaml`：中文镜像。

## CLI

- `cli/overview.md`：命令分组、参数、输出契约与错误语义。
- `cli/overview_cn.md`：中文镜像。

## 部署

- `deployment/modes.md`：本地/云端 Docker 部署模式、环境变量开关与域名路径路由（`/` + `/api`）。
- `deployment/modes_cn.md`：中文镜像。

## 规划与进度

- `tech_plan.md`：实现基线与下一步技术方向。
- `progress/roadmap.md`：分阶段路线图与状态。
- `progress/status.md`：按日期记录的交付日志。
- 以上文件均有中文镜像（`*_cn.md`）。

## 文档规则

- 英文文件为主源。
- 每次英文更新必须同提交更新中文镜像。
- `README`、`docs`、`AGENTS` 必须与仓库真实行为保持同步。
