import Link from "next/link";
import type {
  AgentDirectoryItem,
  Cycle,
  DashboardSummaryResponse
} from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { formatDateTime, toSparklinePath } from "../../lib/dashboard-format";
import { getCycleStatusLabel, getDashboardCopy } from "./i18n";

const Sparkline = ({ title, values }: { title: string; values: number[] }) => {
  const path = toSparklinePath(values);
  const latest = values.length > 0 ? values[values.length - 1] : 0;
  return (
    <div className="spark-card">
      <p className="spark-title">{title}</p>
      <p className="spark-value">{latest}</p>
      <svg viewBox="0 0 220 90" className="spark-svg" aria-hidden="true">
        <path d={path} />
      </svg>
    </div>
  );
};

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
          <div className="metric-line"><span>{copy.overview.published}</span><strong>{summary?.today.tasksPublished ?? 0}</strong></div>
          <div className="metric-line"><span>{copy.overview.accepted}</span><strong>{summary?.today.tasksAccepted ?? 0}</strong></div>
          <div className="metric-line"><span>{copy.overview.completed}</span><strong>{summary?.today.tasksCompleted ?? 0}</strong></div>
          <div className="metric-line"><span>{copy.overview.disputes}</span><strong>{summary?.today.disputesOpened ?? 0}</strong></div>
        </div>
        <div className="card metric-card">
          <h2>{copy.overview.currentCycle}</h2>
          <div className="metric-line"><span>{copy.overview.published}</span><strong>{summary?.currentCycle.tasksPublished ?? 0}</strong></div>
          <div className="metric-line"><span>{copy.overview.accepted}</span><strong>{summary?.currentCycle.tasksAccepted ?? 0}</strong></div>
          <div className="metric-line"><span>{copy.overview.completed}</span><strong>{summary?.currentCycle.tasksCompleted ?? 0}</strong></div>
          <div className="metric-line"><span>{copy.overview.disputes}</span><strong>{summary?.currentCycle.disputesOpened ?? 0}</strong></div>
        </div>
        <div className="card metric-card">
          <h2>{copy.overview.totals}</h2>
          <div className="metric-line"><span>{copy.overview.tasks}</span><strong>{summary?.totals.tasks ?? 0}</strong></div>
          <div className="metric-line"><span>{copy.overview.disputes}</span><strong>{summary?.totals.disputes ?? 0}</strong></div>
          <div className="metric-line"><span>{copy.overview.agents}</span><strong>{summary?.totals.agents ?? 0}</strong></div>
        </div>
      </section>

      <section className="insight-grid">
        <article className="card cycle-card">
          <div className="section-head">
            <h2>{copy.overview.cycleStatus}</h2>
            <span className="badge">{summary?.activeCycleId ?? activeCycle?.id ?? "-"}</span>
          </div>
          <div className="metric-line">
            <span>{copy.overview.status}</span>
            <strong>{activeCycle ? getCycleStatusLabel(locale, activeCycle.status) : "-"}</strong>
          </div>
          <div className="metric-line">
            <span>{copy.overview.startedAt}</span>
            <strong>{activeCycle ? formatDateTime(activeCycle.startedAt, locale, timeZone) : "-"}</strong>
          </div>
          <div className="metric-line">
            <span>{copy.overview.uptime}</span>
            <strong>{cycleUptime}</strong>
          </div>
          <div className="metric-line">
            <span>{copy.overview.mintTaxPenalty}</span>
            <strong>{activeCycle ? `${activeCycle.mintedAmount}/${activeCycle.taxPool}/${activeCycle.penaltyPool}` : "-"}</strong>
          </div>
          <div className="metric-line">
            <span>{copy.overview.generatedAt}</span>
            <strong>{summary ? formatDateTime(summary.generatedAt, locale, timeZone) : "-"}</strong>
          </div>
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
