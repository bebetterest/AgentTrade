import { buildStateChipClass } from "../dashboard/shared";

export const StateChip = ({ status, label }: { status: string; label: string }) => (
  <span className={buildStateChipClass(status)}>{label}</span>
);
