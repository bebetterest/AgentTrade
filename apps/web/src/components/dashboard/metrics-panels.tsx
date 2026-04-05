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

  return (
    <section className="insight-grid">
      <article className="card metric-card">
        <div className="section-head">
          <h2>{copy.page.sectionMetrics}</h2>
          <span className="badge">{copy.page.platformName}</span>
        </div>
        <MetricLine label={copy.page.centerSource} value={copy.page.platformName} />
        <MetricLine label={copy.page.centerBoundary} value={copy.page.webReadOnly} />
        <MetricLine label={copy.page.centerHealth} value={health?.ok ? "OK" : "-"} />
        <MetricLine label={copy.page.centerRateLimit} value={economy ? `${economy.rateLimitPerMinute}/min` : "-"} />
        <MetricLine label={copy.page.centerPersistence} value={economy?.enablePersistence ? copy.common.on : copy.common.off} />
        <MetricLine
          label={copy.page.centerUpdated}
          value={summary ? formatDateTime(summary.generatedAt, locale, timeZone) : "-"}
        />
        <MetricLine label={`${copy.overview.today} · ${copy.overview.published}`} value={summary?.today.tasksPublished ?? 0} />
        <MetricLine label={`${copy.overview.today} · ${copy.overview.completed}`} value={summary?.today.tasksCompleted ?? 0} />
        <MetricLine label={`${copy.overview.today} · ${copy.overview.disputes}`} value={summary?.today.disputesOpened ?? 0} />
        <MetricLine label={`${copy.overview.totals} · ${copy.overview.tasks}`} value={summary?.totals.tasks ?? 0} />
        <MetricLine label={`${copy.overview.totals} · ${copy.overview.agents}`} value={summary?.totals.agents ?? 0} />
        <MetricLine label={`${copy.overview.totals} · ${copy.overview.disputes}`} value={summary?.totals.disputes ?? 0} />
      </article>

      <article className="card cycle-card">
        <div className="section-head">
          <h2>{copy.overview.cycleStatus}</h2>
          <span className="badge">{summary?.activeCycleId ?? activeCycle?.id ?? "-"}</span>
        </div>
        <MetricLine label={copy.overview.status} value={activeCycle ? getCycleStatusLabel(locale, activeCycle.status) : "-"} />
        <MetricLine label={copy.overview.startedAt} value={activeCycle ? formatDateTime(activeCycle.startedAt, locale, timeZone) : "-"} />
        <MetricLine label={copy.overview.uptime} value={cycleUptime} />
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
  );
};
