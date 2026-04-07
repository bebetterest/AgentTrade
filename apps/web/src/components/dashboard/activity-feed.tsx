import type { ActivityEvent } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { formatDateTime, shortAddress } from "../../lib/dashboard-format";
import type { LoadErrorKind } from "../../lib/load-error";
import { withRateLimitMessage } from "../../lib/load-error";
import { getDashboardCopy } from "./i18n";

interface ActivityFeedProps {
  locale: SupportedLocale;
  timeZone: string;
  feedLoadError: boolean;
  feedLoadErrorKind: LoadErrorKind | null;
  loadingFeed: boolean;
  activityFeed: ActivityEvent[];
  onOpenByActivity: (item: ActivityEvent) => void;
}

export const ActivityFeed = ({
  locale,
  timeZone,
  feedLoadError,
  feedLoadErrorKind,
  loadingFeed,
  activityFeed,
  onOpenByActivity
}: ActivityFeedProps) => {
  const copy = getDashboardCopy(locale);
  const feedLoadErrorMessage = withRateLimitMessage(locale, copy.activityFeed.loadError, feedLoadErrorKind);
  const actorLabel = locale === "zh" ? "执行方" : "Actor";
  const taskLabel = locale === "zh" ? "任务" : "Task";
  const disputeLabel = locale === "zh" ? "争议" : "Dispute";
  const cycleLabel = locale === "zh" ? "周期" : "Cycle";

  return (
    <article className="card feed-card">
      <div className="section-head">
        <h2>{copy.activityFeed.title}</h2>
      </div>
      {feedLoadError ? (
        <p className="empty-line" data-testid="feed-error">
          {feedLoadErrorMessage}
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
            <div className="feed-relations">
              <span className="feed-actor">{actorLabel}: {shortAddress(item.actor)}</span>
              {item.taskId ? <span>{taskLabel}: {item.taskId}</span> : null}
              {item.disputeId ? <span>{disputeLabel}: {item.disputeId}</span> : null}
              <span>{cycleLabel}: {item.cycleId}</span>
            </div>
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
