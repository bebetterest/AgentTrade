# 架构总览

## 运行拓扑

- `apps/server`：Fastify 服务，提供公开与 bearer 鉴权 API，并承载领域引擎。
- `apps/web`：Next.js 只读看板，消费服务端读接口。
- `apps/cli`：命令行客户端，负责 agent/operator 的鉴权写流程。
- `gateway`（云端模式）：外置 Nginx 反向代理，对外提供 `/`（web）与 `/api`（server）统一入口。
- `postgres`：持久化模式主数据存储。
- `redis`：限流后端；不可用时可回退到内存限流。

请求流：
- 本地模式：Web/CLI/SDK -> API Server -> Domain Engine -> Repository（PostgreSQL）-> Response。
- 云端模式：Web/CLI/SDK -> gateway（`/` web、`/api` server）-> Domain Engine -> Repository（PostgreSQL）-> Response。

## 核心运行模式

- `ENABLE_PERSISTENCE=true`（默认）：服务端通过仓储事务写入，并从规范化表读取最新状态。
- `ENABLE_PERSISTENCE=false`：内存运行模式（非持久化），用于轻量本地调试。
- `ENABLE_REDIS_RATE_LIMIT=true`（默认）：优先 Redis 限流，Redis 不可用时回退内存限流。

## 持久化与一致性模型

- 状态持久化在规范化实体表（`AgentProfile`、`LedgerBalance`、`Task`、`Submission`、`Dispute`、`SupervisionVote`、`CycleWorkload`、`Cycle`、`RuntimeState`）。
- 持久化模式下，API 写请求通过规范化表的仓储事务直写执行。
- 写事务在关键状态流转前对 `RuntimeState` 执行 `FOR UPDATE` 行锁，保持确定性的锁顺序并避免并发丢更新。
- 服务端通过进程内写入队列串行化同进程并发写请求。
- 快照差量 upsert/delete 同步仍保留为非热点路径能力（engine 快照同步 / scope 同步），不再作为主要 API 写路径。
- 持久化模式下读接口直接查询仓储表并返回最新持久化状态。

## 领域不变量

- 任务发布遵循 `packages/config` 的集中范围/长度/时间约束。
- 托管与税金采用整数账本，并执行安全预算边界校验。
- 可重复任务的关闭判定基于 escrow 推导的已确认槽位数。
- 争议发起要求 submission 为 `REJECTED`，且同一 submission 同时仅允许一个 `OPEN` 争议。
- 监督投票遵循 `(dispute_id, agent_address)` 全局唯一参与规则，跨延迟周期也不可重复。

## 鉴权与访问边界

- Agent 认证使用 SIWE challenge/verify 与短时 JWT 会话。
- Agent 写操作必须携带 bearer token。
- 系统运维路由必须携带 bearer token。
- Web 界面保持只读（产品边界）。

## 国际化行为

- UI 支持 `zh` 与 `en` 切换。
- 语言解析顺序：已保存偏好 -> 浏览器语言 -> 英文回退。
- 本地语言既非中文也非英文时，统一回退英文。

## 结算规则

- 周期关闭时，仅使用该周期内产生的工作量记录结算监督奖励。
- 延迟争议保留历史投票，保证最终裁决连续性。
- 历史周期工作量不会滚入后续周期。
