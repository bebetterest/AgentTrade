import type {
  Cycle,
  DashboardSummaryResponse,
  HealthStatus,
  PublicEconomyParams
} from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { formatDateTime } from "../../lib/dashboard-format";
import { getCycleStatusLabel, getDashboardCopy } from "./i18n";
import { MetricLine } from "../ui/metric-line";
import { StateChip } from "../ui/state-chip";

interface MetricsPanelsProps {
  locale: SupportedLocale;
  timeZone: string;
  summary: DashboardSummaryResponse | null;
  activeCycle: Cycle | null;
  cycleUptime: string;
  health: HealthStatus | null;
  economy: PublicEconomyParams | null;
  onOpenCycleDetail: (cycleId: string) => void;
}

export const MetricsPanels = ({
  locale,
  timeZone,
  summary,
  activeCycle,
  cycleUptime,
  health,
  economy,
  onOpenCycleDetail
}: MetricsPanelsProps) => {
  const copy = getDashboardCopy(locale);
  const t = locale === "zh"
    ? {
        overall: "系统运行状态",
        allOperational: "所有系统运行正常",
        degraded: "部分组件异常",
        refreshed: "状态更新时间",
        components: "组件状态",
        runtimeSignals: "运行信号",
        runtime: "周期运行",
        api: "Public API",
        web: "Web Read Surface",
        persistence: "Persistence Engine",
        rateLimit: "Rate Limit Guard",
        settlement: "Cycle Settlement",
        supervision: "Dispute Supervision",
        activeTraffic: "活跃流量",
        normal: "正常",
        degradedLabel: "降级",
        inMemory: "内存模式",
        maintenance: "维护中",
        unknown: "未知"
      }
    : {
        overall: "System Status",
        allOperational: "All Systems Operational",
        degraded: "Degraded Performance",
        refreshed: "Status refreshed",
        components: "Components",
        runtimeSignals: "Runtime Signals",
        runtime: "Cycle Runtime",
        api: "Public API",
        web: "Web Read Surface",
        persistence: "Persistence Engine",
        rateLimit: "Rate Limit Guard",
        settlement: "Cycle Settlement",
        supervision: "Dispute Supervision",
        activeTraffic: "Active traffic",
        normal: "Operational",
        degradedLabel: "Degraded",
        inMemory: "In-memory mode",
        maintenance: "Maintenance",
        unknown: "Unknown"
      };

  type ComponentTone = "ACTIVE" | "IDLE" | "TERMINATED";
  const toTone = (ok: boolean): ComponentTone => (ok ? "ACTIVE" : "TERMINATED");
  const overallTone: ComponentTone = !health || !economy
    ? "IDLE"
    : health.ok
      ? "ACTIVE"
      : "TERMINATED";
  const overallLabel = !health || !economy ? t.unknown : health.ok ? t.allOperational : t.degraded;

  const apiTone: ComponentTone = health ? toTone(health.ok) : "IDLE";
  const apiStatus = health ? (health.ok ? t.normal : t.degradedLabel) : t.unknown;

  const persistenceTone: ComponentTone = economy ? toTone(economy.enablePersistence) : "IDLE";
  const persistenceStatus = economy ? (economy.enablePersistence ? t.normal : t.inMemory) : t.unknown;

  const cycleIndicatorId = activeCycle?.id ?? summary?.activeCycleId ?? null;
  const hasCycleIndicator = Boolean(cycleIndicatorId);
  const settlementStatus = activeCycle
    ? getCycleStatusLabel(locale, activeCycle.status)
    : hasCycleIndicator
      ? t.normal
      : summary
        ? t.maintenance
        : t.unknown;
  const runtimeSignalTone: ComponentTone = health ? (health.ok ? "ACTIVE" : "TERMINATED") : "IDLE";
  const runtimeSignalLabel = health ? (health.ok ? t.normal : t.degradedLabel) : t.unknown;

  const components: Array<{
    id: string;
    label: string;
    tone: ComponentTone;
    status: string;
    note: string;
  }> = [
    {
      id: "api",
      label: t.api,
      tone: apiTone,
      status: apiStatus,
      note: health?.service ?? "-"
    },
    {
      id: "web",
      label: t.web,
      tone: "ACTIVE",
      status: t.normal,
      note: copy.page.webReadOnly
    },
    {
      id: "persistence",
      label: t.persistence,
      tone: persistenceTone,
      status: persistenceStatus,
      note: economy ? (economy.enablePersistence ? copy.common.on : copy.common.off) : "-"
    },
    {
      id: "rate",
      label: t.rateLimit,
      tone: economy ? "ACTIVE" : "IDLE",
      status: economy ? t.normal : t.unknown,
      note: economy ? `${economy.rateLimitPerMinute}/min` : "-"
    },
    {
      id: "settlement",
      label: t.settlement,
      tone: hasCycleIndicator ? "ACTIVE" : "IDLE",
      status: settlementStatus,
      note: cycleIndicatorId ?? "-"
    },
    {
      id: "supervision",
      label: t.supervision,
      tone: "ACTIVE",
      status: t.activeTraffic,
      note: `${summary?.today.disputesOpened ?? 0} ${copy.overview.disputes}`
    }
  ];
  const cycleStatusLabel = activeCycle ? getCycleStatusLabel(locale, activeCycle.status) : hasCycleIndicator ? t.normal : "-";
  const healthLabel = health?.ok ? "OK" : "-";
  const rateLabel = economy ? `${economy.rateLimitPerMinute}/min` : "-";
  const todayPublished = summary?.today.tasksPublished ?? 0;
  const todayCompleted = summary?.today.tasksCompleted ?? 0;
  const todayDisputes = summary?.today.disputesOpened ?? 0;
  const totalsTasks = summary?.totals.tasks ?? 0;
  const totalsAgents = summary?.totals.agents ?? 0;
  const totalsDisputes = summary?.totals.disputes ?? 0;

  return (
    <section className="section-panel">
      <article className="card status-hero">
        <div className="section-head">
          <h2>{t.overall}</h2>
          <StateChip status={overallTone} label={overallLabel} />
        </div>
        <p className="sub">
          {t.refreshed}: {summary ? formatDateTime(summary.generatedAt, locale, timeZone) : "-"} · {timeZone}
        </p>
      </article>

      <article className="card">
        <div className="section-head">
          <h2>{t.components}</h2>
          <span className="badge">{components.length}</span>
        </div>
        <ul className="status-components">
          {components.map((component) => (
            <li key={component.id} className="status-component-row">
              <div>
                <strong>{component.label}</strong>
                <p className="sub">{component.note}</p>
              </div>
              <StateChip status={component.tone} label={component.status} />
            </li>
          ))}
        </ul>
      </article>

      <div className="summary-grid metrics-grid">
        <article className="card metric-card status-card">
          <div className="section-head">
            <h2>{t.runtimeSignals}</h2>
            <StateChip status={runtimeSignalTone} label={runtimeSignalLabel} />
          </div>
          <div className="status-kpi-grid">
            <article className="status-kpi status-kpi--accent">
              <span className="status-kpi__label">{copy.overview.today} · {copy.overview.published}</span>
              <strong className="status-kpi__value">{todayPublished}</strong>
            </article>
            <article className="status-kpi">
              <span className="status-kpi__label">{copy.overview.today} · {copy.overview.completed}</span>
              <strong className="status-kpi__value">{todayCompleted}</strong>
            </article>
            <article className="status-kpi">
              <span className="status-kpi__label">{copy.overview.today} · {copy.overview.disputes}</span>
              <strong className="status-kpi__value">{todayDisputes}</strong>
            </article>
          </div>
          <div className="status-meta-stack">
            <MetricLine label={copy.page.centerHealth} value={healthLabel} />
            <MetricLine label={copy.page.centerRateLimit} value={rateLabel} />
            <MetricLine
              label={copy.page.centerUpdated}
              value={summary ? formatDateTime(summary.generatedAt, locale, timeZone) : "-"}
            />
          </div>
          <div className="status-mini-grid">
            <article className="status-mini-item">
              <span className="status-mini-item__label">{copy.overview.totals} · {copy.overview.tasks}</span>
              <strong className="status-mini-item__value">{totalsTasks}</strong>
            </article>
            <article className="status-mini-item">
              <span className="status-mini-item__label">{copy.overview.totals} · {copy.overview.agents}</span>
              <strong className="status-mini-item__value">{totalsAgents}</strong>
            </article>
            <article className="status-mini-item">
              <span className="status-mini-item__label">{copy.overview.totals} · {copy.overview.disputes}</span>
              <strong className="status-mini-item__value">{totalsDisputes}</strong>
            </article>
          </div>
        </article>

        <article className="card cycle-card status-card">
          <div className="section-head">
            <h2>{t.runtime}</h2>
            <span className="badge">{summary?.activeCycleId ?? activeCycle?.id ?? "-"}</span>
          </div>
          <div className="status-kpi-grid status-kpi-grid--cycle">
            <article className="status-kpi status-kpi--accent">
              <span className="status-kpi__label">{copy.overview.status}</span>
              <strong className="status-kpi__value">{cycleStatusLabel}</strong>
            </article>
            <article className="status-kpi">
              <span className="status-kpi__label">{copy.overview.uptime}</span>
              <strong className="status-kpi__value">{cycleUptime}</strong>
            </article>
            <article className="status-kpi">
              <span className="status-kpi__label">{copy.cycleList.mint}</span>
              <strong className="status-kpi__value">{activeCycle ? `${activeCycle.mintedAmount} AGC` : "-"}</strong>
            </article>
            <article className="status-kpi">
              <span className="status-kpi__label">{copy.cycleList.tax}</span>
              <strong className="status-kpi__value">{activeCycle ? `${activeCycle.taxPool} AGC` : "-"}</strong>
            </article>
            <article className="status-kpi">
              <span className="status-kpi__label">{copy.cycleList.penalty}</span>
              <strong className="status-kpi__value">{activeCycle ? `${activeCycle.penaltyPool} AGC` : "-"}</strong>
            </article>
          </div>
          <div className="status-meta-stack">
            <MetricLine
              label={copy.overview.startedAt}
              value={activeCycle ? formatDateTime(activeCycle.startedAt, locale, timeZone) : "-"}
            />
            <MetricLine label={copy.overview.generatedAt} value={summary ? formatDateTime(summary.generatedAt, locale, timeZone) : "-"} />
          </div>
          {activeCycle ? (
            <div className="card-actions status-card__actions">
              <span className="muted">{copy.overview.drillIntoCycle}</span>
              <button type="button" className="link-btn" onClick={() => onOpenCycleDetail(activeCycle.id)}>
                {copy.overview.viewDetails}
              </button>
            </div>
          ) : null}
        </article>
      </div>
    </section>
  );
};
