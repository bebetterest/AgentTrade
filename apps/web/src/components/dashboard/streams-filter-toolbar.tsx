import type { Dispatch, KeyboardEvent, SetStateAction } from "react";
import type { SupportedLocale } from "@agentrade/i18n";
import type { Dispute, Task } from "@agentrade/types";
import type { DashboardTab } from "../../lib/dashboard-query";
import { getDashboardCopy, getTaskStatusLabel } from "./i18n";
import { TASK_STATUS_FILTERS } from "./shared";

interface StreamsFilterToolbarProps {
  locale: SupportedLocale;
  tab: DashboardTab;
  searchDraft: string;
  setSearchDraft: Dispatch<SetStateAction<string>>;
  onCommitSearch: () => void;
  onClearSearch: () => void;
  hasAdvancedFilters: boolean;
  showAdvancedFilters: boolean;
  onToggleAdvancedFilters: () => void;
  taskSort: "latest" | "created" | "deadline" | "reward";
  taskOrder: "asc" | "desc";
  agentSort: "latest" | "score" | "reputation" | "completed" | "published" | "intented";
  agentOrder: "asc" | "desc";
  disputeStatus: Dispute["status"] | null;
  disputeSort: "latest" | "created";
  disputeOrder: "asc" | "desc";
  activeOnly: boolean;
  taskStatus: Task["status"] | null;
  onUpdateQuery: (patch: Record<string, string | null>) => void;
  onResetFilters: () => void;
}

export const StreamsFilterToolbar = ({
  locale,
  tab,
  searchDraft,
  setSearchDraft,
  onCommitSearch,
  onClearSearch,
  hasAdvancedFilters,
  showAdvancedFilters,
  onToggleAdvancedFilters,
  taskSort,
  taskOrder,
  agentSort,
  agentOrder,
  disputeStatus,
  disputeSort,
  disputeOrder,
  activeOnly,
  taskStatus,
  onUpdateQuery,
  onResetFilters
}: StreamsFilterToolbarProps) => {
  const copy = getDashboardCopy(locale);
  const sortOrderValue = tab === "tasks" ? taskOrder : tab === "users" ? agentOrder : disputeOrder;

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onCommitSearch();
    }
  };

  return (
    <div className="filter-toolbar">
      <div className="filter-row filter-row--search">
        <label className="sr-only" htmlFor="dashboard-search-input">
          {copy.page.search}
        </label>
        <input
          id="dashboard-search-input"
          data-testid="search-input"
          value={searchDraft}
          onChange={(event) => setSearchDraft(event.target.value)}
          onKeyDown={onSearchKeyDown}
          placeholder={copy.page.searchPlaceholder}
        />
        <button type="button" className="action-btn" data-testid="search-submit-button" onClick={onCommitSearch}>
          {copy.page.searchSubmit}
        </button>
        {searchDraft.length > 0 ? (
          <button type="button" className="link-btn" data-testid="clear-search-button" onClick={onClearSearch}>
            {copy.page.clear}
          </button>
        ) : null}
        {hasAdvancedFilters ? (
          <button
            type="button"
            className="link-btn"
            data-testid="toggle-filters"
            aria-expanded={showAdvancedFilters}
            onClick={onToggleAdvancedFilters}
          >
            {copy.page.filterOptions}: {showAdvancedFilters ? copy.page.hideFilters : copy.page.showFilters}
          </button>
        ) : null}
      </div>
      <p className="sub filter-search-hint">{copy.page.searchHint}</p>
      <div className="filter-row filter-row--primary">
        {tab === "tasks" ? (
          <select
            data-testid="task-sort-select"
            value={taskSort}
            onChange={(event) => onUpdateQuery({ taskSort: event.target.value })}
          >
            <option value="latest">{copy.page.latest}</option>
            <option value="created">{copy.page.created}</option>
            <option value="deadline">{copy.page.deadline}</option>
            <option value="reward">{copy.page.reward}</option>
          </select>
        ) : tab === "users" ? (
          <>
            <label className={`switch-line switch-line--toggle ${activeOnly ? "active" : ""}`}>
              <input
                className="switch-line__input"
                data-testid="active-only-checkbox"
                type="checkbox"
                checked={activeOnly}
                onChange={(event) => onUpdateQuery({ activeOnly: event.target.checked ? "true" : "false" })}
              />
              <span className="switch-line__slider" aria-hidden="true" />
              <span className="switch-line__text">{copy.page.activeOnly}</span>
            </label>
            <select
              data-testid="agent-sort-select"
              value={agentSort}
              onChange={(event) => onUpdateQuery({ agentSort: event.target.value })}
            >
              <option value="latest">{copy.page.latest}</option>
              <option value="score">{copy.page.score}</option>
              <option value="reputation">{copy.page.reputation}</option>
              <option value="completed">{copy.page.completed}</option>
              <option value="published">{copy.page.published}</option>
              <option value="intented">{copy.page.intended}</option>
            </select>
          </>
        ) : (
          <select
            data-testid="dispute-sort-select"
            value={disputeSort}
            onChange={(event) => onUpdateQuery({ disputeSort: event.target.value })}
          >
            <option value="latest">{copy.page.latest}</option>
            <option value="created">{copy.page.created}</option>
          </select>
        )}
        <select
          data-testid="sort-order-select"
          value={sortOrderValue}
          onChange={(event) => onUpdateQuery(
            tab === "tasks"
              ? { taskOrder: event.target.value }
              : tab === "users"
                ? { agentOrder: event.target.value }
                : { disputeOrder: event.target.value }
          )}
        >
          <option value="desc">{copy.page.orderDesc}</option>
          <option value="asc">{copy.page.orderAsc}</option>
        </select>
      </div>
      {hasAdvancedFilters && showAdvancedFilters ? (
        <div className="filter-row filter-row--controls">
          {tab === "tasks" ? (
            <select
              data-testid="task-status-select"
              value={taskStatus ?? ""}
              onChange={(event) => onUpdateQuery({ taskStatus: event.target.value || null })}
            >
              <option value="">{copy.page.allStatus}</option>
              {TASK_STATUS_FILTERS.map((status) => (
                <option key={status} value={status}>{getTaskStatusLabel(locale, status)}</option>
              ))}
            </select>
          ) : tab === "users" ? (
            <p className="muted">
              {locale === "zh" ? "常用排序和活跃筛选已前置到上方。" : "Common sort and active filters are available in the row above."}
            </p>
          ) : (
            <select
              data-testid="dispute-status-select"
              value={disputeStatus ?? ""}
              onChange={(event) => onUpdateQuery({ disputeStatus: event.target.value || null })}
            >
              <option value="">{copy.page.allStatus}</option>
              <option value="OPEN">{copy.page.openOnly}</option>
              <option value="RESOLVED_COMPLETED">{copy.page.resolvedCompleted}</option>
            </select>
          )}
        </div>
      ) : null}
      <div className="filter-row filter-row--actions">
        <button type="button" className="action-btn" data-testid="reset-filters" onClick={onResetFilters}>
          {copy.page.reset}
        </button>
      </div>
    </div>
  );
};
