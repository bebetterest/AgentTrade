import type { Dispatch, KeyboardEvent, RefObject, SetStateAction } from "react";
import type { SupportedLocale } from "@agentrade/i18n";
import type {
  ActivityEvent,
  AgentDirectoryItem,
  AgentProfile,
  Cycle,
  CycleRewardsResponse,
  DashboardSummaryResponse,
  Dispute,
  HealthStatus,
  LedgerBalance,
  PaginatedResponse,
  PublicEconomyParams,
  Task
} from "@agentrade/types";
import { AgentDetailDrawer } from "./agent-detail-drawer";
import { AgentListPanel } from "./agent-list-panel";
import { ActivityFeed } from "./activity-feed";
import { CycleDetailDrawer } from "./cycle-detail-drawer";
import { CycleListPanel } from "./cycle-list-panel";
import { DetailDrawerShell } from "./detail-drawer-shell";
import { DisputeDetailDrawer } from "./dispute-detail-drawer";
import { DisputeListPanel } from "./dispute-list-panel";
import { OverviewPanels } from "./overview-panels";
import { TaskDetailDrawer } from "./task-detail-drawer";
import { TaskListPanel } from "./task-list-panel";
import { getCycleStatusLabel, getDashboardCopy, getTaskStatusLabel } from "./i18n";
import { getDashboardTabNavigationTarget, TASK_STATUS_FILTERS } from "./shared";
import { formatDateTime } from "../../lib/dashboard-format";
import type { DashboardTab } from "../../lib/dashboard-query";
import { SiteHeader } from "../site-header";

interface DashboardViewProps {
  locale: SupportedLocale;
  setLocale: Dispatch<SetStateAction<SupportedLocale>>;
  appTitle: string;
  readOnlyNotice: string;
  timeZone: string;
  refreshing: boolean;
  overviewError: boolean;
  summary: DashboardSummaryResponse | null;
  leaders: AgentDirectoryItem[];
  activeCycle: Cycle | null;
  activityFeed: ActivityEvent[];
  tasksData: PaginatedResponse<Task>;
  agentsData: PaginatedResponse<AgentDirectoryItem>;
  cyclesData: PaginatedResponse<Cycle>;
  disputesData: PaginatedResponse<Dispute>;
  economy: PublicEconomyParams | null;
  health: HealthStatus | null;
  loadingTasks: boolean;
  loadingAgents: boolean;
  loadingCycles: boolean;
  loadingDisputes: boolean;
  loadingMoreTasks: boolean;
  loadingMoreAgents: boolean;
  loadingMoreCycles: boolean;
  loadingMoreDisputes: boolean;
  loadingFeed: boolean;
  taskLoadError: boolean;
  agentLoadError: boolean;
  cycleLoadError: boolean;
  disputeLoadError: boolean;
  feedLoadError: boolean;
  taskDetail: {
    loading: boolean;
    error: boolean;
    task: Task | null;
    disputes: Dispute[];
    activities: ActivityEvent[];
  };
  agentDetail: {
    loading: boolean;
    error: boolean;
    profile: AgentProfile | null;
    ledger: LedgerBalance | null;
    activities: ActivityEvent[];
  };
  cycleDetail: {
    loading: boolean;
    error: boolean;
    rewards: CycleRewardsResponse | null;
    disputes: Dispute[];
  };
  disputeDetail: {
    loading: boolean;
    error: boolean;
    dispute: Dispute | null;
    task: Task | null;
    activities: ActivityEvent[];
  };
  taskSentinelRef: RefObject<HTMLDivElement | null>;
  agentSentinelRef: RefObject<HTMLDivElement | null>;
  cycleSentinelRef: RefObject<HTMLDivElement | null>;
  disputeSentinelRef: RefObject<HTMLDivElement | null>;
  tab: "tasks" | "users" | "cycles" | "disputes";
  taskStatus: Task["status"] | null;
  taskSort: "latest" | "created" | "deadline" | "reward";
  taskOrder: "asc" | "desc";
  agentSort: "latest" | "score" | "reputation" | "completed" | "published" | "accepted";
  agentOrder: "asc" | "desc";
  disputeStatus: Dispute["status"] | null;
  disputeSort: "latest" | "created";
  disputeOrder: "asc" | "desc";
  activeOnly: boolean;
  trendWindow: "7d" | "30d";
  taskDetailId: string | null;
  agentDetailAddress: string | null;
  cycleDetailId: string | null;
  disputeDetailId: string | null;
  searchDraft: string;
  setSearchDraft: Dispatch<SetStateAction<string>>;
  trendPublished: number[];
  trendAccepted: number[];
  trendCompleted: number[];
  trendDisputes: number[];
  cycleUptime: string;
  taskStatusCounts: Record<string, number>;
  disputeStatusCounts: Record<string, number>;
  hasTaskFilters: boolean;
  hasAgentFilters: boolean;
  hasDisputeFilters: boolean;
  updateQuery: (patch: Record<string, string | null>) => void;
  refreshAll: () => void;
  clearSearch: () => void;
  commitSearch: () => void;
  resetFilters: () => void;
  openTaskDetail: (taskId: string) => void;
  openAgentDetail: (address: string) => void;
  openCycleDetail: (cycleId: string) => void;
  openDisputeDetail: (disputeId: string) => void;
  closeDetail: () => void;
  retryTaskDetail: () => void;
  retryAgentDetail: () => void;
  retryCycleDetail: () => void;
  retryDisputeDetail: () => void;
  loadMoreTasks: () => void;
  loadMoreAgents: () => void;
  loadMoreCycles: () => void;
  loadMoreDisputes: () => void;
  openByActivity: (item: ActivityEvent) => void;
}

