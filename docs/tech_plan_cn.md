# 技术路线（当前基线 + 下一步）

## 1. 已实现基线

### 1.1 后端运行时

- 基于 Fastify 的 API 服务，领域引擎模块覆盖任务、提交、争议、周期，以及面向运维的系统规则/指标操作。
- `packages/contracts` 现已成为对外 `/v2` 契约注册表，并生成 OpenAPI 产物及 server/SDK/CLI/web 共用的 operation 元数据。
- SIWE challenge/verify 认证流程与 JWT 会话签发。
- 严格 EVM 地址校验与 challenge 过期校验。
- 运行时安全加固已补齐：可配置 CORS 白名单（`CORS_ALLOWED_ORIGINS`）、可选受信代理 IP 识别（`TRUST_PROXY`）、Fastify helmet 安全响应头、以及带“容量上限 + 周期清理”的 SIWE challenge 内存存储护栏。
- 通过 `packages/config` 实现集中化配置与输入约束。
- `packages/config` 现已区分内部运行时配置与公开经济/护栏投影，并在 `NODE_ENV=test` 之外拒绝占位密钥。
- `packages/config` 已补充 CLI 与 Web 运行时默认项加载，CLI/Web/Server 运行时环境读取不再分散。
- 关键布尔/数值运行时配置已改为非法值启动即失败，不再静默回退默认值。
- System 接口面新增 bearer 鉴权的指标端点（`GET /v2/system/metrics`），用于输出运维计数与延迟摘要。

### 1.2 持久化与并发一致性

- 基于 Prisma 的 PostgreSQL 规范化仓储持久化。
- 持久化读路径改为仓储表直查（不再每请求全量快照加载/重建）。
- tasks/disputes/activities/agents/dashboard 读接口现已在保持既有 query/cursor 契约的前提下，直接在数据库侧完成过滤、排序、分页与聚合。
- 分页游标已升级为不透明 keyset token（tasks/disputes/activities/agents/cycles），同时保留旧数字 offset 游标输入兼容，降低迁移风险。
- 第四阶段已将全部 API 写操作（`publish`/`accept`/`submit`/`confirm`/`reject`/`terminate`/`openDispute`/`vote`/资料更新/周期结算/争议覆盖）切换为仓储事务直写命令路径（热点路径不再依赖运行时快照重建/重写）。
- 仓储写命令使用显式运行时行锁顺序与确定性事务执行，保障结算/争议并发安全。
- 持久化启动阶段现会强制创建数据库层部分唯一索引（`uq_dispute_open_submission`），确保跨进程并发下同一 submission 始终最多只有一个 `OPEN` 争议。
- 争议发起/重开写路径现将数据库唯一键冲突稳定映射为领域冲突码 `OPEN_DISPUTE_ALREADY_EXISTS`。
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
- 提交模型已扩展为 markdown 正文 + 外部附件元数据（`attachments[]`），并通过集中配置项控制数量/长度/大小上限，且引擎与仓储写路径校验语义一致。
- 争议约束：仅 `REJECTED` submission 可争议；发起者受角色限制；同 submission 仅一个 `OPEN` 争议。
- 监督约束：`(dispute_id, agent_address)` 全局仅一次参与。
- 周期关闭仅结算当期工作量；延迟争议保留投票连续性但不滚动历史工作量。
- 运行时默认启用自动周期推进：按 `cycleDurationHours` 到期自动结算并开启下一周期（请求路径补偿 + 后台定时器双保障）。
- 运行规则现已持久化（`currentRules` + `pendingNextPatch` + 审计轨迹），启动采用 DB 优先，并在换周期时确定性自动应用 pending patch。
- 对外 API/CLI 已移除低价值手工管理员变更入口；结算推进依赖自动换周期与争议法定票数结案语义。
- 已在关键写路径（`publish`、`accept`、`submit`、`rejectSubmission`、`complete`、`openDispute`、`terminate`）持久化 append-only 活动事件流，用于确定性看板统计。

### 1.4 产品界面

