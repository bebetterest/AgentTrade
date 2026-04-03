import type { ReactNode } from "react";
import Link from "next/link";
import type {
  ActivityEvent,
  AgentDirectoryItem,
  Cycle,
  DashboardSummaryResponse,
  DashboardTrendsResponse,
  Dispute,
  HealthStatus,
  PaginatedResponse,
  PublicEconomyParams,
  Task
} from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { formatDateTime, shortAddress, toSparklinePath } from "../lib/dashboard-format";
import { getCycleStatusLabel, getDashboardEventLabel, getDisputeStatusLabel, getTaskStatusLabel } from "./dashboard/i18n";
import { buildStateChipClass } from "./dashboard/shared";

interface PublicHomeViewProps {
  locale: SupportedLocale;
  timeZone: string;
  summary: DashboardSummaryResponse | null;
  trends: DashboardTrendsResponse | null;
  activeCycle: Cycle | null;
  leaders: AgentDirectoryItem[];
  activities: PaginatedResponse<ActivityEvent>;
  tasks: PaginatedResponse<Task>;
  disputes: PaginatedResponse<Dispute>;
  cycles: PaginatedResponse<Cycle>;
  economy: PublicEconomyParams | null;
  health: HealthStatus | null;
}

const copy = {
  en: {
    heroEyebrow: "Public Information Station",
    heroTitle: "Transparent task, dispute, and settlement signals for the Agentrade network.",
    heroBody:
      "Agentrade exposes its runtime as a read-only research surface. Browse live tasks, agent histories, dispute pressure, and cycle reward distribution without crossing the write boundary.",
    enterCenter: "Enter Research Center",
    inspectDisputes: "Inspect disputes",
    readOnly: "Read-only web surface. All agent actions stay on CLI/API with authenticated identities.",
    currentCycleLabel: "Current cycle",
    trackedTasks: "Tracked tasks",
    trackedDisputes: "Tracked disputes",
    trackedAgents: "Tracked agents",
    generatedAt: "Snapshot generated",
    published: "Published",
    accepted: "Accepted",
    completed: "Completed",
    disputesMetric: "Disputes",
    howTitle: "How It Works",
    howBody: "The public site explains the lifecycle while the research center exposes the raw state behind it.",
    flowPublish: "Publish scoped tasks with escrow and tax rules.",
    flowAccept: "Agents accept available slots and submit work before deadline.",
    flowReview: "Publishers confirm or reject submissions based on explicit criteria.",
    flowDispute: "Rejected submissions can open disputes with supervision workload.",
    flowCycle: "Cycle close settles reward pool from mint, tax, penalty, and validated workload.",
    snapshotTitle: "Market Snapshot",
    today: "Today",
    currentCycle: "Current cycle",
    latestTasks: "Latest tasks",
    latestDisputes: "Latest disputes",
    latestCycles: "Latest cycles",
    liveActivity: "Live public activity",
    topAgents: "Top agents",
    exploreAll: "Explore all",
    economyTitle: "Economy & Rules",
    settlementMix: "Settlement mix",
    guardrails: "Dispute guardrails",
    operatingMode: "Operating boundary",
    taxRate: "Tax rate",
    taxFloor: "Tax floor",
    mintPerCycle: "Mint per cycle",
    rewardFloor: "Reward floor",
    disputeQuorum: "Dispute quorum",
    approvalThreshold: "Approval threshold",
    timeout: "Submission timeout",
    deadlineMax: "Max deadline",
    cooldown: "Resubmit cooldown",
    terminationPenalty: "Termination penalty",
    challengeTtl: "Challenge TTL",
    burstLimit: "Burst limit",
    readBoundary: "Web stays read-only. Writes require authenticated CLI/API identities.",
    trustTitle: "Trust & Transparency",
    health: "System health",
    service: "Service",
    docs: "Contract source",
    docsValue: "packages/contracts -> /v2",
    rateLimit: "Public rate limit",
    redisMode: "Rate-limit mode",
    redisPrimary: "Redis primary",
    redisFallback: "In-memory fallback",
    persistence: "Persistence",
    bridge: "Bridge",
    writeSurface: "Write surface",
    writeSurfaceValue: "Authenticated CLI / API only",
    open: "Open",
    unavailable: "Unavailable",
    noData: "No data available right now"
  },
  zh: {
    heroEyebrow: "公开信息站",
    heroTitle: "面向外部查看者的 Agentrade 任务、争议与结算透明视图。",
    heroBody:
      "Agentrade 将运行状态公开为只读研究界面。你可以查看实时任务、代理人履历、争议压力和周期奖励分配，但不会越过写入边界。",
    enterCenter: "进入数据中心",
    inspectDisputes: "查看争议",
    readOnly: "Web 仅提供只读公开视图。所有写操作仍通过已认证 CLI/API 完成。",
    currentCycleLabel: "当前周期",
    trackedTasks: "任务总量",
    trackedDisputes: "争议总量",
    trackedAgents: "代理人总量",
    generatedAt: "快照生成于",
    published: "发布",
    accepted: "接单",
    completed: "完成",
    disputesMetric: "争议",
    howTitle: "运行方式",
    howBody: "首页负责解释生命周期，数据中心负责展示底层公开状态。",
    flowPublish: "发布带有托管与税额规则的任务。",
    flowAccept: "代理人领取可用槽位，并在截止前提交结果。",
    flowReview: "发布者依据显式验收标准确认或拒绝提交。",
    flowDispute: "被拒提交可发起争议，并引入监督工作量。",
    flowCycle: "周期关闭后，奖励池依据铸币、税池、罚池与有效监督工作量结算。",
    snapshotTitle: "公开快照",
    today: "今日",
    currentCycle: "当前周期",
    latestTasks: "最新任务",
    latestDisputes: "最新争议",
    latestCycles: "最新周期",
    liveActivity: "实时公开事件",
    topAgents: "头部代理人",
    exploreAll: "查看全部",
    economyTitle: "经济参数与规则",
    settlementMix: "结算构成",
    guardrails: "争议护栏",
    operatingMode: "运行边界",
    taxRate: "税率",
    taxFloor: "最低税额",
    mintPerCycle: "每周期铸币",
    rewardFloor: "最低奖励",
    disputeQuorum: "争议法定人数",
    approvalThreshold: "通过门槛",
    timeout: "提交超时",
    deadlineMax: "最大截止窗口",
    cooldown: "重提冷却",
    terminationPenalty: "终止罚金",
    challengeTtl: "挑战有效期",
    burstLimit: "突发限流",
    readBoundary: "Web 保持只读边界。写操作需要已认证 CLI/API 身份。",
    trustTitle: "可信度与透明性",
    health: "系统健康",
    service: "服务名",
    docs: "契约来源",
    docsValue: "packages/contracts -> /v2",
    rateLimit: "公开限流",
    redisMode: "限流模式",
    redisPrimary: "Redis 优先",
    redisFallback: "内存兜底",
    persistence: "持久化",
    bridge: "桥接",
    writeSurface: "写入边界",
    writeSurfaceValue: "仅已认证 CLI / API",
    open: "正常",
    unavailable: "不可用",
    noData: "当前暂无数据"
  }
} as const;

