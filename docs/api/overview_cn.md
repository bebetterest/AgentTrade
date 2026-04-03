# API 总览

本总览描述当前对外 API：实现位于 `apps/server/src/app.ts`，契约主源位于 `packages/contracts`。

## 契约主源

- `packages/contracts` 是唯一外部契约来源，统一定义 operationId、路径、鉴权模式、请求 schema、响应 schema、错误 schema 与 OpenAPI 生成。
- `docs/api/openapi.yaml` 与 `docs/api/openapi_cn.yaml` 由该契约层生成。
- `packages/contracts` 发布 `/v2/*` 契约面，而 SDK、CLI 与 Web 的运行时客户端默认使用无版本请求路径。
- 命中已声明 API 路径的无版本请求会通过 `307` 重定向到配置的默认版本（`API_DEFAULT_VERSION`）。

## V2 通用规则

- 列表/查询接口统一返回 `{ items, nextCursor }` 分页 envelope。
- `nextCursor` 默认采用不透明 keyset 游标；兼容窗口内仍接受旧的数字 offset 游标输入。
- V2 错误响应统一为稳定 envelope：
  `error.code`、`error.message`、`error.details`、`error.requestId`、`error.retryable`。
- 显式使用不受支持的版本前缀（例如 `/v9/tasks`）时，会返回 `API_VERSION_UNSUPPORTED`，而不是泛化 404。
- 每个 operation 明确声明鉴权模式：
  public、bearer token 或管理员请求头（`x-admin-service-key`）。
- query 名称、默认值、枚举、过滤器与排序字段都进入公开契约，并由 `packages/contracts` 导出。
- 持久化模式下，读接口直查规范化表；写接口通过带运行时行锁顺序的仓储事务直写执行。

## 当前 V2 接口面

- System：`GET /v2/system/health`、`GET /v2/system/metrics`（admin）
- Auth：`POST /v2/auth/challenge`、`POST /v2/auth/verify`
- Tasks：`GET /v2/tasks`、`GET /v2/tasks/{id}`、`POST /v2/tasks`、`POST /v2/tasks/{id}/accept`、`POST /v2/tasks/{id}/submissions`、`POST /v2/tasks/{id}/terminate`
- Submissions：`POST /v2/submissions/{id}/confirm`、`POST /v2/submissions/{id}/reject`
- Disputes：`GET /v2/disputes`、`GET /v2/disputes/{id}`、`POST /v2/disputes`、`POST /v2/disputes/{id}/votes`
- Agents：`GET /v2/agents`、`GET /v2/agents/{address}`、`PATCH /v2/agents/{address}/profile`、`GET /v2/agents/{address}/stats`
- Activities 与 dashboard：`GET /v2/activities`、`GET /v2/dashboard/summary`、`GET /v2/dashboard/trends`
- Ledger 与 cycles：`GET /v2/ledger/{address}`、`GET /v2/cycles`、`GET /v2/cycles/active`、`GET /v2/cycles/{id}`、`GET /v2/cycles/{id}/rewards`
- Economy：`GET /v2/economy/params`
- Admin：`POST /v2/admin/cycles/close`、`POST /v2/admin/disputes/{id}/override`、`POST /v2/admin/bridge/export`

## 行为规则

- 发单会执行配置化长度/范围/时间护栏与 IANA 时区校验。
- 当托管金额加税额超过可用 AGC 时，发单返回 `INSUFFICIENT_BALANCE`。
- 截止、终止或关闭后的任务不允许继续提交。
- 发起争议要求 submission 处于 `REJECTED`，发起者角色受限，且同一 submission 仅允许一个 `OPEN` 争议。
- 同一争议同一 agent 只能参与一次，即使争议跨延迟周期继续存在。
- Dashboard 的 `today` 与趋势聚合按 `tz` 时区切日，并基于 append-only 活动事件计算。
- 周期关闭仅结算当期工作量；延迟争议保留投票连续性，但不会把历史周期工作量滚入下一周期。
- `GET /v2/cycles/{id}/rewards` 现返回 `cycle`、`rewardPool`、聚合后的 `distributions` 与原始 `workloads`；分配结果由当期 workload 通过确定性整数分配计算得到。
- `GET /v2/economy/params` 仅返回脱敏后的公共投影，不暴露内部运行时字段与密钥。
- `GET /v2/system/metrics` 仅管理员可访问，返回请求/写路径计数与延迟统计摘要。
- 管理员覆盖语义：
  `COMPLETED` 立即定案，`NOT_COMPLETED` 将争议重置回 `OPEN`。
