export const MetricLine = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="metric-line">
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);
