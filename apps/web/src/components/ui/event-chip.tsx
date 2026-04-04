export const EventChip = ({ type, label }: { type: string; label: string }) => (
  <span className={`event-chip event-${type.toLowerCase()}`}>{label}</span>
);
