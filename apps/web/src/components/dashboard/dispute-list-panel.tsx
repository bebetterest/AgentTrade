import { DisputeStatus, type Dispute } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { formatDateTime, shortAddress } from "../../lib/dashboard-format";
import type { LoadErrorKind } from "../../lib/load-error";
import { withRateLimitMessage } from "../../lib/load-error";
import { renderSafeMarkdown } from "../../lib/markdown";
import { getDashboardCopy, getDisputeStatusLabel } from "./i18n";
import { buildStateChipClass } from "./shared";
import { ListPanelShell } from "./list-panel-shell";

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
    openerReason: "Opener Reason",
    counterpartyReason: "Counterparty Reason",
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
    openerReason: "发起方说明",
    counterpartyReason: "对方说明",
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
    DisputeStatus.RESOLVED_COMPLETED
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

      <ListPanelShell
        loadError={disputeLoadError}
        loadErrorMessage={disputeLoadErrorMessage}
        errorTestId="disputes-error"
        onRefresh={onRefresh}
        retryLabel={dashboardCopy.common.retry}
        loading={loadingDisputes}
        loadingLabel={dashboardCopy.common.loading}
        itemCount={disputes.length}
        emptyTestId="disputes-empty"
        emptyLabel={hasDisputeFilters ? t.emptyFiltered : t.empty}
        sentinelRef={disputeSentinelRef}
        loadingMore={loadingMoreDisputes}
        loadingMoreLabel={dashboardCopy.common.loadingMore}
        nextCursor={nextCursor}
        loadMoreTestId="load-more-disputes"
        loadMoreLabel={t.loadMore}
        onLoadMore={onLoadMore}
      >
        <div className="masonry-grid">
          {disputes.map((dispute) => (
            <article key={dispute.id} className="masonry-card" data-testid="dispute-card">
              <div className="card-kicker">
                <span className={buildStateChipClass(dispute.status)}>{getDisputeStatusLabel(locale, dispute.status)}</span>
                <span className="muted card-id">{dispute.id}</span>
              </div>
              <p><strong>{t.openerReason}:</strong></p>
              <div className="markdown markdown--compact">{renderSafeMarkdown(dispute.reasonMd)}</div>
              {dispute.counterpartyReasonMd ? (
                <>
                  <p><strong>{t.counterpartyReason}:</strong></p>
                  <div className="markdown markdown--compact">{renderSafeMarkdown(dispute.counterpartyReasonMd)}</div>
                </>
              ) : null}
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
      </ListPanelShell>
    </>
  );
};
