import type { Dispatch, RefObject, SetStateAction } from "react";
import type { SupportedLocale } from "@agentrade/i18n";
import type {
  ActivityEvent,
  AgentDirectoryItem,
  AgentProfile,
  Cycle,
  CycleRewardsResponse,
  DashboardSummaryResponse,
  Dispute,
  LedgerBalance,
  PaginatedResponse,
  Task
} from "@agentrade/types";
import { AgentDetailDrawer } from "./agent-detail-drawer";
import { AgentListPanel } from "./agent-list-panel";
import { ActivityFeed } from "./activity-feed";
import { CycleDetailDrawer } from "./cycle-detail-drawer";
import { CycleListPanel } from "./cycle-list-panel";
import { OverviewPanels } from "./overview-panels";
import { TaskDetailDrawer } from "./task-detail-drawer";
import { TaskListPanel } from "./task-list-panel";
import { getDashboardCopy } from "./i18n";
import { LocaleSwitcher } from "../locale-switcher";

interface DashboardViewProps {
  initialLocale: SupportedLocale;
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
  loadingTasks: boolean;
  loadingAgents: boolean;
  loadingCycles: boolean;
  loadingMoreTasks: boolean;
  loadingMoreAgents: boolean;
  loadingMoreCycles: boolean;
  loadingFeed: boolean;
  taskLoadError: boolean;
  agentLoadError: boolean;
  cycleLoadError: boolean;
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
  taskSentinelRef: RefObject<HTMLDivElement | null>;
  agentSentinelRef: RefObject<HTMLDivElement | null>;
  cycleSentinelRef: RefObject<HTMLDivElement | null>;
  tab: "tasks" | "users" | "cycles";
  taskStatus: Task["status"] | null;
  taskSort: "latest" | "created" | "deadline" | "reward";
  taskOrder: "asc" | "desc";
  agentSort: "latest" | "score" | "reputation" | "completed" | "published" | "accepted";
  agentOrder: "asc" | "desc";
  activeOnly: boolean;
  trendWindow: "7d" | "30d";
  taskDetailId: string | null;
  agentDetailAddress: string | null;
  cycleDetailId: string | null;
  searchDraft: string;
  setSearchDraft: Dispatch<SetStateAction<string>>;
  trendPublished: number[];
  trendAccepted: number[];
  trendCompleted: number[];
  trendDisputes: number[];
  cycleUptime: string;
  taskStatusCounts: Record<string, number>;
  hasTaskFilters: boolean;
  hasAgentFilters: boolean;
  updateQuery: (patch: Record<string, string | null>) => void;
  refreshAll: () => void;
  clearSearch: () => void;
  commitSearch: () => void;
  resetFilters: () => void;
  openTaskDetail: (taskId: string) => void;
  openAgentDetail: (address: string) => void;
  openCycleDetail: (cycleId: string) => void;
  closeDetail: () => void;
  retryTaskDetail: () => void;
  retryAgentDetail: () => void;
  retryCycleDetail: () => void;
  loadMoreTasks: () => void;
  loadMoreAgents: () => void;
  loadMoreCycles: () => void;
  openByActivity: (item: ActivityEvent) => void;
}

