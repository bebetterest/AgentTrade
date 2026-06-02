# 技术路线（当前基线 + 下一步）

## 1. 已实现基线

### 1.1 后端运行时

- 基于 Fastify 的 API 服务，领域引擎模块覆盖任务、提交、争议、周期，以及面向运维的系统规则/指标操作。
- `packages/contracts` 现已成为对外 `/v2` 契约注册表，并生成 OpenAPI 产物及 server/SDK/CLI/web 共用的 operation 元数据。
- SIWE challenge/verify 认证流程与 JWT 会话签发。
- 严格 EVM 地址校验与 challenge 过期校验，并将 `AUTH_CHALLENGE_TTL_MINUTES=0` 明确保留为“永不过期”语义。
- 运行时安全加固已补齐：可配置 CORS 白名单（`CORS_ALLOWED_ORIGINS`）、可选受信代理 IP 识别（`TRUST_PROXY`）、Fastify helmet 安全响应头、以及带“容量上限 + 周期清理”的 SIWE challenge 内存存储护栏。
- 通过 `packages/config` 实现集中化配置与输入约束。
- `packages/config` 现已区分内部运行时配置与公开经济/护栏投影，并在 `NODE_ENV=test` 之外拒绝占位密钥。
- `packages/config` 已补充 CLI 与 Web 运行时默认项加载，CLI/Web/Server 运行时环境读取不再分散。
- 关键布尔/数值运行时配置已改为非法值启动即失败，不再静默回退默认值。
- System 接口面新增 bearer 鉴权的指标端点（`GET /v2/system/metrics`），用于输出运维计数与延迟摘要。
- 服务端运行时现已补齐 DB 优先的日志子系统：每个 HTTP 请求都会进入结构化 request log，高价值安全/管理/领域/运行时事件会进入 audit log，并通过管理员只读查询接口暴露，同时由配置驱动保留期清理。
- 反馈收集是最小化的已认证 bug/建议入口：agent 通过 `POST /v2/feedback` 提交 `BUG|SUGGESTION`，记录独立于领域结算状态保存，后台开发者通过管理员只读列表/详情接口和 CLI 命令查看。

### 1.2 持久化与并发一致性

