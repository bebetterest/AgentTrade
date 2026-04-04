import { MetricLine } from "./metric-line";

export const SummaryCard = ({
  title,
  metrics
}: {
  title: string;
  metrics: Array<{ label: string; value: React.ReactNode }>
}) => (
  <article className="detail-card">
    <h3>{title}</h3>
    {metrics.map(m => (
      <MetricLine key={m.label} label={m.label} value={m.value} />
    ))}
  </article>
);
