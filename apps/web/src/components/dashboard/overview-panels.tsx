import Link from "next/link";
import type {
  AgentDirectoryItem,
  Cycle,
  DashboardSummaryResponse
} from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { formatDateTime } from "../../lib/dashboard-format";
import { getCycleStatusLabel, getDashboardCopy } from "./i18n";
import { Sparkline } from "../ui/sparkline";
import { MetricLine } from "../ui/metric-line";

interface OverviewPanelsProps {
  locale: SupportedLocale;
  timeZone: string;
  summary: DashboardSummaryResponse | null;
  activeCycle: Cycle | null;
  cycleUptime: string;
  trendWindow: "7d" | "30d";
  trendPublished: number[];
  trendAccepted: number[];
  trendCompleted: number[];
  trendDisputes: number[];
  leaders: AgentDirectoryItem[];
  onTrendWindowChange: (window: "7d" | "30d") => void;
  onOpenAgentDetail: (address: string) => void;
  onOpenCycleDetail: (cycleId: string) => void;
}

export const OverviewPanels = ({
  locale,
  timeZone,
  summary,
  activeCycle,
  cycleUptime,
  trendWindow,
  trendPublished,
  trendAccepted,
  trendCompleted,
  trendDisputes,
  leaders,
  onTrendWindowChange,
  onOpenAgentDetail,
  onOpenCycleDetail
}: OverviewPanelsProps) => {
  const copy = getDashboardCopy(locale);

  return (
    <>
      <section className="summary-grid">
        <div className="card metric-card">
          <h2>{copy.overview.today}</h2>
          <MetricLine label={copy.overview.published} value={summary?.today.tasksPublished ?? 0} />
          <MetricLine label={copy.overview.accepted} value={summary?.today.tasksAccepted ?? 0} />
          <MetricLine label={copy.overview.completed} value={summary?.today.tasksCompleted ?? 0} />
          <MetricLine label={copy.overview.disputes} value={summary?.today.disputesOpened ?? 0} />
        </div>
        <div className="card metric-card">
          <h2>{copy.overview.currentCycle}</h2>
          <MetricLine label={copy.overview.published} value={summary?.currentCycle.tasksPublished ?? 0} />
          <MetricLine label={copy.overview.accepted} value={summary?.currentCycle.tasksAccepted ?? 0} />
          <MetricLine label={copy.overview.completed} value={summary?.currentCycle.tasksCompleted ?? 0} />
          <MetricLine label={copy.overview.disputes} value={summary?.currentCycle.disputesOpened ?? 0} />
        </div>
        <div className="card metric-card">
          <h2>{copy.overview.totals}</h2>
          <MetricLine label={copy.overview.tasks} value={summary?.totals.tasks ?? 0} />
          <MetricLine label={copy.overview.disputes} value={summary?.totals.disputes ?? 0} />
          <MetricLine label={copy.overview.agents} value={summary?.totals.agents ?? 0} />
        </div>
      </section>

      <section className="insight-grid">
        <article className="card cycle-card">
          <div className="section-head">
            <h2>{copy.overview.cycleStatus}</h2>
            <span className="badge">{summary?.activeCycleId ?? activeCycle?.id ?? "-"}</span>
          </div>
          <MetricLine label={copy.overview.status} value={activeCycle ? getCycleStatusLabel(locale, activeCycle.status) : "-"} />
          <MetricLine label={copy.overview.startedAt} value={activeCycle ? formatDateTime(activeCycle.startedAt, locale, timeZone) : "-"} />
          <MetricLine label={copy.overview.uptime} value={cycleUptime} />
          <MetricLine label={copy.overview.mintTaxPenalty} value={activeCycle ? `${activeCycle.mintedAmount}/${activeCycle.taxPool}/${activeCycle.penaltyPool}` : "-"} />
          <MetricLine label={copy.overview.generatedAt} value={summary ? formatDateTime(summary.generatedAt, locale, timeZone) : "-"} />
          {activeCycle ? (
            <div className="card-actions">
              <span className="muted">{copy.overview.drillIntoCycle}</span>
              <button type="button" className="link-btn" onClick={() => onOpenCycleDetail(activeCycle.id)}>
                {copy.overview.viewDetails}
              </button>
            </div>
          ) : null}
        </article>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>{copy.overview.trend}</h2>
          <div className="segmented">
            <button
              type="button"
              className={`seg-btn ${trendWindow === "7d" ? "active" : ""}`}
              onClick={() => onTrendWindowChange("7d")}
            >
              7D
            </button>
            <button
              type="button"
              className={`seg-btn ${trendWindow === "30d" ? "active" : ""}`}
              onClick={() => onTrendWindowChange("30d")}
            >
              30D
            </button>
          </div>
        </div>
        <div className="spark-grid">
          <Sparkline title={copy.overview.published} values={trendPublished} />
          <Sparkline title={copy.overview.accepted} values={trendAccepted} />
          <Sparkline title={copy.overview.completed} values={trendCompleted} />
          <Sparkline title={copy.overview.disputes} values={trendDisputes} />
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>{copy.overview.leaderboard}</h2>
          <Link href="/center?tab=users">{copy.overview.seeAll}</Link>
        </div>
        <div className="leader-list">
          {leaders.map((item, index) => (
            <button type="button" key={item.address} className="leader-row" onClick={() => onOpenAgentDetail(item.address)}>
              <span>{index + 1}. {item.name || item.address}</span>
              <strong>{item.score}</strong>
            </button>
          ))}
        </div>
      </section>
    </>
  );
};