export const DashboardView = ({
  initialLocale,
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
  loadingTasks,
  loadingAgents,
  loadingCycles,
  loadingMoreTasks,
  loadingMoreAgents,
  loadingMoreCycles,
  loadingFeed,
  taskLoadError,
  agentLoadError,
  cycleLoadError,
  feedLoadError,
  taskDetail,
  agentDetail,
  cycleDetail,
  taskSentinelRef,
  agentSentinelRef,
  cycleSentinelRef,
  tab,
  taskStatus,
  taskSort,
  taskOrder,
  agentSort,
  agentOrder,
  activeOnly,
  trendWindow,
  taskDetailId,
  agentDetailAddress,
  cycleDetailId,
  searchDraft,
  setSearchDraft,
  trendPublished,
  trendAccepted,
  trendCompleted,
  trendDisputes,
  cycleUptime,
  taskStatusCounts,
  hasTaskFilters,
  hasAgentFilters,
  updateQuery,
  refreshAll,
  clearSearch,
  commitSearch,
  resetFilters,
  openTaskDetail,
  openAgentDetail,
  openCycleDetail,
  closeDetail,
  retryTaskDetail,
  retryAgentDetail,
  retryCycleDetail,
  loadMoreTasks,
  loadMoreAgents,
  loadMoreCycles,
  openByActivity
}: DashboardViewProps) => {
  const copy = getDashboardCopy(locale);

  return (
    <main className="page" data-testid="dashboard-page">
      <section className="top">
        <div>
          <h1 className="title">{appTitle}</h1>
          <p className="sub">{readOnlyNotice}</p>
        </div>
        <LocaleSwitcher initialLocale={initialLocale} onChange={setLocale} />
      </section>

      <section className="toolbar">
        <span className="badge">{timeZone}</span>
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
      </section>

      <section className="card">
        <div className="tabs">
          <button
            type="button"
            className={`tab-btn ${tab === "tasks" ? "active" : ""}`}
            data-testid="tab-tasks"
            onClick={() => updateQuery({ tab: "tasks", agentDetail: null, taskDetail: null, cycleDetail: null })}
          >
            Task
          </button>
          <button
            type="button"
            className={`tab-btn ${tab === "users" ? "active" : ""}`}
            data-testid="tab-users"
            onClick={() => updateQuery({ tab: "users", agentDetail: null, taskDetail: null, cycleDetail: null })}
          >
            User
          </button>
          <button
            type="button"
            className={`tab-btn ${tab === "cycles" ? "active" : ""}`}
            data-testid="tab-cycles"
            onClick={() => updateQuery({ tab: "cycles", agentDetail: null, taskDetail: null, cycleDetail: null })}
          >
            Cycle
          </button>
        </div>

        {tab !== "cycles" ? (
          <div className="filter-row">
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
            {tab === "tasks" ? (
              <>
                <select
                  data-testid="task-status-select"
                  value={taskStatus ?? ""}
                  onChange={(event) => updateQuery({ taskStatus: event.target.value || null })}
                >
                  <option value="">{copy.page.allStatus}</option>
                  <option value="OPEN">OPEN</option>
                  <option value="IN_PROGRESS">IN_PROGRESS</option>
                  <option value="CLOSED">CLOSED</option>
                  <option value="TERMINATED">TERMINATED</option>
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
            ) : (
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
            )}
            <select
              data-testid="sort-order-select"
              value={tab === "tasks" ? taskOrder : agentOrder}
              onChange={(event) => updateQuery(tab === "tasks" ? { taskOrder: event.target.value } : { agentOrder: event.target.value })}
            >
              <option value="desc">{copy.page.orderDesc}</option>
              <option value="asc">{copy.page.orderAsc}</option>
            </select>
            <button type="button" className="action-btn" data-testid="reset-filters" onClick={resetFilters}>
              {copy.page.reset}
            </button>
          </div>
        ) : (
          <p className="sub">{copy.page.cyclesHint}</p>
        )}
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
        ) : (
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
        )}
      </section>

      {taskDetailId || agentDetailAddress || cycleDetailId ? (
        <section className="drawer-mask" onClick={closeDetail}>
          <aside
            className="drawer"
            data-testid="detail-drawer"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="section-head">
              <h2>{copy.page.drawerTitle}</h2>
              <button type="button" className="link-btn" onClick={closeDetail}>
                {copy.page.close}
              </button>
            </div>
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
            ) : (
              <AgentDetailDrawer
                locale={locale}
                timeZone={timeZone}
                agentDetail={agentDetail}
                onRetry={retryAgentDetail}
              />
            )}
          </aside>
        </section>
      ) : null}
    </main>
  );
};
