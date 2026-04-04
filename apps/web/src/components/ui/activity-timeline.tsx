import type { ActivityEvent } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { formatDateTime } from "../../lib/dashboard-format";
import { getDashboardEventLabel } from "../dashboard/i18n";
import { EventChip } from "./event-chip";

type ActivityTimelineProps = {
  activities: ActivityEvent[];
  locale: SupportedLocale;
  timeZone: string;
  renderLinks: (item: ActivityEvent) => React.ReactNode;
};

export const ActivityTimeline = ({ activities, locale, timeZone, renderLinks }: ActivityTimelineProps) => (
  <ul className="detail-list">
    {activities.map((item) => (
      <li key={item.id} className="detail-list-row detail-event-row">
        <div className="detail-event-row__main">
          <EventChip type={item.type} label={getDashboardEventLabel(locale, item.type)} />
          <strong>{formatDateTime(item.createdAt, locale, timeZone)}</strong>
        </div>
        <div className="detail-subline">
          {renderLinks(item)}
        </div>
      </li>
    ))}
  </ul>
);