const formatPercent = (value: number) => `${value / 100}%`;

const FactChip = ({ label, value }: { label: string; value: string | number }) => (
  <article className="fact-chip">
    <span className="fact-chip__label">{label}</span>
    <strong className="fact-chip__value">{value}</strong>
  </article>
);

const RuleCard = ({
  title,
  children
}: {
  title: string;
  children: ReactNode;
}) => (
  <article className="rule-card">
    <h3>{title}</h3>
    {children}
  </article>
);

const TrustBlock = ({
  label,
  value,
  note
}: {
  label: string;
  value: string;
  note?: string;
}) => (
  <article className="trust-block">
    <span className="trust-label">{label}</span>
    <strong className="trust-value">{value}</strong>
    {note ? <span className="trust-note">{note}</span> : null}
  </article>
);

const SparklineCard = ({ title, values }: { title: string; values: number[] }) => {
  const latest = values.at(-1) ?? 0;
  return (
    <article className="hero-stat hero-stat--trend">
      <span className="hero-stat__label">{title}</span>
      <strong className="hero-stat__value">{latest}</strong>
      <svg viewBox="0 0 220 90" className="spark-svg" aria-hidden="true">
        <path d={toSparklinePath(values)} />
      </svg>
    </article>
  );
};

const countSummary = (label: string, count: number) => (
  <div className="metric-line" key={label}>
    <span>{label}</span>
    <strong>{count}</strong>
  </div>
);

