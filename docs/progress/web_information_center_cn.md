# Web 信息中心构建进度

## 目标

交付只读 Web 信息中心，包含：

- 在 `/` 提供统一单页信息中心，合并叙事层与高密度研究数据模块。
- 首页总览指标（`当日` 与 `本周期` 的任务发布/意向/完成/争议数量）。
- 四个 tab 视图（`Tasks`、`Users`、`Cycles`、`Disputes`），支持瀑布流/列表卡片、无限滚动或 `Load more` 兜底，以及在适用场景下的搜索/筛选/排序。
- 抽屉详情 + 独立详情页联动。
- 周期奖励池/分配/workload 下钻，以及 Agent 余额展示。
- 趋势与榜单模块，以及 economy/health 的公开信任读面。
- URL 状态全量同步。

## 模块跟踪

| 模块 | 范围 | 状态 | 备注 |
| --- | --- | --- | --- |
| M1 | 进度文档初始化 | DONE | 已创建本文件及英文镜像 |
| M2 | 后端事件日志 + 读接口 | DONE | `ActivityEvent` 模型、写路径事件落库、dashboard/activities/agents 路由完成 |
| M3 | 共享类型 + SDK + CLI 对齐 | DONE | shared 契约、SDK 方法、CLI 命令面与测试同步完成 |
| M4 | Web UI 重构与交互 | DONE | 信息中心首页、双 tab、瀑布流、无限滚动、抽屉与详情页完成 |
| M5 | 文档同步与验证 | DONE | API/CLI/文档镜像更新 + lint/test 通过 |

## 第二阶段模块跟踪

| 模块 | 范围 | 状态 | 备注 |
| --- | --- | --- | --- |
| M6 | 上下文信息面板（周期 + 实时事件流） | DONE | 新增 active cycle 健康卡片与全局事件流，并支持深链打开详情 |
| M7 | 筛选体验优化 | DONE | 新增任务状态快捷 pill 筛选与一键重置 |
| M8 | 构建稳定性与回归验证 | DONE | 修复 Next.js App Router 兼容问题并完成 lint/build 复验 |

## 第三阶段模块跟踪

| 模块 | 范围 | 状态 | 备注 |
| --- | --- | --- | --- |
| M9 | 可观测性状态（错误/重试/空态分层） | DONE | 新增 overview/feed/tasks/agents 失败态、重试入口、筛选感知空态与手动加载更多兜底 |
| M10 | Web E2E 自动化（搜索/筛选/排序/详情/分页） | DONE* | 已完成 Playwright 配置与 mock API 用例；当前环境受 Chromium 启动权限限制无法完成完整执行 |

## 第四阶段模块跟踪

| 模块 | 范围 | 状态 | 备注 |
| --- | --- | --- | --- |
| M11 | Web E2E 的 CI 集成 | DONE | 新增 `web-e2e` GitHub Actions 任务，包含浏览器安装、E2E 执行与报告归档 |

## 第五阶段模块跟踪

| 模块 | 范围 | 状态 | 备注 |
| --- | --- | --- | --- |
| M12 | Cycles tab 与周期下钻 | DONE | 新增周期列表 tab、active cycle 深链、抽屉视图与独立详情页 |
| M13 | 更丰富的 task/agent 详情面 | DONE | 任务详情补齐 escrow/slot/dispute；Agent 详情补齐 ledger balance 与扩展统计 |
| M14 | 奖励分配契约对齐 | DONE* | `cycles/{id}/rewards` 现暴露 `rewardPool` + `distributions`；单测与 E2E mock 已更新，但当前环境仍受 Chromium 启动权限限制 |

## 第六阶段模块跟踪

| 模块 | 范围 | 状态 | 备注 |
| --- | --- | --- | --- |
| M15 | 公开首页 + 数据中心分层 | DONE | `/` 重建为叙事型公开首页，旧 dashboard 迁移到 `/center`，旧 `/?tab=...` 分享链接保持兼容跳转 |
| M16 | Disputes tab + 争议详情路由 | DONE | 新增 `Disputes` 一级 tab、状态/排序 query-state、详情抽屉与 `/disputes/[id]` 独立详情页 |
| M17 | 信任模块 + 视觉重构 | DONE | 新增 economy/health 公开读面、sticky 站点导航、统一卡片层级与研究型视觉 token |

## 第七阶段模块跟踪

| 模块 | 范围 | 状态 | 备注 |
| --- | --- | --- | --- |
| M18 | 单页信息中心合并（移除 `/center`） | DONE | 首页与数据中心合并到 `/`，下线 `/center`（404），保留 query 状态语义，并将生命周期模块升级为流程示意图 |

## 第二阶段 API 变更

- 扩展 `GET /v2/cycles/{id}/rewards`，返回 `cycle`、`rewardPool`、`distributions[]` 与 `workloads[]`。
- 为更丰富详情页接入既有读接口：`GET /v2/ledger/{address}`、`GET /v2/cycles`、`GET /v2/cycles/{id}` 与 `GET /v2/disputes/{id}`。
- 未新增写接口。

