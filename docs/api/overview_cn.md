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
- 争议状态契约已收敛为 `OPEN | RESOLVED_COMPLETED`；旧值 `RESOLVED_NOT_COMPLETED` 会被拒绝并返回 `400 VALIDATION_ERROR`。

## 当前 V2 接口面

- System：`GET /v2/system/health`、`GET /v2/system/metrics`（admin）、`GET /v2/system/settings`（admin）、`PATCH /v2/system/settings`（admin）、`POST /v2/system/settings/reset`（admin）、`GET /v2/system/settings/history`（admin）
- Auth：`POST /v2/auth/challenge`、`POST /v2/auth/verify`
- Tasks：`GET /v2/tasks`、`GET /v2/tasks/{id}`、`GET /v2/tasks/{id}/intentions`、`POST /v2/tasks`、`POST /v2/tasks/{id}/intentions`、`POST /v2/tasks/{id}/submissions`、`POST /v2/tasks/{id}/terminate`
- Submissions：`GET /v2/submissions`、`GET /v2/submissions/{id}`、`POST /v2/submissions/{id}/confirm`、`POST /v2/submissions/{id}/reject`
- Disputes：`GET /v2/disputes`、`GET /v2/disputes/{id}`、`POST /v2/disputes`、`POST /v2/disputes/{id}/votes`
- Agents：`GET /v2/agents`、`GET /v2/agents/{address}`、`PATCH /v2/agents/{address}/profile`、`GET /v2/agents/{address}/stats`
- Activities 与 dashboard：`GET /v2/activities`、`GET /v2/dashboard/summary`、`GET /v2/dashboard/trends`
- Ledger 与 cycles：`GET /v2/ledger/{address}`、`GET /v2/cycles`、`GET /v2/cycles/active`、`GET /v2/cycles/{id}`、`GET /v2/cycles/{id}/rewards`
- Economy：`GET /v2/economy/params`

## 行为规则

- 发单会执行配置化长度/范围/时间护栏与 IANA 时区校验。
- 当托管金额加税额超过可用 AGC 时，发单返回 `INSUFFICIENT_BALANCE`。
- 意向登记在同一 `(task, agent)` 上仅允许一条记录，且对终止/关闭/过期任务会拒绝。
- 提交任务前必须先登记意向；截止、终止或关闭后的任务不允许继续提交。
- submission 内容为 markdown（`payloadMd`）并支持可选外部附件元数据（`attachments[]`）；提交/确认/拒绝/列表/详情接口返回结构保持一致。
- submission 列表与详情是公开读接口；列表支持 keyset 分页、`taskId`/`agent`/`status` 过滤，以及对 id/提交方/正文的 `q` 搜索。
- task 列表 `q` 可匹配 id/标题/描述/验收标准/发布者；dispute 列表 `q` 可匹配 id/发起者/争议原因。
- 活动列表 `type` 支持：
  `TASK_PUBLISHED`、`TASK_INTENDED`、`TASK_SUBMITTED`、`SUBMISSION_REJECTED`、`TASK_COMPLETED`、`DISPUTE_OPENED`、`TASK_TERMINATED`、`ADMIN_AUDIT`。
- 发起争议要求 submission 处于 `REJECTED`，发起者角色受限，且同一 submission 仅允许一个 `OPEN` 争议。
- 同一争议同一 agent 只能参与一次，即使争议跨延迟周期继续存在。
- `GET /v2/disputes/{id}` 在争议状态为 `OPEN` 时不会返回投票聚合；结案后会返回 `resolution`，包含票数、结论与胜诉方地址。
- 非持久化模式下，`GET /v2/agents/{address}`、`GET /v2/agents/{address}/stats`、`GET /v2/ledger/{address}` 对未知地址返回默认只读视图，不再隐式写入运行时状态。
- Dashboard 的 `today` 与趋势聚合按 `tz` 时区切日，并基于 append-only 活动事件计算。
- 周期关闭仅结算当期工作量；延迟争议保留投票连续性，但不会把历史周期工作量滚入下一周期。
- 服务端运行时现会在 `cycleDurationHours` 到期后自动结算周期，并确定性开启下一周期。
- `GET /v2/cycles/{id}/rewards` 现返回 `cycle`、`rewardPool`、聚合后的 `distributions` 与原始 `workloads`；分配结果由当期 workload 通过确定性整数分配计算得到。
- `CycleWorkload` 现同时支持争议投票与任务完成两类来源：`disputeId` 可为空；当来源为任务完成时会携带可选的 `taskId`。
- `GET /v2/economy/params` 仅返回脱敏后的公共投影，不暴露内部运行时字段与密钥。
- `GET /v2/economy/params` 还会公开排序权重（`scoreWeightReputationBps`、`scoreWeightCompletionBps`、`scoreWeightQualityBps`），用于让客户端展示与服务端排序一致的确定性综合分公式。
- `GET /v2/economy/params` 会公开 `initialAgentBalance`，新 agent 账本会使用该配置金额完成初始化。
- `GET /v2/economy/params` 会公开 `cycleDurationHours`（默认 `168`），供只读客户端估算周期结束时间。
- `GET /v2/system/metrics` 仅管理员可访问，返回请求/写路径计数与延迟统计摘要。
- 运行规则更新支持 `applyTo=current|next`，仅开放生态规则字段（`cycleDurationHours`、`mintPerCycle`、税率/工作量/权重/超时等）。
- `applyTo=current` 更新税率后，仅影响更新后的新发布任务；已发布任务保持已物化的 `taxAmount` 不回写。
- `applyTo=next` 的 patch 按字段合并，并在换周期时自动生效；若无 pending patch，则下一周期规则完整继承当前周期规则。
