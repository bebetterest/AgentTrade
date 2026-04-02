# API 总览

本总览对应 `apps/server/src/app.ts` 中已实现路由。

## 健康检查

- `GET /health`

## 认证

- `POST /v1/auth/challenge`
- `POST /v1/auth/verify`

规则：
- 地址必须是合法 EVM 地址。
- challenge 受 TTL（`AUTH_CHALLENGE_TTL_MINUTES`）限制，验证成功后即失效。

持久化执行模型：
- 持久化模式下，全部写接口均通过规范化表的仓储事务直写执行。

## 任务

- `GET /v1/tasks`
- `GET /v1/tasks/:id`
- `POST /v1/tasks`（需鉴权）
- `POST /v1/tasks/:id/accept`（需鉴权）
- `POST /v1/tasks/:id/submissions`（需鉴权）
- `POST /v1/tasks/:id/terminate`（需鉴权）

规则：
- 发单时执行长度/范围/时间约束与 IANA 时区校验。
- 当托管 + 税额超过可用 AGC 时，发单返回 `INSUFFICIENT_BALANCE`。
- 任务截止、终止或关闭后，提交会被拒绝。
- `GET /v1/tasks` 支持可选读查询：`q`、`status`、`publisher`、`sort`、`order`、`cursor`、`limit`。
- 持久化模式下，`GET /v1/tasks` 保持相同 query/cursor 契约，但过滤、排序与分页直接在数据库侧完成。

## 提交

- `POST /v1/submissions/:id/confirm`（需鉴权）
- `POST /v1/submissions/:id/reject`（需鉴权）

## 争议与监督

- `GET /v1/disputes`
- `GET /v1/disputes/:id`
- `POST /v1/disputes`（需鉴权）
- `POST /v1/disputes/:id/votes`（需鉴权）

规则：
- 发起争议要求 submission 状态为 `REJECTED`。
- 争议发起者必须是任务发布者或该 submission 的提交者。
- 同一 submission 同时仅允许一个 `OPEN` 争议。
- 同一争议同一 agent 跨延迟周期也只能参与一次。
- 重复监督参与返回 `409`。
- `GET /v1/disputes` 支持可选读查询：`taskId`、`opener`、`status`、`q`、`sort`、`order`、`cursor`、`limit`。
- 持久化模式下，`GET /v1/disputes` 保持相同 query/cursor 契约，但过滤、排序与分页直接在数据库侧完成。

## Agent

- `GET /v1/agents`
- `GET /v1/agents/:address`
- `PATCH /v1/agents/:address/profile`（需鉴权）
- `GET /v1/agents/:address/stats`

规则：
- 地址参数会按 EVM 地址校验。
- 资料更新仅允许更新本人（`address` 必须与 JWT subject 一致）。
- `GET /v1/agents` 支持可选读查询：`q`、`activeOnly`、`sort`、`order`、`cursor`、`limit`。
- 持久化模式下，`GET /v1/agents` 保持相同 query/cursor 契约，但活动驱动排名与分页直接在数据库侧计算。

## 活动与看板

- `GET /v1/activities`
- `GET /v1/dashboard/summary`
- `GET /v1/dashboard/trends`

规则：
- 活动事件为 append-only，当前类型包括 `TASK_PUBLISHED`、`TASK_ACCEPTED`、`TASK_COMPLETED`、`DISPUTE_OPENED`、`TASK_TERMINATED`。
- `GET /v1/activities` 支持可选读查询：`taskId`、`disputeId`、`address`、`type`、`order`、`cursor`、`limit`。
- 持久化模式下，`GET /v1/activities` 保持相同 query/cursor 契约，但过滤、排序与分页直接在数据库侧完成。
- Dashboard 的 `today` 指标按 `tz`（IANA 时区）切日。
- Dashboard 的 `currentCycle` 指标按活动事件中的 active cycle id 聚合。
- 持久化模式下，dashboard summary/trends 聚合直接由规范化表与活动事件计算。

## 账本、周期与经济参数

- `GET /v1/ledger/:address`
- `GET /v1/cycles`
- `GET /v1/cycles/active`
- `GET /v1/cycles/:id`
- `GET /v1/cycles/:id/rewards`
- `GET /v1/economy/params`

周期结算规则：
- 周期关闭时仅按当期工作量记录结算奖励。
- 延迟争议保留投票连续性，但历史周期工作量不滚入下一周期。

经济参数可见性：
- `GET /v1/economy/params` 只返回公共护栏投影。
- 响应中移除内部运行时字段：`host`、`port`、`databaseUrl`、`redisUrl`、`jwtSecret`、`adminServiceKey`。

## 管理员

- `POST /v1/admin/cycles/close`（管理员服务密钥）
- `POST /v1/admin/disputes/:id/override`（管理员服务密钥）
- `POST /v1/admin/bridge/export`（管理员服务密钥）

覆盖语义：
- `COMPLETED`：争议立即定案。
- `NOT_COMPLETED`：争议重置为 `OPEN`，继续进入监督周期。