## 验收清单

- [x] 指标按时区日窗口与活跃周期窗口统计准确。
- [x] `Tasks` tab 支持瀑布流 + 无限滚动 + 搜索/筛选/排序。
- [x] `Users` tab 默认活跃 agent，并支持榜单综合评分排序。
- [x] `Cycles` tab 支持列表分页、active cycle 深链与奖励/workload 下钻。
- [x] `Disputes` tab 支持列表浏览、状态筛选、排序、抽屉详情与可分享的独立详情页。
- [x] 抽屉详情与独立详情页联动，且 URL 可分享/可回退。
- [x] `/` 成为唯一承载 dashboard 的路由，`/center` 已下线。
- [x] Agent 详情展示当前 ledger balance，task 详情展示 escrow/slot/dispute 上下文。
- [x] economy params 与 system health 已作为只读信任模块对外展示。
- [x] Markdown 字段按安全子集渲染。
- [x] SDK 与 CLI 暴露新读接口能力。
- [x] OpenAPI 与中英文文档在同提交同步更新。

## 验证快照

- `npm --prefix apps/server run lint` 通过。
- `npm --prefix apps/server test` 通过（无持久化环境时 repository/persistence 套件保持 skipped）。
- `npm --prefix packages/sdk run lint` 通过。
- `npm --prefix apps/cli run lint` 通过。
- `npm --prefix apps/cli test` 通过。
- `npm --prefix apps/web run lint` 通过。
- `apps/web` 单测通过（`vitest run`）。
- `npm --prefix apps/web run build` 通过（Next.js 15 生产构建）。

## 增量更新日志

- 2026-04-04：完成单页信息中心合并：
  - 将 `/` 升级为唯一 Web 信息中心入口，并移除 `apps/web/src/app/center/page.tsx`（`/center` 现返回 404）。
  - 将首页首屏重构为运行态优先结构，增加页内锚点导航（`#overview`、`#flow`、`#streams`），并在首屏右侧保留压缩 trust 信息。
  - 新增独立生命周期流程示意图组件（`FlowDiagram`），并补充中英文渲染单测。
  - 保留 `/` 下基于 query 的 tab/筛选/详情状态语义，并将内部导流链接统一替换为 `/?...#streams`。
  - 更新 task/agent/cycle/dispute 独立详情页的返回链接与异常提示文案，统一指向“信息中心”而非已下线 `/center`。
  - 更新 Web E2E 用例到单页信息架构，并新增 `/center` 下线路径断言。

- 2026-04-03：完成 Web V2 第二轮打磨：
  - 将 `apps/web/src/components/site-header.tsx` 升级为支持移动端覆盖菜单的导航壳层。
  - 将旧首页的 economy/trust 区重构为更具研究感的规则卡片与信任块，不再只是平铺指标列表。
  - 在 `apps/web/src/components/dashboard/dashboard-view.tsx` 中补齐追踪实体摘要 chip，并让数据中心 trust 卡显式展示 persistence/bridge 状态。
  - 详情抽屉已统一为可 focus-trap 的复用壳层，task/agent 抽屉补齐 full-page 深链，tabs/filter 也已按移动端优先方式重排。
  - 为中心页 tabs 补齐方向键与 Home/End 键盘导航，并增强键盘 focus-visible 反馈。
  - 为 task/agent/cycle/dispute 状态补齐分层色彩的 state chip，同时将首页与争议详情时间线中的原始枚举值替换为更可读的事件/状态标签。
  - 继续将 task、cycle、agent 的状态标签全链路本地化，使卡片、完整页 detail shell 与 task 筛选控件不再直接暴露 `IN_PROGRESS`、`ACTIVE` 这类原始枚举值。
  - 新增可复用的完整页 detail shell，使 `/tasks/[id]`、`/agents/[address]`、`/cycles/[id]`、`/disputes/[id]` 统一为同一套 hero + 摘要结构，不再各自分叉。
  - 抽出 task/agent 详情正文组件，让抽屉视图与独立详情页保持同一套信息层级与行为语义。
  - 扩展 Playwright 覆盖，新增 task/agent/cycle/dispute 独立详情页直达路径检查，使 standalone detail URL 进入 Web 回归面。
  - 为 task/cycle/agent 主路径补齐 Playwright 状态文案断言，确保公开读面展示 `Open`、`In progress`、`Closed`、`Active`、`Idle` 这类可读标签，而不是原始枚举字面量。
  - 新增 locale 持久化端到端路径，覆盖首页切换、`/center` 的 client-state 继承，以及独立详情页通过 locale cookie/localStorage 触发的 SSR 刷新。
  - 为独立详情页补齐 `404` 与 API 失败时的显式状态卡，并继续扩展 Playwright，使 standalone detail page 覆盖成功态、未找到态与加载失败态。
  - 新增中英文 dashboard 状态标签 helper 的单测覆盖，锁定公开读面所使用的术语与共享 copy 源保持一致。
  - 将 `apps/web` 的 lint 流程改为先执行 `next typegen`，避免 route type 校验依赖已有 `.next/types` 产物。
  - 清理剩余中文用户可见文案中的 `Agent`、`Mint`、`workload` 等英文术语混用，并为 detail 读面与数据表中的长 ID、地址、摘要值补齐防溢出换行。
  - 已复验 `npm --prefix apps/web run lint`、`npm --prefix apps/web run test:unit` 与 `npm --prefix apps/web run build`。

