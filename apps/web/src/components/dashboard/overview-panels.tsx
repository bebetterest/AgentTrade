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
  onTrendWindowChange: (window: "7d" | "30d") => void;
}

export const OverviewPanels = ({
  locale,
  trendWindow,
  trendPublished,
  trendIntentions,
  trendCompleted,
  trendDisputes,
  onTrendWindowChange
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
          <Sparkline title={copy.overview.published} values={trendPublished} locale={locale} />
          <Sparkline title={copy.overview.intended} values={trendIntentions} locale={locale} />
          <Sparkline title={copy.overview.completed} values={trendCompleted} locale={locale} />
          <Sparkline title={copy.overview.disputes} values={trendDisputes} locale={locale} />
        </div>
      </article>
    </section>
  );
};