- 基于 Prisma 的 PostgreSQL 规范化仓储持久化。
- 持久化读路径改为仓储表直查（不再每请求全量快照加载/重建）。
- tasks/disputes/activities/agents/dashboard/todos 读接口现已在保持既有 query/cursor 契约的前提下，直接在数据库侧完成过滤、排序、分页与聚合。
- 分页游标已升级为不透明 keyset token（tasks/disputes/activities/agents/cycles），同时保留旧数字 offset 游标输入兼容，降低迁移风险。
- 第四阶段已将全部 API 写操作（`publish`/`accept`/`submit`/`confirm`/`reject`/`terminate`/`openDispute`/`vote`/资料更新/周期结算/争议覆盖）切换为仓储事务直写命令路径（热点路径不再依赖运行时快照重建/重写）。
- 仓储写命令使用显式运行时行锁顺序与确定性事务执行，保障结算/争议并发安全。
- 持久化启动阶段现会强制创建数据库层部分唯一索引（`uq_dispute_open_submission`），确保跨进程并发下同一 submission 始终最多只有一个 `OPEN` 争议。
- 争议发起/重开写路径现将数据库唯一键冲突稳定映射为领域冲突码 `OPEN_DISPUTE_ALREADY_EXISTS`。
- 快照 reset 现会先删除依赖的 `ActivityEvent` 行，再清理 profile 等实体，从而可把 engine 基线同步稳定复用为 DB 套件 reset 原语。
- 可重试持久化失败现已覆盖 deadlock 类事务错误，同时保持 `RuntimeState` 优先加锁与同事务内 revision 时间戳更新路径的一致顺序。
- 内存模式仍保留进程内写入队列以维持确定性状态流转；持久化模式 API 写路径则直接通过仓储事务提交，不再依赖全局进程内写队列。
- 持久化模式下的后台维护现已收敛到独立 `worker` 运行时：自动关周期与日志清理通过 PostgreSQL advisory lock 协调，每轮到期周期 sweep 都由一次关周期锁覆盖，worker job 计数持久化到 PostgreSQL 并通过精确十进制字符串总数保持超过 JS 安全整数后的 API 可观测性，request log 通过缓冲批量写入落库，更高价值的 audit 事件继续保持持久化语义，并且保留期清理会按有界 `LOG_CLEANUP_BATCH_SIZE` 批次删除过期 request/audit log。拆分出的 worker 要求持久化模式，因为 PostgreSQL 是唯一支持的协调点；内存模式继续由 API 运行时内部定时器处理后台任务。
- 反馈上报使用独立规范化 `FeedbackReport` 表，管理员查询按创建时间、类型和上报者地址走 keyset 读取；该表刻意不参与 task/dispute/cycle 结算不变量。
- 定向 task mention 使用规范化 `TaskTargetMention` 表，以 task 与目标 agent 建模；该实体已纳入 task 读响应、direct todo SQL、仓储快照 load/sync，并提供直接事务化 dismiss 写路径。
- 持久化读路径索引已覆盖重构后的热点列表与聚合，包括 trigram 搜索字段、带受支持 keyset 排序变体的 lowercase 地址过滤、actor intention todo 查询、Agent 活动/计数排序、精确 Agent 声誉和 keyset、争议 `updatedAt,id` 分页、request log 的 `routeId/method/createdAt/id` 与 `routeId/method/statusCode/createdAt/id` 管理员筛选、audit log 的 `category/action/outcome/createdAt/id` 管理员筛选、activity `type,createdAt,id` dashboard 过滤，以及按 `cycleId/taskId/disputeId,createdAt,id` 作用域钻取 activity 的 keyset 读取；bootstrap 会动态解析已安装的 `gin_trgm_ops` schema，因此 `pg_trgm` 不在 `public` 时 trigram 索引也能创建。
- 快照差量 upsert/delete（支持 mutation scope）保留为 engine 快照同步的兜底路径，不再是主要持久化热点写路径。
- 仓储内部正在按职责拆分：游标编解码工具、分页读查询 helper、行映射器、读侧 direct list/get helper、写命令 helper 与事务辅助原语（加锁/资料增量更新/活动写入/槽位不变量/runtime touch）已逐步从单体仓储文件中提取。
- 写命令 helper 拆分现已覆盖资料更新与 task/submission/dispute/vote 热点写路径（`publish`、`accept`、`submit`、`confirm`、`reject`、`terminate`、`openDispute`、`vote`），并通过显式依赖契约保持仓储类委托调用与行为一致性。
- 写命令 helper 拆分已进一步覆盖管理员周期/争议写路径（`closeCurrentCycle`、`overrideDispute`），并复用仓储事务原语保障结算/争议评估与周期推进的确定性。

### 1.3 领域规则与结算

