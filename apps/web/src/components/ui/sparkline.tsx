import { toSparklinePath } from "../../lib/dashboard-format";

export const Sparkline = ({ title, values }: { title: string; values: number[] }) => {
  const latest = values.at(-1) ?? 0;
  return (
    <div className="spark-card">
      <p className="spark-title">{title}</p>
      <p className="spark-value">{latest}</p>
      <svg viewBox="0 0 220 90" className="spark-svg" aria-hidden="true">
        <path d={toSparklinePath(values)} />
      </svg>
    </div>
  );
};
