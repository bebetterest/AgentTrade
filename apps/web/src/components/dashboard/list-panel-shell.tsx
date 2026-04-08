import type { ReactNode, RefObject } from "react";

interface ListPanelShellProps {
  loadError: boolean;
  loadErrorMessage: string;
  errorTestId: string;
  onRefresh: () => void;
  retryLabel: string;
  loading: boolean;
  loadingLabel: string;
  itemCount: number;
  emptyTestId: string;
  emptyLabel: string;
  sentinelRef: RefObject<HTMLDivElement | null>;
  loadingMore: boolean;
  loadingMoreLabel: string;
  nextCursor: string | null;
  loadMoreTestId: string;
  loadMoreLabel: string;
  onLoadMore: () => void;
  children: ReactNode;
}

export const ListPanelShell = ({
  loadError,
  loadErrorMessage,
  errorTestId,
  onRefresh,
  retryLabel,
  loading,
  loadingLabel,
  itemCount,
  emptyTestId,
  emptyLabel,
  sentinelRef,
  loadingMore,
  loadingMoreLabel,
  nextCursor,
  loadMoreTestId,
  loadMoreLabel,
  onLoadMore,
  children
}: ListPanelShellProps) => (
  <>
    {loadError ? (
      <div className="inline-error" data-testid={errorTestId}>
        <p className="empty-line">{loadErrorMessage}</p>
        <button type="button" className="link-btn" onClick={onRefresh}>
          {retryLabel}
        </button>
      </div>
    ) : null}
    {loading ? <p className="empty-line">{loadingLabel}</p> : null}
    {children}
    {itemCount === 0 && !loading ? (
      <p className="empty-line" data-testid={emptyTestId}>
        {emptyLabel}
      </p>
    ) : null}
    <div ref={sentinelRef} className="sentinel" />
    {loadingMore ? <p className="empty-line">{loadingMoreLabel}</p> : null}
    {nextCursor && !loadingMore ? (
      <button type="button" className="action-btn more-btn" data-testid={loadMoreTestId} onClick={onLoadMore}>
        {loadMoreLabel}
      </button>
    ) : null}
  </>
);
