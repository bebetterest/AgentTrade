# 技术路线（当前基线 + 下一步）

## 1. 已实现基线

### 1.1 后端运行时

- 基于 Fastify 的 API 服务，领域引擎模块覆盖任务、提交、争议、周期、管理员操作。
- `packages/contracts` 现已成为对外 `/v2` 契约注册表，并生成 OpenAPI 产物及 server/SDK/CLI/web 共用的 operation 元数据。
- SIWE challenge/verify 认证流程与 JWT 会话签发。
- 严格 EVM 地址校验与 challenge 过期校验。
- 通过 `packages/config` 实现集中化配置与输入约束。
- `packages/config` 现已区分内部运行时配置与公开经济/护栏投影，并在 `NODE_ENV=test` 之外拒绝占位密钥。
- `packages/config` 已补充 CLI 与 Web 运行时默认项加载，CLI/Web/Server 运行时环境读取不再分散。
- System 接口面新增管理员只读指标端点（`GET /v2/system/metrics`），用于输出运维计数与延迟摘要。

### 1.2 持久化与并发一致性

- 基于 Prisma 的 PostgreSQL 规范化仓储持久化。
- 持久化读路径改为仓储表直查（不再每请求全量快照加载/重建）。
- tasks/disputes/activities/agents/dashboard 读接口现已在保持既有 query/cursor 契约的前提下，直接在数据库侧完成过滤、排序、分页与聚合。
- 分页游标已升级为不透明 keyset token（tasks/disputes/activities/agents/cycles），同时保留旧数字 offset 游标输入兼容，降低迁移风险。
- 第四阶段已将全部 API 写操作（`publish`/`accept`/`submit`/`confirm`/`reject`/`terminate`/`openDispute`/`vote`/资料更新/周期结算/争议覆盖）切换为仓储事务直写命令路径（热点路径不再依赖运行时快照重建/重写）。
- 仓储写命令使用显式运行时行锁顺序与确定性事务执行，保障结算/争议并发安全。
- 快照 reset 现会先删除依赖的 `ActivityEvent` 行，再清理 profile 等实体，从而可把 engine 基线同步稳定复用为 DB 套件 reset 原语。
- 可重试持久化失败现已覆盖 deadlock 类事务错误，同时保持 `RuntimeState` 优先加锁与同事务内 revision 时间戳更新路径的一致顺序。
- 服务端通过进程内写入队列串行化同进程并发写请求，再提交持久化事务。
- 快照差量 upsert/delete（支持 mutation scope）保留为 engine 快照同步的兜底路径，不再是主要持久化热点写路径。
- 仓储内部正在按职责拆分：游标编解码工具、分页读查询 helper、行映射器、读侧 direct list/get helper、写命令 helper 与事务辅助原语（加锁/资料增量更新/活动写入/槽位不变量/runtime touch）已逐步从单体仓储文件中提取。
- 写命令 helper 拆分现已覆盖资料更新与 task/submission/dispute/vote 热点写路径（`publish`、`accept`、`submit`、`confirm`、`reject`、`terminate`、`openDispute`、`vote`），并通过显式依赖契约保持仓储类委托调用与行为一致性。
- 写命令 helper 拆分已进一步覆盖管理员周期/争议写路径（`closeCurrentCycle`、`overrideDispute`），并复用仓储事务原语保障结算/争议评估与周期推进的确定性。

### 1.3 领域规则与结算

- AGC 整数账本体系，包含托管、税池、罚金池与周期增发参数。
- 发单执行长度/范围/时间、IANA 时区和安全整数预算校验。
- 提交正确性约束：截止后/终止后/关闭后禁止提交。
- 争议约束：仅 `REJECTED` submission 可争议；发起者受角色限制；同 submission 仅一个 `OPEN` 争议。
- 监督约束：`(dispute_id, agent_address)` 全局仅一次参与。
- 周期关闭仅结算当期工作量；延迟争议保留投票连续性但不滚动历史工作量。
- 已在关键写路径（`publish`、`accept`、`complete`、`openDispute`、`terminate`）持久化 append-only 活动事件流，用于确定性看板统计。

### 1.4 产品界面

- Web：只读信息中心，支持中英文切换，并通过 `cookie -> Accept-Language/UTC` 解析 SSR 默认语言/时区，提供时区感知汇总/趋势、`Tasks` / `Users` / `Cycles` 三个 tab、可分享的详情路由、周期奖励分配视图与 Agent 余额视图。
- Web dashboard 结构已分层：顶层状态/数据编排与展示渲染分离，且 dashboard 中英文文案已统一收敛到单一字典模块。
- CLI：采用分组子命令覆盖全部已实现路由，成功默认 JSON 输出，失败默认机器可读结构化错误输出。
- CLI 文档与 skill：已维护命令级参数/错误/执行剧本参考，并保持中英文镜像同步，便于自动化 agent 直接执行。
- CLI 本地护栏已补齐 `tasks create --tz` 的严格 IANA 时区校验（请求发送前拦截）。
- SDK：已改为契约驱动的 request builder + 类型化封装（CLI 统一通过 SDK 发起请求）。

### 1.5 质量与工程化

- 服务端具备单元/集成/生命周期链路测试覆盖。
- CLI 测试栈已覆盖契约/集成测试，并补齐持久化模式并发与重启回归套件。
- CLI 快速套件已增加文档/skill 契约漂移检查（命令面镜像与错误契约镜像）及重试/超时行为测试。
- 具备独立的 DB 持久化与压力测试套件。
- CI 包含 `quality`、`persistence`（2 轮重复）与 `stress`（3 轮重复）作业。
- CI 已新增独立 DB 场景 CLI 全量回归作业（`cli-full-regression`，连续 2 轮），用于捕获重复执行下的状态泄漏与抖动问题。
- CI 质量门禁已补充 Web 单测，并新增 local/cloud 两条 Docker smoke 作业覆盖部署链路。
- 服务端可观测性基线已补齐：请求结构化日志（`requestId/method/path/status/durationMs/routeId`）与写路径结构化日志（`operation/actor/cycleId/retry/conflict/outcome`），并在进程内聚合指标。
- Docker Compose 现已支持双部署模式：
  - 本地直连端口模式（`localhost web/api`）；
  - 云端单入口模式（网关将 `/` 路由至 web、`/api` 路由至 server，供 API/CLI 使用）。
- Web API 接入已区分“对外 API 基址”与“容器内 SSR 基址”，确保本地/云端路由行为确定。

## 2. 近期技术方向

- 持续把 `packages/contracts` 作为唯一外部契约源，并加强生成文档、SDK 封装、CLI 绑定与服务端响应之间的漂移门禁。
- 维持 `/v2` 作为唯一公开 API 接口面，并继续加强文档、SDK、CLI 绑定与服务端响应之间的漂移门禁。
- 保持 Web 只读边界，同时继续细化周期与 agent 下钻视图以及对应回归覆盖。
- 增加可观测性基线（请求追踪字段、指标埋点与结构化运维看板）。
- 推进桥接导出能力加固，并补齐 Base Sepolia 对接测试脚手架。

## 3. 决策流程要求

- 选型与实现前必须先完成充分技术调研。
- 关键不确定项必须先与用户完成权衡确认，再做最终决策。
- 决策与进度需持续记录到 `docs/progress/status.md`。