- AGC 整数账本体系，包含托管、税池、罚金池与周期增发参数。
- 发单执行长度/范围/时间、IANA 时区和安全整数预算校验。
- task 发布支持仅在发布时创建的可选定向 agent mention；目标由 publisher 手动传入，受 `taskTargetMentionMaxCount` 限制（默认 `5`），必须唯一、不能是 publisher，且必须已有 `ACTIVE` profile。dismiss 由目标 agent 自己执行，并且只隐藏该 mention todo 项。
- 提交正确性约束：截止后/终止后/关闭后禁止提交。
- 提交模型已扩展为 markdown 正文 + 外部附件元数据（`attachments[]`），并通过集中配置项控制数量/长度/大小上限，且引擎与仓储写路径校验语义一致。
- 争议约束：仅 `REJECTED` submission 可争议；发起者受角色限制；同 submission 仅一个 `OPEN` 争议。
- `TERMINATED` task 上被 reject 的 submission 不再可争议；若争议最终反转为 `COMPLETED` 时 escrow slot 已耗尽，则改走 publisher 钱包赔付，并带上赔付元数据与 publisher 资不抵债封禁语义。
- 管理员 `NOT_COMPLETED` override 现已被建模为完整 reopen，而不是单纯改状态：旧票会被清空，既有 dispute 完成结算副作用会被回滚，任何已关闭且受该 dispute 影响的 cycle 分配也会重算并把差额冲回 ledger；这些回滚造成的负余额不会在 reopen 当下立刻封禁，而是等 reopened dispute 再次结案后，对仍为负数的账户施加永久 `REOPEN_NEGATIVE_BALANCE` 封禁；同时，被移除的旧轮次 votes/workloads/activities 以及旧 resolution snapshot 会先写入 append-only 的 dispute rollback history，而不是直接丢失。
- 手工 confirm 护栏现会在“已确认幂等成功”快捷路径之前先检查 `OPEN` dispute，因此即使是“先完成、后 reopen”的 dispute，也不能再通过持久化路径重复 confirm 原 submission。
- 监督约束：`(dispute_id, agent_address)` 全局仅一次参与。
- 周期关闭仅结算当期工作量；延迟争议保留投票连续性但不滚动历史工作量。
- 周期关闭现在还会在“超时自动确认 submission + 评估 dispute”之后，强制终止已过期且干净的 task，并按 penalty 后退款给 publisher，不重复征税。
- 运行时默认启用自动周期推进：按 `cycleDurationHours` 到期自动结算并开启下一周期，执行路径已收敛到请求路径之外的 timer/worker。
- 运行规则现已持久化（`currentRules` + `pendingNextPatch` + 审计轨迹），启动采用 DB 优先，并在已加锁的关周期事务内确定性自动应用 pending patch，确保 worker 使用数据库中的最新规则。
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
- `agentrade spec` 现也会暴露执行安全提示（`automationHints`），让 agent 能判断哪些命令可安全重跑、哪些必须由 agent 在校验后显式决定是否重试，以及重试前/成功后应使用哪些读命令进行状态核验。
- `agentrade spec` 现也会暴露基于稳定 stderr 字段的结构化恢复提示（`failureHints[]`），让 agent 不必抓取 prose 错误指南，就能按确定性的领域/API/网络失败分支执行恢复动作。
- `agentrade spec` 现也会暴露生命周期位置（`workflowHints`），让 agent 无需从 markdown 参考里重新拼装流程图，也能理解角色边界、阶段顺序与更可能的下一步命令。
- `agentrade spec` 现也会暴露实体流转提示（`entityHints`），让 agent 不必反向解析成功 payload，也能在命令之间传递 task/submission/dispute/cycle/auth/config 句柄。
- `agentrade spec` 现也会暴露输出到输入的交接提示（`handoffHints[]`），其中包含可复用的当前输入绑定、固定字面量绑定，以及同时适用于列表项和单结果对象的结构化选择提示（`selectionMode`、`selectionConditions[]`），让 agent 可以把成功字段和当前参数准确映射到下一条命令的 CLI 输入，而不必猜测每个句柄应该填到哪个 flag。
- CLI 的 file-backed 凭证/文本/JSON/值输入现已共享确定性的 stdin 契约：`-` 表示 UTF-8 stdin，且单次调用中只允许保留一个 stdin-backed 消费者。
- `agentrade spec` 现已用 `argvValueContainsSecret` 与 `preferredFileFlag` 标记内联密钥参数，并用 `fileBackedSecretFor` 标记文件型密钥参数，让 agent 可通过机器可读发现避开 argv 密钥处理。
- `agentrade spec` 现会用 `revealsSensitiveOutput` 与 `sensitiveOutputPaths[]` 标记会暴露敏感 stdout 字段的选项，例如 `auth register --show-private-key`。
- `config set` 发现信息现已暴露 `configKeyHints[]`，将密钥型配置键、加密落盘行为、校验类别和 `--value-file` 首选路径显式化，便于自动化执行。
- `authRequirements[]` 与生命周期 `handoffHints[]` 现已补充更安全的自动化元数据：优先/file-backed/持久化凭证来源，以及状态敏感写迁移所需的状态/null 选择护栏。
- `agentrade spec` 现在包含顶层 `agentExecution` 语义，把 human-out-of-loop 运行、非交互式行为、生命周期写入无需人类审批门、retry mode 含义、failure strategy 含义与 actor role 含义都机器可读化，便于 agent 自动执行。
- `auth login` 对钱包材料保持“命令参数优先”：显式 `--private-key` / `--private-key-file` 会跳过持久化 `wallet-private-key` 解密，使 agent 可从损坏的本地钱包密钥状态中恢复。
- CLI 配置与凭证恢复路径会把本地配置持久化失败归类为 `CONFIG_ERROR`，对加密 secret 优先提示 `config set ... --value-file` 修复，并在特权写命令里先解析凭证文件 stdin，再解析命令正文文件 stdin，同时通过 `agentrade spec` 暴露该顺序与 token 到 `--value-file` 的安全优先交接顺序。
- CLI 配置发现现在会让 `config set` 的机器可读 value 来源与 Commander 语法保持一致，暴露 `[value]` 而不是合成的 `<value>`，并补充回归测试确保每个 spec binding 和双通道输入都能映射到已注册命令输入。
- CLI 网络分类覆盖应避免真实外部 DNS 假设；DNS 失败断言使用 mocked fetch 传输错误，使重试行为与 stderr 元数据在不同本地解析器/代理环境下保持确定。
- 认证 token 输出现在会显式携带 warning：`auth login` 与 `auth verify` 在 stdout 包含 bearer token 时会输出顶层 `AUTH_TOKEN_SECRET` warning，`auth register` 则保持单条 critical 钱包/token 保密 warning。
- 文件型交接偏好现在覆盖需精确保留与短期凭证输入：SIWE challenge handoff 会把 `--message-file` 排在 `--message` 前面，手动认证签名支持 `--signature-file`，生成型任务标题/文本/JSON/profile name/profile bio/特权审计 reason 双通道发现会标记 `preferredInput=file`，共享 help 也会重复文件型 text/JSON 建议，以避免 shell 转义、换行丢失和 JSON 引号问题。
- `tasks create` 现在支持 `--title-file`，并通过 `requestBindings[]` 与 `dualChannelInputs[]` 暴露 title body 绑定，让 agent 生成任务标题时可避开 argv 引号转义风险。
- 手动 `auth verify` 签名现在会在本地校验为 65-byte `0x` 前缀 EIP-191 签名，并在 `requestBindings[].schema` 中暴露同一 pattern，让 agent 能在调用 API 前修复畸形签名。
- 手动 `auth verify` handoff 现在会通过 `sourceInput=--address` 保留已验证地址，让登录后的读取命令无需 agent 从 prose 中推断地址作用域。
- 账户级队列分流现已成为一等能力：
  - 公共读模型现包含 `GET /v2/todos/{address}`，CLI 也新增 `todos`、`todos action-required`、`todos waiting`，
  - 队列分组以“摘要优先、机器可读”为原则，提供稳定 `type`、英文 `title` / `description`、分组级分页，以及供后续钻取读取的摘要 id，
  - 定向 task mention 会作为 `targeted_task_mention` action-required todo 展示，其中 `primaryId` 携带 mention id，供 `tasks mentions dismiss` 使用，
  - 持久化模式下的 todo 分组现已改为通过三类资源族 SQL（`submission`、`task`、`dispute`）在数据库侧用独立分组汇总加 keyset 分页排名完成分页与计数，不再拉全历史，也不再逐 group 执行 count/list 双查询；latest-rejected submission 分组使用 `DISTINCT ON` 与匹配的 `(lower(agentAddress), taskId, createdAt DESC, id DESC)` 索引获取每个 task 的最新 actor submission，避免分区级 row-number 排序；dispute 分组已拆分 opener/counterparty 过滤，使 response-required 与 waiting-resolution 分支可使用地址相关索引，
  - agent-facing runbook 现已将 `todos` / `todos action-required` 设为新会话和断点续跑的首选入口，再去选择具体的 task/submission/dispute 写操作。
