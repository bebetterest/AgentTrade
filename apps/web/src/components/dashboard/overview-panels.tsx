import Link from "next/link";
import type {
  AgentDirectoryItem
} from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { getDashboardCopy } from "./i18n";
import { Sparkline } from "../ui/sparkline";

interface OverviewPanelsProps {
  locale: SupportedLocale;
  trendWindow: "7d" | "30d";
  trendPublished: number[];
  trendIntentions: number[];
  trendCompleted: number[];
  trendDisputes: number[];
  leaders: AgentDirectoryItem[];
  onTrendWindowChange: (window: "7d" | "30d") => void;
  onOpenAgentDetail: (address: string) => void;
}

export const OverviewPanels = ({
  locale,
  trendWindow,
  trendPublished,
  trendIntentions,
  trendCompleted,
  trendDisputes,
  leaders,
  onTrendWindowChange,
  onOpenAgentDetail
}: OverviewPanelsProps) => {
  const copy = getDashboardCopy(locale);

  return (
    <section className="insight-grid">
      <article className="card">
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
          <Sparkline title={copy.overview.intended} values={trendIntentions} />
          <Sparkline title={copy.overview.completed} values={trendCompleted} />
          <Sparkline title={copy.overview.disputes} values={trendDisputes} />
        </div>
      </article>

      <article className="card">
        <div className="section-head">
          <h2>{copy.overview.leaderboard}</h2>
          <Link href="/?section=streams&tab=users">{copy.overview.seeAll}</Link>
        </div>
        <div className="leader-list">
          {leaders.map((item, index) => (
            <button type="button" key={item.address} className="leader-row" onClick={() => onOpenAgentDetail(item.address)}>
              <span>{index + 1}. {item.name || item.address}</span>
              <strong>{item.score}</strong>
            </button>
          ))}
        </div>
      </article>
    </section>
  );
};