- 2026-04-03：完成 Web V2 对外信息面重构：
  - 将旧 dashboard 入口从 `/` 迁移到 `/center`，并将 `/` 重建为叙事型公开信息站。
  - 将 `Disputes` 升级为一级 tab，补齐状态/排序 URL 状态、详情抽屉行为与独立详情页 `apps/web/src/app/disputes/[id]/page.tsx`。
  - 新增 economy params 与 system health 的公开信任模块，并在 `apps/web/src/app/globals.css` 中完成共享 sticky 导航与研究型卡片体系刷新。
  - 新增旧分享链接兼容：`/?tab=...` 会无损重定向到 `/center` 并保留 query-state。
  - 已复验 `npm --prefix apps/web run lint`、`npm --prefix apps/web run test:unit`、`npm --prefix apps/web run build` 与 `npm --prefix apps/server run test`。

- 2026-04-03：完成第二阶段 Web 产品收口：
  - 新增 `Cycles` tab、周期详情抽屉与独立详情页 `apps/web/src/app/cycles/[id]/page.tsx`。
  - 扩展 task 与 agent 详情路由/组件，补齐 escrow/slot/dispute 上下文与当前 ledger balance。
  - 新增 cycle/task/agent 详情渲染测试：`apps/web/src/components/dashboard/detail-panels.test.tsx`。
  - 更新 `apps/web/test/e2e/dashboard.spec.ts` 的 Playwright mock 覆盖 cycles、ledger 与单个 dispute 读取；完整浏览器执行在当前环境下仍受 Chromium 启动权限限制。

- 2026-03-31：补充并验证 dashboard summary/trends、agents/activities 列表行为的 API 集成测试（`apps/server/test/api.spec.ts`）；当前 `api.spec.ts` 结果为 `29` 个测试全部通过。
- 2026-03-31：修复 Next.js 15 构建阻塞问题（详情页与首页路由）：
  - 将以下 app-router 详情页参数签名调整为 Promise 形式 `params`：
    - `apps/web/src/app/tasks/[id]/page.tsx`
    - `apps/web/src/app/agents/[address]/page.tsx`
  - 在 `apps/web/src/app/page.tsx` 中为 dashboard 入口添加 `Suspense`，满足 `useSearchParams` 的 CSR bailout 要求。
- 2026-03-31：完成第二阶段 Web 增强：
  - 在 `apps/web/src/lib/api.ts` 与 `apps/web/src/app/page.tsx` 中新增并接入 active cycle 拉取能力（`fetchActiveCycle`）。
  - 扩展 dashboard：
    - 周期状态卡片（状态/开始时间/运行时长/数据更新时间），
    - 实时事件流（事件标签可视化 + 深链打开），
    - 任务状态快捷 pill 筛选与重置操作。
  - 在 `apps/web/src/app/globals.css` 中补充对应样式体系。
  - 复验结果：`npm --prefix apps/web run lint` 与 `npm --prefix apps/web run build` 均通过。
- 2026-03-31：完成第三阶段增强：
  - 增加首页与列表模块可观测性体验：
    - overview 错误卡片 + 重试，
    - feed 错误态 + 加载态，
    - task/agent 列表错误态 + 筛选感知空态，
    - 保留无限滚动并新增 `Load more` 按钮兜底。
  - 增加稳定化测试钩子（`data-testid`），覆盖 tab/筛选/卡片/抽屉关键节点。
  - 新增 Playwright E2E 体系（`apps/web`）：
    - `apps/web/playwright.config.ts`,
    - `apps/web/test/e2e/dashboard.spec.ts`（3 个核心场景），
    - `apps/web/package.json` 的 e2e 脚本与依赖。
  - 当前机器验证结果：
    - `playwright test --list` 通过（发现用例正常），
    - 完整 `playwright test` 受 Chromium 启动权限限制失败（`mach_port rendezvous permission denied`），非用例逻辑失败。
- 2026-03-31：完成第四阶段 CI 接入：
  - 在 `.github/workflows/ci.yml` 中新增 `web-e2e` job（`needs: quality`）：
    - 通过 `pnpm` 安装依赖，
    - 通过 `playwright install --with-deps chromium` 安装浏览器，
    - 执行 `pnpm --filter @agentrade/web test:e2e`，
    - 每次运行都上传 `apps/web/playwright-report` 与 `apps/web/test-results` 产物。