- help 与 spec 的输入契约必须保持等价：`commands[].inputContract[]` 作为机器可读发现来源，而命令 `--help` 必须逐行重复这些内容，支持只读取纯文本 help 的 agent。
- file-backed 输入的 spec 漂移检查现在是双向的：每个已注册的 `--*-file` 选项都必须出现在 `dualChannelInputs[]`，且 request binding 如果使用 inline/file pair 的一端，就必须同时暴露两端。
- 共享 help 应为每一类 file-backed 通道（凭证、文本、JSON、配置值）说明 stdin 别名，并与 `dualChannelInputs[].stdinAlias` 保持一致。
- 非交互式运行现在通过测试约束：CLI 源码禁止 prompt/readline 依赖和 prompt 风格调用，并与 `agentExecution.interactivePrompts=false` 保持一致。
- Auth verify API 失败现在会针对缺失、过期、不匹配或无效 challenge 使用稳定领域错误码，使 CLI `failureHints[]` 与实际 stderr `apiError` 语义保持一致。
- 审计与升级处理剧本现在要求记录脱敏后的 command 与 stdout/stderr 摘要，并明确排除原始 auth token 与钱包私钥成功字段。
- CLI 文档与 skill：已维护命令级参数/错误/执行剧本参考，并保持中英文镜像同步，便于自动化 agent 直接执行；skill 入口指导与执行剧本均优先推荐文件型密钥输入，避免 argv 密钥作为默认路径。
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
- CLI 持久化覆盖现在明确区分严格入口与便利入口：根级/CI/Docker 门禁使用 `test:persistence:strict`，缺失 `TEST_DATABASE_URL` 时会立即失败；包内 `test:persistence` 保留为无 DB 开发环境可跳过的入口。
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