- Web：只读统一公开信息中心，支持中英文切换，并通过 `cookie -> Accept-Language`（仅映射 `zh/en`，其余回退 `en`；时区回退 `UTC`）解析 SSR 默认语言/时区；以 `/` 作为唯一入口（`/center` 已下线），覆盖时区感知汇总/趋势、`Tasks` / `Users` / `Cycles` / `Disputes` 四个 tab、可分享的详情路由、周期奖励分配视图、争议详情页、Agent 余额视图，以及公开 economy/health 读面。
- Web dashboard 结构已分层：顶层状态/数据编排与展示渲染分离，且 dashboard 中英文文案已统一收敛到单一字典模块。
- CLI：采用分组子命令覆盖全部已实现路由，成功默认 JSON 输出，失败默认机器可读结构化错误输出。
- CLI 发现面现已新增本地 `agentrade spec` 命令，可在不依赖运行配置的前提下向自动化 agent 暴露机器可读的命令/鉴权/参数/API 路由元数据。
- `agentrade spec` 现也会暴露结构化鉴权满足来源（`authRequirements[]`），bearer/admin 要求无需再通过 prose help 猜测。
- `agentrade spec` 现也会暴露结构化 CLI->request 绑定（`requestBindings[]`），agent 不需要再反向阅读命令实现去推断 flag/file 输入最终落到哪个 `path/query/body` 字段。
- 对单一 API operation 命令，`requestBindings[]` 现还会附带字段级 OpenAPI 校验片段（`required` + `schema`），进一步减少 agent 在组装请求前翻源码或 prose help 的需要。
- 对不能收敛成单个 API 请求的命令，`agentrade spec` 现也会暴露结构化本地/组合执行计划（`executionSteps[]`）以及本地写入/输出副作用（`sideEffects[]`）。
- `executionSteps[]` 现还会携带步骤级输入/输出，而 local/composite 命令会额外暴露 `successFields[]`，让 agent 无需翻源码即可理解中间值流转和最终成功输出。
- 对单一 API operation 命令，`successFields[]` 现会直接由 OpenAPI 响应 schema 派生，并在可用时附带字段级 `required/schema` 元数据，让 agent 在执行前就能看清成功 payload 的具体形状。
- `agentrade spec` 现也会暴露执行安全提示（`automationHints`），让 agent 能判断哪些命令可安全重跑、哪些需要人工决定是否重试，以及重试前/成功后应使用哪些读命令进行状态核验。
- `agentrade spec` 现也会暴露基于稳定 stderr 字段的结构化恢复提示（`failureHints[]`），让 agent 不必抓取 prose 错误指南，就能按确定性的领域/API/网络失败分支执行恢复动作。
- `agentrade spec` 现也会暴露生命周期位置（`workflowHints`），让 agent 无需从 markdown 参考里重新拼装流程图，也能理解角色边界、阶段顺序与更可能的下一步命令。
- `agentrade spec` 现也会暴露实体流转提示（`entityHints`），让 agent 不必反向解析成功 payload，也能在命令之间传递 task/submission/dispute/cycle/auth/config 句柄。
- `agentrade spec` 现也会暴露输出到输入的交接提示（`handoffHints[]`），其中包含可复用的当前输入绑定、固定字面量绑定，以及同时适用于列表项和单结果对象的结构化选择提示（`selectionMode`、`selectionConditions[]`），让 agent 可以把成功字段和当前参数准确映射到下一条命令的 CLI 输入，而不必猜测每个句柄应该填到哪个 flag。
- CLI 的 file-backed 文本/值输入现已共享确定性的 stdin 契约：`-` 表示 UTF-8 stdin，且单次调用中只允许保留一个 stdin-backed 消费者。
- CLI 文档与 skill：已维护命令级参数/错误/执行剧本参考，并保持中英文镜像同步，便于自动化 agent 直接执行。
- CLI 本地护栏已补齐 `tasks create --tz` 的严格 IANA 时区校验（请求发送前拦截）。
- SDK：已改为契约驱动的 request builder + 类型化封装（CLI 统一通过 SDK 发起请求）。
- submission 查询能力已成为一等接口（`GET /v2/submissions`、`GET /v2/submissions/{id}`），并贯通 server/SDK/CLI/web，支持全链路可追溯查询。

### 1.5 质量与工程化

- 服务端具备单元/集成/生命周期链路测试覆盖。
- CLI 测试栈已覆盖契约/集成测试，并补齐持久化模式并发与重启回归套件。
- CLI 快速套件已增加文档/skill 契约漂移检查（命令面镜像与错误契约镜像）及重试/超时行为测试。
- 具备独立的 DB 持久化与压力测试套件。
- CI 包含 `quality`、`persistence`（2 轮重复）与 `stress`（3 轮重复）作业。
- CI 已新增独立 DB 场景 CLI 全量回归作业（`cli-full-regression`，连续 2 轮），用于捕获重复执行下的状态泄漏与抖动问题。
- CI 质量门禁已补充 Web 单测、独立 Web Playwright E2E 门禁（`web-e2e`）与生产依赖安全审计门禁（`security-audit`，high/critical），并新增 local/cloud 两条 Docker smoke 作业覆盖部署链路。
- 本地 DB 门禁已新增严格模式（`check:db:strict`）：若缺失 `TEST_DATABASE_URL` 会启动即失败，避免“全量跳过却误判通过”。
- CI 安全审计现同时覆盖生产依赖与全依赖图（包含开发工具链依赖）。
- 对于受限 macOS 沙箱环境下 Playwright Chromium 启动失败，已明确标注为环境限制；交互正确性仍以 Ubuntu 的 CI `web-e2e` 门禁为准。
- 服务端可观测性基线已补齐：请求结构化日志（`requestId/method/path/status/durationMs/routeId`）与写路径结构化日志（`operation/actor/cycleId/retry/conflict/outcome`），并在进程内聚合指标。
- Docker Compose 现已支持双部署模式：
  - 本地直连端口模式（`localhost web/api`）；
  - 云端单入口模式（网关将 `/` 路由至 web、`/api` 路由至 server，供 API/CLI 使用）。
- Web API 接入已区分“对外 API 基址”与“容器内 SSR 基址”，确保本地/云端路由行为确定。
- 文档基线已升级为“README 统一上手入口 + 配置参考 + 部署 runbook”分层结构，并要求中英文镜像在同一提交同步维护。

## 2. 近期技术方向

- 持续把 `packages/contracts` 作为唯一外部契约源，并加强生成文档、SDK 封装、CLI 绑定与服务端响应之间的漂移门禁。
- 维持 `/v2` 作为唯一公开 API 接口面，并继续加强文档、SDK、CLI 绑定与服务端响应之间的漂移门禁。
- 保持 Web 只读边界，同时继续细化单页 `/` 信息中心、争议/周期/agent 下钻视图，以及对应回归覆盖。
- 增加可观测性基线（请求追踪字段、指标埋点与结构化运维看板）。
- 推进桥接导出能力加固，并补齐 Base Sepolia 对接测试脚手架。

## 3. 决策流程要求

- 选型与实现前必须先完成充分技术调研。
- 关键不确定项必须先与用户完成权衡确认，再做最终决策。
- 决策与进度需持续记录到 `docs/progress/status.md`。
