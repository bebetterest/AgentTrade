import { DisputeStatus, type Dispute } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { formatDateTime, shortAddress } from "../../lib/dashboard-format";
import type { LoadErrorKind } from "../../lib/load-error";
import { withRateLimitMessage } from "../../lib/load-error";
import { renderSafeMarkdown } from "../../lib/markdown";
import { getDashboardCopy, getDisputeStatusLabel } from "./i18n";
import { buildStateChipClass } from "./shared";

interface DisputeListPanelProps {
  locale: SupportedLocale;
  timeZone: string;
  disputes: Dispute[];
  disputeStatus: Dispute["status"] | null;
  disputeStatusCounts: Record<string, number>;
  hasDisputeFilters: boolean;
  loadingDisputes: boolean;
  loadingMoreDisputes: boolean;
  disputeLoadError: boolean;
  disputeLoadErrorKind: LoadErrorKind | null;
  nextCursor: string | null;
  disputeSentinelRef: React.RefObject<HTMLDivElement | null>;
  onOpenDisputeDetail: (disputeId: string) => void;
  onSetDisputeStatus: (status: Dispute["status"] | null) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
}

const copy = {
  en: {
    all: "All",
    loadError: "Dispute list failed to load. Retry with refresh.",
    task: "Task",
    opener: "Opener",
    created: "Created",
    emptyFiltered: "No disputes match current filters",
    empty: "No disputes",
    loadMore: "Load more disputes"
  },
  zh: {
    all: "全部",
    loadError: "争议列表加载失败，请刷新重试。",
    task: "任务",
    opener: "发起人",
    created: "创建时间",
    emptyFiltered: "当前筛选条件下没有争议",
    empty: "暂无争议",
    loadMore: "加载更多争议"
  }
} as const;

export const DisputeListPanel = ({
  locale,
  timeZone,
  disputes,
  disputeStatus,
  disputeStatusCounts,
  hasDisputeFilters,
  loadingDisputes,
  loadingMoreDisputes,
  disputeLoadError,
  disputeLoadErrorKind,
  nextCursor,
  disputeSentinelRef,
  onOpenDisputeDetail,
  onSetDisputeStatus,
  onRefresh,
  onLoadMore
}: DisputeListPanelProps) => {
  const t = copy[locale];
  const dashboardCopy = getDashboardCopy(locale);
  const disputeLoadErrorMessage = withRateLimitMessage(locale, t.loadError, disputeLoadErrorKind);
  const statuses = [
    DisputeStatus.OPEN,
    DisputeStatus.RESOLVED_COMPLETED,
    DisputeStatus.RESOLVED_NOT_COMPLETED
  ] as const;

  return (
    <>
      <div className="status-strip">
        <button
          className={`status-pill ${disputeStatus ? "" : "active"}`}
          data-testid="status-pill-all-disputes"
          type="button"
          onClick={() => onSetDisputeStatus(null)}
        >
          {t.all} ({disputes.length})
        </button>
        {statuses.map((status) => (
          <button
            key={status}
            className={`status-pill ${disputeStatus === status ? "active" : ""}`}
            data-testid={`status-pill-${status.toLowerCase()}`}
            type="button"
            onClick={() => onSetDisputeStatus(status)}
          >
            {getDisputeStatusLabel(locale, status)} ({disputeStatusCounts[status] ?? 0})
          </button>
        ))}
      </div>

      {disputeLoadError ? (
        <div className="inline-error" data-testid="disputes-error">
          <p className="empty-line">{disputeLoadErrorMessage}</p>
          <button type="button" className="link-btn" onClick={onRefresh}>
            {dashboardCopy.common.retry}
          </button>
        </div>
      ) : null}
      {loadingDisputes ? <p className="empty-line">{dashboardCopy.common.loading}</p> : null}
      <div className="masonry-grid">
        {disputes.map((dispute) => (
          <article key={dispute.id} className="masonry-card" data-testid="dispute-card">
            <div className="card-kicker">
              <span className={buildStateChipClass(dispute.status)}>{getDisputeStatusLabel(locale, dispute.status)}</span>
              <span className="muted card-id">{dispute.id}</span>
            </div>
            <div className="markdown markdown--compact">{renderSafeMarkdown(dispute.reasonMd)}</div>
            <div className="card-meta">
              <p><strong>{t.task}:</strong> {dispute.taskId}</p>
              <p><strong>{t.opener}:</strong> {shortAddress(dispute.opener)}</p>
              <p><strong>{t.created}:</strong> {formatDateTime(dispute.createdAt, locale, timeZone)}</p>
              <p><strong>{locale === "zh" ? "更新时间" : "Updated"}:</strong> {formatDateTime(dispute.updatedAt, locale, timeZone)}</p>
            </div>
            <div className="card-actions">
              <button type="button" className="link-btn" data-testid="dispute-detail-trigger" onClick={() => onOpenDisputeDetail(dispute.id)}>
                {dashboardCopy.common.details}
              </button>
            </div>
          </article>
        ))}
      </div>
      {disputes.length === 0 && !loadingDisputes ? (
        <p className="empty-line" data-testid="disputes-empty">
          {hasDisputeFilters ? t.emptyFiltered : t.empty}
        </p>
      ) : null}
      <div ref={disputeSentinelRef} className="sentinel" />
      {loadingMoreDisputes ? <p className="empty-line">{dashboardCopy.common.loadingMore}</p> : null}
      {nextCursor && !loadingMoreDisputes ? (
        <button type="button" className="action-btn more-btn" data-testid="load-more-disputes" onClick={onLoadMore}>
          {t.loadMore}
        </button>
      ) : null}
    </>
  );
};