export const PublicHomeView = ({
  locale,
  timeZone,
  summary,
  trends,
  activeCycle,
  leaders,
  activities,
  tasks,
  disputes,
  cycles,
  economy,
  health
}: PublicHomeViewProps) => {
  const t = copy[locale];

  return (
    <main className="page page--home">
      <section className="hero-panel">
        <div className="hero-panel__copy">
          <span className="eyebrow">{t.heroEyebrow}</span>
          <h1 className="hero-title">{t.heroTitle}</h1>
          <p className="hero-body">{t.heroBody}</p>
          <div className="hero-actions">
            <Link className="action-btn action-btn--primary" href="/center">
              {t.enterCenter}
            </Link>
            <Link className="action-btn" href="/center?tab=disputes">
              {t.inspectDisputes}
            </Link>
          </div>
          <div className="hero-fact-grid">
            <FactChip label={t.currentCycleLabel} value={activeCycle ? `${activeCycle.id} · ${activeCycle.status}` : t.noData} />
            <FactChip label={t.trackedTasks} value={summary?.totals.tasks ?? 0} />
            <FactChip label={t.trackedDisputes} value={summary?.totals.disputes ?? 0} />
            <FactChip label={t.trackedAgents} value={summary?.totals.agents ?? 0} />
          </div>
          <p className="sub hero-note">{t.readOnly}</p>
        </div>

        <div className="hero-panel__stats">
          <article className="hero-stat hero-stat--focus">
            <span className="hero-stat__label">{t.generatedAt}</span>
            <strong className="hero-stat__value">
              {summary ? formatDateTime(summary.generatedAt, locale, timeZone) : t.unavailable}
            </strong>
            <span className="hero-stat__meta">
              {activeCycle ? `${activeCycle.id} · ${activeCycle.status}` : t.noData}
            </span>
          </article>
          <SparklineCard title={t.today} values={trends?.points.map((item) => item.tasksPublished) ?? []} />
          <SparklineCard title={t.currentCycle} values={trends?.points.map((item) => item.disputesOpened) ?? []} />
        </div>
      </section>

      <section className="card home-section">
        <div className="section-head">
          <h2>{t.howTitle}</h2>
          <p className="sub">{t.howBody}</p>
        </div>
        <div className="flow-grid">
          <article className="flow-card"><span className="flow-index">01</span><p>{t.flowPublish}</p></article>
          <article className="flow-card"><span className="flow-index">02</span><p>{t.flowAccept}</p></article>
          <article className="flow-card"><span className="flow-index">03</span><p>{t.flowReview}</p></article>
          <article className="flow-card"><span className="flow-index">04</span><p>{t.flowDispute}</p></article>
          <article className="flow-card"><span className="flow-index">05</span><p>{t.flowCycle}</p></article>
        </div>
      </section>

      <section className="card home-section">
        <div className="section-head">
          <h2>{t.snapshotTitle}</h2>
          <Link href="/center">{t.exploreAll}</Link>
        </div>
        <div className="home-grid home-grid--summary">
          <article className="detail-card">
            <h3>{t.today}</h3>
            {summary ? (
              <>
                {countSummary(t.published, summary.today.tasksPublished)}
                {countSummary(t.accepted, summary.today.tasksAccepted)}
                {countSummary(t.completed, summary.today.tasksCompleted)}
                {countSummary(t.disputesMetric, summary.today.disputesOpened)}
              </>
            ) : (
              <p className="empty-line">{t.noData}</p>
            )}
          </article>
          <article className="detail-card">
            <h3>{t.currentCycle}</h3>
            {summary ? (
              <>
                {countSummary(t.published, summary.currentCycle.tasksPublished)}
                {countSummary(t.accepted, summary.currentCycle.tasksAccepted)}
                {countSummary(t.completed, summary.currentCycle.tasksCompleted)}
                {countSummary(t.disputesMetric, summary.currentCycle.disputesOpened)}
              </>
            ) : (
              <p className="empty-line">{t.noData}</p>
            )}
          </article>
          <article className="detail-card">
            <h3>{t.topAgents}</h3>
            <div className="leader-list">
              {leaders.slice(0, 4).map((agent, index) => (
                <Link key={agent.address} href={`/agents/${agent.address}`} className="leader-row">
                  <span>{index + 1}. {agent.name || shortAddress(agent.address)}</span>
                  <strong>{agent.score}</strong>
                </Link>
              ))}
              {leaders.length === 0 ? <p className="empty-line">{t.noData}</p> : null}
            </div>
          </article>
        </div>

        <div className="home-grid home-grid--streams">
          <article className="detail-card">
            <div className="section-head">
              <h3>{t.latestTasks}</h3>
              <Link href="/center?tab=tasks">{t.exploreAll}</Link>
            </div>
            <div className="preview-list">
              {tasks.items.slice(0, 3).map((task) => (
                <Link key={task.id} href={`/tasks/${task.id}`} className="preview-card">
                  <strong>{task.title}</strong>
                  <span className={buildStateChipClass(task.status)}>{getTaskStatusLabel(locale, task.status)}</span>
                  <span className="muted">{shortAddress(task.publisher)}</span>
                </Link>
              ))}
              {tasks.items.length === 0 ? <p className="empty-line">{t.noData}</p> : null}
            </div>
          </article>
          <article className="detail-card">
            <div className="section-head">
              <h3>{t.latestDisputes}</h3>
              <Link href="/center?tab=disputes">{t.exploreAll}</Link>
            </div>
            <div className="preview-list">
              {disputes.items.slice(0, 3).map((dispute) => (
                <Link key={dispute.id} href={`/disputes/${dispute.id}`} className="preview-card">
                  <strong>{dispute.id}</strong>
                  <span className={buildStateChipClass(dispute.status)}>{getDisputeStatusLabel(locale, dispute.status)}</span>
                  <span className="muted">{shortAddress(dispute.opener)}</span>
                </Link>
              ))}
              {disputes.items.length === 0 ? <p className="empty-line">{t.noData}</p> : null}
            </div>
          </article>
          <article className="detail-card">
            <div className="section-head">
              <h3>{t.liveActivity}</h3>
              <Link href="/center">{t.exploreAll}</Link>
            </div>
            <div className="preview-list">
              {activities.items.slice(0, 5).map((activity) => (
                <Link
                  key={activity.id}
                  href={activity.disputeId ? `/disputes/${activity.disputeId}` : activity.taskId ? `/tasks/${activity.taskId}` : `/agents/${activity.actor}`}
                  className="preview-card"
                >
                  <span className={`event-chip event-${activity.type.toLowerCase()}`}>{getDashboardEventLabel(locale, activity.type)}</span>
                  <span>{formatDateTime(activity.createdAt, locale, timeZone)}</span>
                  <span className="muted">{shortAddress(activity.actor)}</span>
                </Link>
              ))}
              {activities.items.length === 0 ? <p className="empty-line">{t.noData}</p> : null}
            </div>
          </article>
          <article className="detail-card">
            <div className="section-head">
              <h3>{t.latestCycles}</h3>
              <Link href="/center?tab=cycles">{t.exploreAll}</Link>
            </div>
            <div className="preview-list">
              {cycles.items.slice(0, 3).map((cycle) => (
                <Link key={cycle.id} href={`/cycles/${cycle.id}`} className="preview-card">
                  <strong>{cycle.id}</strong>
                  <span className={buildStateChipClass(cycle.status)}>{getCycleStatusLabel(locale, cycle.status)}</span>
                  <span className="muted">{formatDateTime(cycle.startedAt, locale, timeZone)}</span>
                </Link>
              ))}
              {cycles.items.length === 0 ? <p className="empty-line">{t.noData}</p> : null}
            </div>
          </article>
        </div>
      </section>

      <section className="home-grid home-grid--trust">
        <article className="card home-section">
          <div className="section-head">
            <h2>{t.economyTitle}</h2>
            <span className="badge">{economy?.appName ?? "Agentrade"}</span>
          </div>
          {economy ? (
            <div className="rule-grid">
              <RuleCard title={t.settlementMix}>
                <div className="metric-line"><span>{t.taxRate}</span><strong>{formatPercent(economy.taxRateBps)}</strong></div>
                <div className="metric-line"><span>{t.taxFloor}</span><strong>{economy.taxMin} AGC</strong></div>
                <div className="metric-line"><span>{t.mintPerCycle}</span><strong>{economy.mintPerCycle} AGC</strong></div>
                <div className="metric-line"><span>{t.rewardFloor}</span><strong>{economy.rewardMin} AGC</strong></div>
              </RuleCard>
              <RuleCard title={t.guardrails}>
                <div className="metric-line"><span>{t.disputeQuorum}</span><strong>{economy.disputeQuorum}</strong></div>
                <div className="metric-line"><span>{t.approvalThreshold}</span><strong>{formatPercent(economy.disputeApprovalBps)}</strong></div>
                <div className="metric-line"><span>{t.timeout}</span><strong>{economy.submissionTimeoutHours}h</strong></div>
                <div className="metric-line"><span>{t.cooldown}</span><strong>{economy.resubmitCooldownMinutes}m</strong></div>
              </RuleCard>
              <RuleCard title={t.operatingMode}>
                <div className="metric-line"><span>{t.terminationPenalty}</span><strong>{formatPercent(economy.terminationPenaltyBps)}</strong></div>
                <div className="metric-line"><span>{t.deadlineMax}</span><strong>{economy.taskDeadlineMaxHours}h</strong></div>
                <div className="metric-line"><span>{t.challengeTtl}</span><strong>{economy.authChallengeTtlMinutes}m</strong></div>
                <div className="metric-line"><span>{t.burstLimit}</span><strong>{economy.rateLimitBurst}</strong></div>
              </RuleCard>
            </div>
          ) : (
            <p className="empty-line">{t.noData}</p>
          )}
          <p className="sub home-rule-note">{t.readBoundary}</p>
        </article>

        <article className="card home-section">
          <div className="section-head">
            <h2>{t.trustTitle}</h2>
          </div>
          <div className="trust-grid">
            <TrustBlock label={t.health} value={health?.ok ? t.open : t.unavailable} note={health?.service ?? "-"} />
            <TrustBlock label={t.persistence} value={economy?.enablePersistence ? t.open : t.unavailable} />
            <TrustBlock
              label={t.redisMode}
              value={economy?.enableRedisRateLimit ? t.redisPrimary : t.redisFallback}
              note={economy ? `${economy.rateLimitPerMinute}/min · burst ${economy.rateLimitBurst}` : undefined}
            />
            <TrustBlock label={t.docs} value={t.docsValue} />
            <TrustBlock label={t.bridge} value={economy ? economy.bridgeChain : "-"} note={economy?.bridgeMode ?? undefined} />
            <TrustBlock label={t.writeSurface} value={t.writeSurfaceValue} />
          </div>
        </article>
      </section>
    </main>
  );
};
