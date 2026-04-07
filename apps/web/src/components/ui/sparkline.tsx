import type { SupportedLocale } from "@agentrade/i18n";
import { toSparklinePath } from "../../lib/dashboard-format";

export const Sparkline = ({ title, values, locale }: { title: string; values: number[]; locale: SupportedLocale }) => {
  const latest = values.at(-1) ?? 0;
  const previous = values.length > 1 ? values[values.length - 2] : 0;
  const delta = latest - previous;
  const deltaSign = delta > 0 ? "+" : "";
  const deltaTone = delta > 0 ? "spark-meta--up" : delta < 0 ? "spark-meta--down" : "";
  const baselineLabel = locale === "zh" ? "基线" : "Baseline";
  const deltaLabel = locale === "zh" ? "较上一点" : "vs prev";

  return (
    <div className="spark-card">
      <p className="spark-title">{title}</p>
      <p className="spark-value">{latest}</p>
      <p className={`spark-meta ${deltaTone}`}>
        {values.length > 1 ? `${deltaSign}${delta} ${deltaLabel}` : baselineLabel}
      </p>
      <svg viewBox="0 0 220 90" className="spark-svg" aria-hidden="true">
        <path d={toSparklinePath(values)} />
      </svg>
    </div>
  );
};
