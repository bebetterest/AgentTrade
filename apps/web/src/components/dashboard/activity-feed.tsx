import type { ActivityEvent } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { formatDateTime, shortAddress } from "../../lib/dashboard-format";
import { EVENT_LABELS } from "./shared";

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
  return (
    <article className="card feed-card">
      <div className="section-head">
        <h2>{locale === "zh" ? "实时事件流" : "Live Activity"}</h2>
        <button type="button" className="link-btn" onClick={onRefresh} disabled={refreshing}>
          {locale === "zh" ? "刷新" : "Reload"}
        </button>
      </div>
      {feedLoadError ? (
        <p className="empty-line" data-testid="feed-error">
          {locale === "zh" ? "事件流加载失败，请刷新重试。" : "Activity stream failed to load. Refresh to retry."}
        </p>
      ) : null}
      <div className="feed-list">
        {activityFeed.map((item) => (
          <button type="button" key={item.id} className="feed-item" onClick={() => onOpenByActivity(item)}>
            <div className="feed-main">
              <span className={`event-chip event-${item.type.toLowerCase()}`}>
                {EVENT_LABELS[item.type][locale]}
              </span>
              <span className="feed-time">{formatDateTime(item.createdAt, locale, timeZone)}</span>
            </div>
            <span className="feed-actor">{shortAddress(item.actor)}</span>
          </button>
        ))}
        {activityFeed.length === 0 ? (
          <p className="empty-line">
            {loadingFeed ? (locale === "zh" ? "加载中..." : "Loading...") : locale === "zh" ? "暂无事件" : "No activity yet"}
          </p>
        ) : null}
      </div>
    </article>
  );
};