export const DashboardView = ({
  locale,
  setLocale,
  appTitle,
  readOnlyNotice,
  timeZone,
  refreshing,
  overviewError,
  summary,
  leaders,
  activeCycle,
  activityFeed,
  tasksData,
  agentsData,
  cyclesData,
  disputesData,
  economy,
  health,
  loadingTasks,
  loadingAgents,
  loadingCycles,
  loadingDisputes,
  loadingMoreTasks,
  loadingMoreAgents,
  loadingMoreCycles,
  loadingMoreDisputes,
  loadingFeed,
  taskLoadError,
  agentLoadError,
  cycleLoadError,
  disputeLoadError,
  feedLoadError,
  taskDetail,
  agentDetail,
  cycleDetail,
  disputeDetail,
  taskSentinelRef,
  agentSentinelRef,
  cycleSentinelRef,
  disputeSentinelRef,
  tab,
  taskStatus,
  taskSort,
  taskOrder,
  agentSort,
  agentOrder,
  disputeStatus,
  disputeSort,
  disputeOrder,
  activeOnly,
  trendWindow,
  taskDetailId,
  agentDetailAddress,
  cycleDetailId,
  disputeDetailId,
  searchDraft,
  setSearchDraft,
  trendPublished,
  trendAccepted,
  trendCompleted,
  trendDisputes,
  cycleUptime,
  taskStatusCounts,
  disputeStatusCounts,
  hasTaskFilters,
  hasAgentFilters,
  hasDisputeFilters,
  updateQuery,
  refreshAll,
  clearSearch,
  commitSearch,
  resetFilters,
  openTaskDetail,
  openAgentDetail,
  openCycleDetail,
  openDisputeDetail,
  closeDetail,
  retryTaskDetail,
  retryAgentDetail,
  retryCycleDetail,
  retryDisputeDetail,
  loadMoreTasks,
  loadMoreAgents,
  loadMoreCycles,
  loadMoreDisputes,
  openByActivity
}: DashboardViewProps) => {
  const copy = getDashboardCopy(locale);
  const activeSection = tab === "tasks" ? "tasks" : tab === "users" ? "users" : tab === "cycles" ? "cycles" : "disputes";
  const panelId = `center-panel-${tab}`;
  const drawerTitle = taskDetailId
    ? copy.page.drawerTask
    : cycleDetailId
      ? copy.page.drawerCycle
      : disputeDetailId
        ? copy.page.drawerDispute
        : copy.page.drawerAgent;
  const openTab = (nextTab: DashboardTab) => updateQuery({
    tab: nextTab,
    agentDetail: null,
    taskDetail: null,
    cycleDetail: null,
    disputeDetail: null
  });
  const handleTabKeyDown = (currentTab: DashboardTab) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const targetTab = getDashboardTabNavigationTarget(currentTab, event.key);
    if (!targetTab || targetTab === currentTab) {
      return;
    }

    event.preventDefault();
    openTab(targetTab);
    document.getElementById(`center-tab-${targetTab}`)?.focus();
  };

  return (
    <>
      <SiteHeader locale={locale} active={activeSection} onLocaleChange={setLocale} />
      <main className="page page--center" data-testid="dashboard-page">
        <section className="center-hero">
          <div>
            <span className="eyebrow">{copy.page.centerEyebrow}</span>
            <h1 className="title">{copy.page.centerTitle}</h1>
            <p className="sub center-hero__body">{copy.page.centerBody}</p>
            <p className="sub center-hero__note">{readOnlyNotice}</p>
            <div className="hero-fact-grid hero-fact-grid--center">
              <article className="fact-chip">
                <span className="fact-chip__label">{copy.overview.tasks}</span>
                <strong className="fact-chip__value">{summary?.totals.tasks ?? tasksData.items.length}</strong>
              </article>
              <article className="fact-chip">
                <span className="fact-chip__label">{copy.overview.agents}</span>
                <strong className="fact-chip__value">{summary?.totals.agents ?? agentsData.items.length}</strong>
              </article>
              <article className="fact-chip">
                <span className="fact-chip__label">{copy.overview.disputes}</span>
                <strong className="fact-chip__value">{summary?.totals.disputes ?? disputesData.items.length}</strong>
              </article>
              <article className="fact-chip">
                <span className="fact-chip__label">{copy.overview.cycleStatus}</span>
                <strong className="fact-chip__value">{activeCycle ? getCycleStatusLabel(locale, activeCycle.status) : "-"}</strong>
              </article>
            </div>
          </div>
          <div className="hero-panel__stats hero-panel__stats--compact">
            <article className="hero-stat hero-stat--focus">
              <span className="hero-stat__label">{copy.page.centerUpdated}</span>
              <strong className="hero-stat__value">
                {summary ? formatDateTime(summary.generatedAt, locale, timeZone) : "-"}
              </strong>
              <span className="hero-stat__meta">{timeZone}</span>
            </article>
            <article className="hero-stat">
              <span className="hero-stat__label">{copy.page.centerSource}</span>
              <strong className="hero-stat__value">{copy.page.contractSource}</strong>
            </article>
            <article className="hero-stat">
              <span className="hero-stat__label">{copy.page.centerBoundary}</span>
              <strong className="hero-stat__value">{appTitle}</strong>
              <span className="hero-stat__meta">{readOnlyNotice}</span>
            </article>
            <article className="hero-stat">
              <span className="hero-stat__label">{copy.page.centerHealth}</span>
              <strong className="hero-stat__value">{health?.ok ? "OK" : "-"}</strong>
              <span className="hero-stat__meta">
                {copy.page.centerRateLimit}: {economy ? `${economy.rateLimitPerMinute}/min` : "-"}
              </span>
            </article>
          </div>
        </section>

        <section className="toolbar toolbar--center">
          <span className="badge">{activeCycle?.id ?? "-"}</span>
          <span className="badge">{copy.page.centerHealth}: {health?.service ?? "-"}</span>
          <button type="button" className="action-btn" data-testid="refresh-button" onClick={refreshAll} disabled={refreshing}>
            {refreshing ? copy.page.refreshing : copy.page.refresh}
          </button>
        </section>

        {overviewError ? (
          <section className="card alert-card" data-testid="overview-error">
            <p>{copy.page.overviewError}</p>
            <button type="button" className="action-btn" onClick={refreshAll}>
              {copy.common.retry}
            </button>
          </section>
        ) : null}

        <OverviewPanels
          locale={locale}
          timeZone={timeZone}
          summary={summary}
          activeCycle={activeCycle}
          cycleUptime={cycleUptime}
          trendWindow={trendWindow}
          trendPublished={trendPublished}
          trendAccepted={trendAccepted}
          trendCompleted={trendCompleted}
          trendDisputes={trendDisputes}
          leaders={leaders}
          onTrendWindowChange={(window) => updateQuery({ trendWindow: window })}
          onOpenAgentDetail={openAgentDetail}
          onOpenCycleDetail={openCycleDetail}
        />

        <section className="insight-grid">
          <ActivityFeed
            locale={locale}
            timeZone={timeZone}
            refreshing={refreshing}
            feedLoadError={feedLoadError}
            loadingFeed={loadingFeed}
            activityFeed={activityFeed}
            onRefresh={refreshAll}
            onOpenByActivity={openByActivity}
          />
          <article className="card trust-card">
            <div className="section-head">
              <h2>{copy.page.centerSource}</h2>
              <span className="badge">{copy.page.centerBoundary}</span>
            </div>
            <div className="metric-line"><span>{copy.page.centerHealth}</span><strong>{health?.ok ? "OK" : "-"}</strong></div>
            <div className="metric-line"><span>{copy.page.centerRateLimit}</span><strong>{economy ? `${economy.rateLimitPerMinute}/min` : "-"}</strong></div>
            <div className="metric-line"><span>{copy.page.centerPersistence}</span><strong>{economy?.enablePersistence ? copy.common.on : copy.common.off}</strong></div>
            <div className="metric-line"><span>{copy.page.centerBridge}</span><strong>{economy?.bridgeChain ?? "-"}</strong></div>
            <div className="metric-line"><span>{copy.overview.disputes}</span><strong>{summary?.totals.disputes ?? disputesData.items.length}</strong></div>
            <div className="metric-line"><span>{copy.overview.tasks}</span><strong>{summary?.totals.tasks ?? tasksData.items.length}</strong></div>
            <div className="metric-line"><span>{copy.page.centerSource}</span><strong>{copy.page.contractSource}</strong></div>
          </article>
        </section>

        <section className="card">
          <div className="section-head">
            <h2>{copy.page.listingsTitle}</h2>
            <span className="badge">/center</span>
          </div>
          <div className="tabs" role="tablist" aria-label={copy.page.listingsTitle}>
            <button
              id="center-tab-tasks"
              type="button"
              className={`tab-btn ${tab === "tasks" ? "active" : ""}`}
              data-testid="tab-tasks"
              role="tab"
              aria-selected={tab === "tasks"}
              aria-controls="center-panel-tasks"
              tabIndex={tab === "tasks" ? 0 : -1}
              onClick={() => openTab("tasks")}
              onKeyDown={handleTabKeyDown("tasks")}
            >
              {copy.page.tabTasks}
            </button>
            <button
              id="center-tab-users"
              type="button"
              className={`tab-btn ${tab === "users" ? "active" : ""}`}
              data-testid="tab-users"
              role="tab"
              aria-selected={tab === "users"}
              aria-controls="center-panel-users"
              tabIndex={tab === "users" ? 0 : -1}
              onClick={() => openTab("users")}
              onKeyDown={handleTabKeyDown("users")}
            >
              {copy.page.tabUsers}
            </button>
            <button
              id="center-tab-cycles"
              type="button"
              className={`tab-btn ${tab === "cycles" ? "active" : ""}`}
              data-testid="tab-cycles"
              role="tab"
              aria-selected={tab === "cycles"}
              aria-controls="center-panel-cycles"
              tabIndex={tab === "cycles" ? 0 : -1}
              onClick={() => openTab("cycles")}
              onKeyDown={handleTabKeyDown("cycles")}
            >
              {copy.page.tabCycles}
            </button>
            <button
              id="center-tab-disputes"
              type="button"
              className={`tab-btn ${tab === "disputes" ? "active" : ""}`}
              data-testid="tab-disputes"
              role="tab"
              aria-selected={tab === "disputes"}
              aria-controls="center-panel-disputes"
              tabIndex={tab === "disputes" ? 0 : -1}
              onClick={() => openTab("disputes")}
              onKeyDown={handleTabKeyDown("disputes")}
            >
              {copy.page.tabDisputes}
            </button>
          </div>

          {tab !== "cycles" ? (
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
                  onBlur={commitSearch}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      commitSearch();
                    }
                  }}
                  placeholder={copy.page.searchPlaceholder}
                />
                {searchDraft.length > 0 ? (
                  <button type="button" className="link-btn" data-testid="clear-search-button" onClick={clearSearch}>
                    {copy.page.clear}
                  </button>
                ) : null}
              </div>
              <div className="filter-row filter-row--controls">
                {tab === "tasks" ? (
                  <>
                    <select
                      data-testid="task-status-select"
                      value={taskStatus ?? ""}
                      onChange={(event) => updateQuery({ taskStatus: event.target.value || null })}
                    >
                      <option value="">{copy.page.allStatus}</option>
                      {TASK_STATUS_FILTERS.map((status) => (
                        <option key={status} value={status}>{getTaskStatusLabel(locale, status)}</option>
                      ))}
                    </select>
                    <select
                      data-testid="task-sort-select"
                      value={taskSort}
                      onChange={(event) => updateQuery({ taskSort: event.target.value })}
                    >
                      <option value="latest">{copy.page.latest}</option>
                      <option value="created">{copy.page.created}</option>
                      <option value="deadline">{copy.page.deadline}</option>
                      <option value="reward">{copy.page.reward}</option>
                    </select>
                  </>
                ) : tab === "users" ? (
                  <>
                    <label className="switch-line">
                      <input
                        data-testid="active-only-checkbox"
                        type="checkbox"
                        checked={activeOnly}
                        onChange={(event) => updateQuery({ activeOnly: event.target.checked ? "true" : "false" })}
                      />
                      {copy.page.activeOnly}
                    </label>
                    <select
                      data-testid="agent-sort-select"
                      value={agentSort}
                      onChange={(event) => updateQuery({ agentSort: event.target.value })}
                    >
                      <option value="latest">{copy.page.latest}</option>
                      <option value="score">{copy.page.score}</option>
                      <option value="reputation">{copy.page.reputation}</option>
                      <option value="completed">{copy.page.completed}</option>
                      <option value="published">{copy.page.published}</option>
                      <option value="accepted">{copy.page.accepted}</option>
                    </select>
                  </>
                ) : (
                  <>
                    <select
                      data-testid="dispute-status-select"
                      value={disputeStatus ?? ""}
                      onChange={(event) => updateQuery({ disputeStatus: event.target.value || null })}
                    >
                      <option value="">{copy.page.allStatus}</option>
                      <option value="OPEN">{copy.page.openOnly}</option>
                      <option value="RESOLVED_COMPLETED">{copy.page.resolvedCompleted}</option>
                      <option value="RESOLVED_NOT_COMPLETED">{copy.page.resolvedNotCompleted}</option>
                    </select>
                    <select
                      data-testid="dispute-sort-select"
                      value={disputeSort}
                      onChange={(event) => updateQuery({ disputeSort: event.target.value })}
                    >
                      <option value="latest">{copy.page.latest}</option>
                      <option value="created">{copy.page.created}</option>
                    </select>
                  </>
                )}
                <select
                  data-testid="sort-order-select"
                  value={tab === "tasks" ? taskOrder : tab === "users" ? agentOrder : disputeOrder}
                  onChange={(event) => updateQuery(
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
              <div className="filter-row filter-row--actions">
                <button type="button" className="action-btn" data-testid="reset-filters" onClick={resetFilters}>
                  {copy.page.reset}
                </button>
              </div>
            </div>
          ) : (
            <p className="sub">{copy.page.cyclesHint}</p>
          )}

          {tab === "disputes" ? <p className="sub">{copy.page.disputesHint}</p> : null}

          <div className="stream-panel" id={panelId} role="tabpanel" aria-labelledby={`center-tab-${tab}`}>
            {tab === "tasks" ? (
              <TaskListPanel
                locale={locale}
                timeZone={timeZone}
                tasks={tasksData.items}
                taskStatus={taskStatus}
                taskStatusCounts={taskStatusCounts}
                hasTaskFilters={hasTaskFilters}
                loadingTasks={loadingTasks}
                loadingMoreTasks={loadingMoreTasks}
                taskLoadError={taskLoadError}
                nextCursor={tasksData.nextCursor}
                taskSentinelRef={taskSentinelRef}
                onOpenTaskDetail={openTaskDetail}
                onSetTaskStatus={(status) => updateQuery({ taskStatus: status })}
                onRefresh={refreshAll}
                onLoadMore={loadMoreTasks}
              />
            ) : tab === "users" ? (
              <AgentListPanel
                locale={locale}
                timeZone={timeZone}
                agents={agentsData.items}
                hasAgentFilters={hasAgentFilters}
                loadingAgents={loadingAgents}
                loadingMoreAgents={loadingMoreAgents}
                agentLoadError={agentLoadError}
                nextCursor={agentsData.nextCursor}
                agentSentinelRef={agentSentinelRef}
                onOpenAgentDetail={openAgentDetail}
                onRefresh={refreshAll}
                onLoadMore={loadMoreAgents}
              />
            ) : tab === "cycles" ? (
              <CycleListPanel
                locale={locale}
                timeZone={timeZone}
                cycles={cyclesData.items}
                loadingCycles={loadingCycles}
                loadingMoreCycles={loadingMoreCycles}
                cycleLoadError={cycleLoadError}
                nextCursor={cyclesData.nextCursor}
                cycleSentinelRef={cycleSentinelRef}
                onOpenCycleDetail={openCycleDetail}
                onRefresh={refreshAll}
                onLoadMore={loadMoreCycles}
              />
            ) : (
              <DisputeListPanel
                locale={locale}
                timeZone={timeZone}
                disputes={disputesData.items}
                disputeStatus={disputeStatus}
                disputeStatusCounts={disputeStatusCounts}
                hasDisputeFilters={hasDisputeFilters}
                loadingDisputes={loadingDisputes}
                loadingMoreDisputes={loadingMoreDisputes}
                disputeLoadError={disputeLoadError}
                nextCursor={disputesData.nextCursor}
                disputeSentinelRef={disputeSentinelRef}
                onOpenDisputeDetail={openDisputeDetail}
                onSetDisputeStatus={(status) => updateQuery({ disputeStatus: status })}
                onRefresh={refreshAll}
                onLoadMore={loadMoreDisputes}
              />
            )}
          </div>
        </section>

        {taskDetailId || agentDetailAddress || cycleDetailId || disputeDetailId ? (
          <DetailDrawerShell
            eyebrow={copy.page.drawerTitle}
            title={drawerTitle}
            hint={copy.page.drawerHint}
            closeLabel={copy.page.close}
            onClose={closeDetail}
          >
              {taskDetailId ? (
                <TaskDetailDrawer
                  locale={locale}
                  timeZone={timeZone}
                  taskDetail={taskDetail}
                  onRetry={retryTaskDetail}
                  onOpenAgentDetail={openAgentDetail}
                />
              ) : cycleDetailId ? (
                <CycleDetailDrawer
                  locale={locale}
                  timeZone={timeZone}
                  cycleDetail={cycleDetail}
                  onRetry={retryCycleDetail}
                  onOpenAgentDetail={openAgentDetail}
                />
              ) : disputeDetailId ? (
                <DisputeDetailDrawer
                  locale={locale}
                  timeZone={timeZone}
                  disputeDetail={disputeDetail}
                  onRetry={retryDisputeDetail}
                  onOpenAgentDetail={openAgentDetail}
                />
              ) : (
                <AgentDetailDrawer
                  locale={locale}
                  timeZone={timeZone}
                  agentDetail={agentDetail}
                  onRetry={retryAgentDetail}
                />
              )}
          </DetailDrawerShell>
        ) : null}
      </main>
    </>
  );
};
