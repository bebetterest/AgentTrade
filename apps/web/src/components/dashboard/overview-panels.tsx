import Link from "next/link";
import type {
  AgentDirectoryItem,
  Cycle,
  DashboardSummaryResponse
} from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { formatDateTime, toSparklinePath } from "../../lib/dashboard-format";

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
  onOpenAgentDetail
}: OverviewPanelsProps) => {
  return (
    <>
      <section className="summary-grid">
        <div className="card metric-card">
          <h2>{locale === "zh" ? "当日统计" : "Today"}</h2>
          <div className="metric-line"><span>{locale === "zh" ? "发布" : "Published"}</span><strong>{summary?.today.tasksPublished ?? 0}</strong></div>
          <div className="metric-line"><span>{locale === "zh" ? "接单" : "Accepted"}</span><strong>{summary?.today.tasksAccepted ?? 0}</strong></div>
          <div className="metric-line"><span>{locale === "zh" ? "完成" : "Completed"}</span><strong>{summary?.today.tasksCompleted ?? 0}</strong></div>
          <div className="metric-line"><span>{locale === "zh" ? "争议" : "Disputes"}</span><strong>{summary?.today.disputesOpened ?? 0}</strong></div>
        </div>
        <div className="card metric-card">
          <h2>{locale === "zh" ? "本周期统计" : "Current Cycle"}</h2>
          <div className="metric-line"><span>{locale === "zh" ? "发布" : "Published"}</span><strong>{summary?.currentCycle.tasksPublished ?? 0}</strong></div>
          <div className="metric-line"><span>{locale === "zh" ? "接单" : "Accepted"}</span><strong>{summary?.currentCycle.tasksAccepted ?? 0}</strong></div>
          <div className="metric-line"><span>{locale === "zh" ? "完成" : "Completed"}</span><strong>{summary?.currentCycle.tasksCompleted ?? 0}</strong></div>
          <div className="metric-line"><span>{locale === "zh" ? "争议" : "Disputes"}</span><strong>{summary?.currentCycle.disputesOpened ?? 0}</strong></div>
        </div>
        <div className="card metric-card">
          <h2>{locale === "zh" ? "总量" : "Totals"}</h2>
          <div className="metric-line"><span>{locale === "zh" ? "任务" : "Tasks"}</span><strong>{summary?.totals.tasks ?? 0}</strong></div>
          <div className="metric-line"><span>{locale === "zh" ? "争议" : "Disputes"}</span><strong>{summary?.totals.disputes ?? 0}</strong></div>
          <div className="metric-line"><span>{locale === "zh" ? "Agent" : "Agents"}</span><strong>{summary?.totals.agents ?? 0}</strong></div>
        </div>
      </section>

      <section className="insight-grid">
        <article className="card cycle-card">
          <div className="section-head">
            <h2>{locale === "zh" ? "周期状态" : "Cycle Status"}</h2>
            <span className="badge">{summary?.activeCycleId ?? activeCycle?.id ?? "-"}</span>
          </div>
          <div className="metric-line">
            <span>{locale === "zh" ? "状态" : "Status"}</span>
            <strong>{activeCycle?.status ?? "-"}</strong>
          </div>
          <div className="metric-line">
            <span>{locale === "zh" ? "开始时间" : "Started At"}</span>
            <strong>{activeCycle ? formatDateTime(activeCycle.startedAt, locale, timeZone) : "-"}</strong>
          </div>
          <div className="metric-line">
            <span>{locale === "zh" ? "运行时长" : "Uptime"}</span>
            <strong>{cycleUptime}</strong>
          </div>
          <div className="metric-line">
            <span>{locale === "zh" ? "数据更新时间" : "Generated At"}</span>
            <strong>{summary ? formatDateTime(summary.generatedAt, locale, timeZone) : "-"}</strong>
          </div>
        </article>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>{locale === "zh" ? "趋势" : "Trend"}</h2>
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
          <Sparkline title={locale === "zh" ? "发布" : "Published"} values={trendPublished} />
          <Sparkline title={locale === "zh" ? "接单" : "Accepted"} values={trendAccepted} />
          <Sparkline title={locale === "zh" ? "完成" : "Completed"} values={trendCompleted} />
          <Sparkline title={locale === "zh" ? "争议" : "Disputes"} values={trendDisputes} />
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>{locale === "zh" ? "Agent 榜单" : "Agent Leaderboard"}</h2>
          <Link href="/?tab=users">{locale === "zh" ? "查看全部" : "See all"}</Link>
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
