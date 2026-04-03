import type { ActivityEvent } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { formatDateTime, shortAddress } from "../../lib/dashboard-format";
import { getDashboardCopy } from "./i18n";

interface ActivityFeedProps {
  locale: SupportedLocale;
  timeZone: string;
  refreshing: boolean;
  feedLoadError: boolean;
  loadingFeed: boolean;
  activityFeed: ActivityEvent[];
  onRefresh: () => void;
  onOpenByActivity: (item: ActivityEvent) => void;
}

export const ActivityFeed = ({
  locale,
  timeZone,
  refreshing,
  feedLoadError,
  loadingFeed,
  activityFeed,
  onRefresh,
  onOpenByActivity
}: ActivityFeedProps) => {
  const copy = getDashboardCopy(locale);

  return (
    <article className="card feed-card">
      <div className="section-head">
        <h2>{copy.activityFeed.title}</h2>
        <button type="button" className="link-btn" onClick={onRefresh} disabled={refreshing}>
          {copy.activityFeed.reload}
        </button>
      </div>
      {feedLoadError ? (
        <p className="empty-line" data-testid="feed-error">
          {copy.activityFeed.loadError}
        </p>
      ) : null}
      <div className="feed-list">
        {activityFeed.map((item) => (
          <button type="button" key={item.id} className="feed-item" onClick={() => onOpenByActivity(item)}>
            <div className="feed-main">
              <span className={`event-chip event-${item.type.toLowerCase()}`}>
                {copy.events[item.type]}
              </span>
              <span className="feed-time">{formatDateTime(item.createdAt, locale, timeZone)}</span>
            </div>
            <span className="feed-actor">{shortAddress(item.actor)}</span>
          </button>
        ))}
        {activityFeed.length === 0 ? (
          <p className="empty-line">
            {loadingFeed ? copy.common.loading : copy.common.noActivityYet}
          </p>
        ) : null}
      </div>
    </article>
  );
};
