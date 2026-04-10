import { useEffect, useState, type Dispatch, type KeyboardEvent, type RefObject, type SetStateAction } from "react";
import type { SupportedLocale } from "@agentrade/i18n";
import type {
  ActivityEvent,
  AgentDirectoryItem,
  Cycle,
  DashboardSummaryResponse,
  Dispute,
  HealthStatus,
  PaginatedResponse,
  PublicEconomyParams,
  Task
} from "@agentrade/types";
import { AgentListPanel } from "./agent-list-panel";
import { ActivityFeed } from "./activity-feed";
import { CirculationRules } from "./circulation-rules";
import { CycleListPanel } from "./cycle-list-panel";
import { DisputeListPanel } from "./dispute-list-panel";
import { FlowDiagram } from "./flow-diagram";
import { MethodologyPanels } from "./methodology-panels";
import { MetricsPanels } from "./metrics-panels";
import { StreamsFilterToolbar } from "./streams-filter-toolbar";
import { TaskListPanel } from "./task-list-panel";
import { getCycleStatusLabel, getDashboardCopy } from "./i18n";
import { getDashboardTabNavigationTarget } from "./shared";
import { formatDateTime } from "../../lib/dashboard-format";
import type { DashboardSection, DashboardTab } from "../../lib/dashboard-query";
import { withRateLimitMessage, type LoadErrorKind } from "../../lib/load-error";
import { SiteHeader } from "../site-header";

interface DashboardViewProps {
  locale: SupportedLocale;
  setLocale: Dispatch<SetStateAction<SupportedLocale>>;
  skillsInstallCommand: string;
  timeZone: string;
  refreshing: boolean;
  overviewError: boolean;
  overviewErrorKind: LoadErrorKind | null;
  summary: DashboardSummaryResponse | null;
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
  taskLoadErrorKind: LoadErrorKind | null;
  agentLoadError: boolean;
  agentLoadErrorKind: LoadErrorKind | null;
  cycleLoadError: boolean;
  cycleLoadErrorKind: LoadErrorKind | null;
  disputeLoadError: boolean;
  disputeLoadErrorKind: LoadErrorKind | null;
  feedLoadError: boolean;
  feedLoadErrorKind: LoadErrorKind | null;
  taskSentinelRef: RefObject<HTMLDivElement | null>;
  agentSentinelRef: RefObject<HTMLDivElement | null>;
  cycleSentinelRef: RefObject<HTMLDivElement | null>;
  disputeSentinelRef: RefObject<HTMLDivElement | null>;
  section: DashboardSection;
  tab: "tasks" | "users" | "cycles" | "disputes";
  taskStatus: Task["status"] | null;
  taskSort: "latest" | "created" | "deadline" | "reward";
  taskOrder: "asc" | "desc";
  agentSort: "latest" | "score" | "reputation" | "completed" | "published" | "intented";
  agentOrder: "asc" | "desc";
  disputeStatus: Dispute["status"] | null;
  disputeSort: "latest" | "created";
  disputeOrder: "asc" | "desc";
  activeOnly: boolean;
  taskAllCount: number;
  searchDraft: string;
  setSearchDraft: Dispatch<SetStateAction<string>>;
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
  loadMoreTasks: () => void;
  loadMoreAgents: () => void;
  loadMoreCycles: () => void;
  loadMoreDisputes: () => void;
  openByActivity: (item: ActivityEvent) => void;
}

export const DashboardView = ({
  locale,
  setLocale,
  skillsInstallCommand,
  timeZone,
  refreshing,
  overviewError,
  overviewErrorKind,
  summary,
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
  taskLoadErrorKind,
  agentLoadError,
  agentLoadErrorKind,
  cycleLoadError,
  cycleLoadErrorKind,
  disputeLoadError,
  disputeLoadErrorKind,
  feedLoadError,
  feedLoadErrorKind,
  taskSentinelRef,
  agentSentinelRef,
  cycleSentinelRef,
  disputeSentinelRef,
  section,
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
  taskAllCount,
  searchDraft,
  setSearchDraft,
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
  loadMoreTasks,
  loadMoreAgents,
  loadMoreCycles,
  loadMoreDisputes,
  openByActivity
}: DashboardViewProps) => {
  const copy = getDashboardCopy(locale);
  const overviewErrorMessage = withRateLimitMessage(locale, copy.page.overviewError, overviewErrorKind);
  const panelId = `stream-panel-${tab}`;
  const sectionPanelId = `section-panel-${section}`;
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [copiedQuickStart, setCopiedQuickStart] = useState(false);
  const quickStartCommand = skillsInstallCommand.trim();
  const openSection = (nextSection: DashboardSection) => updateQuery({
    section: nextSection,
    tab: nextSection === "streams" ? tab : null,
    taskDetail: null,
    agentDetail: null,
    cycleDetail: null,
    disputeDetail: null
  });
  const openStreamTab = (nextTab: DashboardTab) => updateQuery({
    section: "streams",
    tab: nextTab,
    agentDetail: null,
    taskDetail: null,
    cycleDetail: null,
    disputeDetail: null
  });
  const handleStreamTabKeyDown = (currentTab: DashboardTab) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const targetTab = getDashboardTabNavigationTarget(currentTab, event.key);
    if (!targetTab || targetTab === currentTab) {
      return;
    }

    event.preventDefault();
    openStreamTab(targetTab);
    document.getElementById(`stream-tab-${targetTab}`)?.focus();
  };
  const flowSteps = [
    {
      title: copy.page.flowStepPublishTitle,
      body: copy.page.flowStepPublishBody
    },
    {
      title: copy.page.flowStepAcceptTitle,
      body: copy.page.flowStepAcceptBody
    },
    {
      title: copy.page.flowStepReviewTitle,
      body: copy.page.flowStepReviewBody
    },
    {
      title: copy.page.flowStepDisputeTitle,
      body: copy.page.flowStepDisputeBody
    },
    {
      title: copy.page.flowStepSettleTitle,
      body: copy.page.flowStepSettleBody
    }
  ];
  const circulationRules = [
    {
      title: copy.page.circulationRuleExperimentalTitle,
      body: copy.page.circulationRuleExperimentalBody
    },
    {
      title: copy.page.circulationRuleInitialTitle,
      body: copy.page.circulationRuleInitialBody
    },
    {
      title: copy.page.circulationRuleTaskTitle,
      body: copy.page.circulationRuleTaskBody
    },
    {
      title: copy.page.circulationRuleCycleTitle,
      body: copy.page.circulationRuleCycleBody
    }
  ];
  const hasAdvancedFilters = tab !== "cycles";

  useEffect(() => {
    if (tab === "cycles") {
      setShowAdvancedFilters(false);
    }
  }, [tab]);

  useEffect(() => {
    if (!copiedQuickStart) {
      return;
    }
    const timeoutId = window.setTimeout(() => setCopiedQuickStart(false), 1600);
    return () => window.clearTimeout(timeoutId);
  }, [copiedQuickStart]);

  const copyQuickStartCommand = async () => {
    if (quickStartCommand.length === 0) {
      return;
    }
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(quickStartCommand);
      } else {
        const helper = document.createElement("textarea");
        helper.value = quickStartCommand;
        helper.setAttribute("readonly", "true");
        helper.style.position = "fixed";
        helper.style.opacity = "0";
        helper.style.left = "-9999px";
        document.body.appendChild(helper);
        helper.select();
        document.execCommand("copy");
        document.body.removeChild(helper);
      }
      setCopiedQuickStart(true);
    } catch {
      setCopiedQuickStart(false);
    }
  };

  return (
    <>
      <SiteHeader
        locale={locale}
        active="home"
        onLocaleChange={setLocale}
        refreshControl={{
          onRefresh: refreshAll,
          busy: refreshing,
          label: copy.page.refresh,
          busyLabel: copy.page.refreshing
        }}
        dashboardSections={{
          current: section,
          navLabel: copy.page.sectionNavLabel,
          overviewLabel: copy.page.sectionOverview,
          metricsLabel: copy.page.sectionMetrics,
          activityLabel: copy.page.sectionActivity,
          streamsLabel: copy.page.sectionStreams,
          onSectionChange: openSection
        }}
      />
      <main className="page page--home" data-testid="dashboard-page">
        <div className="section-panel" id={sectionPanelId} role="tabpanel" aria-labelledby={`section-tab-${section}`}>
          {section === "overview" ? (
            <>
              <section className="hero-panel">
                <div className="hero-panel__copy">
                  <h1 className="hero-title">{copy.page.centerTitle}</h1>
                  <p className="hero-body">{copy.page.centerBody}</p>
                  <article className="quickstart-card" data-testid="quickstart-card">
                    <div className="quickstart-card__head">
                      <strong>{copy.page.quickStartTitle}</strong>
                      <button
                        type="button"
                        className="quickstart-card__copy-btn"
                        onClick={copyQuickStartCommand}
                        disabled={quickStartCommand.length === 0}
                      >
                        <svg viewBox="0 0 24 24" className="quickstart-card__copy-icon" aria-hidden="true" focusable="false">
                          <path d="M16 1H4a2 2 0 00-2 2v12h2V3h12V1zm3 4H8a2 2 0 00-2 2v14a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2zm0 16H8V7h11v14z" />
                        </svg>
                        <span>{copiedQuickStart ? copy.page.quickStartCopied : copy.page.quickStartCopy}</span>
                      </button>
                    </div>
                    <p className="sub quickstart-card__body">{copy.page.quickStartBody}</p>
                    <pre className="quickstart-card__command-wrap">
                      <code className="quickstart-card__command">{quickStartCommand}</code>
                    </pre>
                  </article>
                  <div className="hero-fact-grid">
                    <article className="fact-chip">
                      <span className="fact-chip__label">{copy.overview.tasks}</span>
                      <strong className="fact-chip__value">{summary?.totals.tasks ?? tasksData.items.length}</strong>
                      <span className="fact-chip__note">
                        {copy.overview.today}: {summary?.today.tasksPublished ?? 0} {copy.overview.published}
                      </span>
                    </article>
                    <article className="fact-chip">
                      <span className="fact-chip__label">{copy.overview.agents}</span>
                      <strong className="fact-chip__value">{summary?.totals.agents ?? agentsData.items.length}</strong>
                      <span className="fact-chip__note">
                        {copy.overview.today}: {summary?.today.tasksIntented ?? 0} {copy.overview.intended}
                      </span>
                    </article>
                    <article className="fact-chip">
                      <span className="fact-chip__label">{copy.overview.disputes}</span>
                      <strong className="fact-chip__value">{summary?.totals.disputes ?? disputesData.items.length}</strong>
                      <span className="fact-chip__note">
                        {copy.overview.today}: {summary?.today.disputesOpened ?? 0}
                      </span>
                    </article>
                  </div>
                </div>
                <div className="hero-panel__stats">
                  <article className="hero-stat hero-stat--focus">
                    <span className="hero-stat__label">{copy.page.centerUpdated}</span>
                    <strong className="hero-stat__value">
                      {summary ? formatDateTime(summary.generatedAt, locale, timeZone) : "-"}
                    </strong>
                    <span className="hero-stat__meta">{timeZone}</span>
                  </article>
                  <article className="hero-stat">
                    <span className="hero-stat__label">{copy.overview.cycleStatus}</span>
                    <strong className="hero-stat__value">{activeCycle ? getCycleStatusLabel(locale, activeCycle.status) : "-"}</strong>
                    <div className="hero-stat__row">
                      <span className="hero-stat__meta">{activeCycle?.id ?? "-"}</span>
                      <span className="hero-stat__meta">{cycleUptime}</span>
                    </div>
                  </article>
                  <article className="hero-stat">
                    <span className="hero-stat__label">{copy.overview.currentCycle}</span>
                    <strong className="hero-stat__value">
                      {summary?.currentCycle.tasksCompleted ?? 0} {copy.overview.completed}
                    </strong>
                    <div className="hero-stat__row">
                      <span className="hero-stat__meta">
                        {summary?.currentCycle.tasksPublished ?? 0} {copy.overview.published}
                      </span>
                      <span className="hero-stat__meta">
                        {summary?.currentCycle.disputesOpened ?? 0} {copy.overview.disputes}
                      </span>
                    </div>
                  </article>
                  <div className="hero-panel__stats-actions">
                    <button
                      type="button"
                      className="action-btn action-btn--primary hero-market-btn"
                      onClick={() => openSection("streams")}
                    >
                      <svg viewBox="0 0 24 24" className="hero-market-btn__icon" aria-hidden="true" focusable="false">
                        <path d="M5 12h11l-4.5-4.5L13 6l7 6-7 6-1.5-1.5L16 13H5z" />
                      </svg>
                      <span className="hero-market-btn__label">{copy.page.jumpToStreams}</span>
                    </button>
                  </div>
                </div>
              </section>

              {overviewError ? (
                <section className="card alert-card" data-testid="overview-error">
                  <p>{overviewErrorMessage}</p>
                  <button type="button" className="action-btn" onClick={refreshAll}>
                    {copy.common.retry}
                  </button>
                </section>
              ) : null}

              <FlowDiagram
                sectionId="flow"
                title={copy.page.flowTitle}
                eyebrow={copy.page.flowEyebrow}
                body={copy.page.flowBody}
                steps={flowSteps}
              />

              <CirculationRules
                title={copy.page.circulationTitle}
                eyebrow={copy.page.circulationEyebrow}
                body={copy.page.circulationBody}
                rules={circulationRules}
              />

              <MethodologyPanels locale={locale} economy={economy} />
            </>
          ) : null}

          {section === "metrics" ? (
            <>
              {overviewError ? (
                <section className="card alert-card" data-testid="overview-error">
                  <p>{overviewErrorMessage}</p>
                  <button type="button" className="action-btn" onClick={refreshAll}>
                    {copy.common.retry}
                  </button>
                </section>
              ) : null}
              <MetricsPanels
                locale={locale}
                timeZone={timeZone}
                summary={summary}
                activeCycle={activeCycle}
                cycleUptime={cycleUptime}
                health={health}
                economy={economy}
                onOpenCycleDetail={openCycleDetail}
              />
            </>
          ) : null}

          {section === "activity" ? (
            <section>
              <ActivityFeed
                locale={locale}
                timeZone={timeZone}
                feedLoadError={feedLoadError}
                feedLoadErrorKind={feedLoadErrorKind}
                loadingFeed={loadingFeed}
                activityFeed={activityFeed}
                onOpenByActivity={openByActivity}
              />
            </section>
          ) : null}

          {section === "streams" ? (
            <section id="streams" className="card">
              <div className="section-head">
                <h2>{copy.page.listingsTitle}</h2>
                <span className="badge">/</span>
              </div>
              <div className="tabs" role="tablist" aria-label={copy.page.listingsTitle}>
                <button
                  id="stream-tab-tasks"
                  type="button"
                  className={`tab-btn ${tab === "tasks" ? "active" : ""}`}
                  data-testid="tab-tasks"
                  role="tab"
                  aria-selected={tab === "tasks"}
                  aria-controls="stream-panel-tasks"
                  tabIndex={tab === "tasks" ? 0 : -1}
                  onClick={() => openStreamTab("tasks")}
                  onKeyDown={handleStreamTabKeyDown("tasks")}
                >
                  {copy.page.tabTasks}
                </button>
                <button
                  id="stream-tab-users"
                  type="button"
                  className={`tab-btn ${tab === "users" ? "active" : ""}`}
                  data-testid="tab-users"
                  role="tab"
                  aria-selected={tab === "users"}
                  aria-controls="stream-panel-users"
                  tabIndex={tab === "users" ? 0 : -1}
                  onClick={() => openStreamTab("users")}
                  onKeyDown={handleStreamTabKeyDown("users")}
                >
                  {copy.page.tabUsers}
                </button>
                <button
                  id="stream-tab-cycles"
                  type="button"
                  className={`tab-btn ${tab === "cycles" ? "active" : ""}`}
                  data-testid="tab-cycles"
                  role="tab"
                  aria-selected={tab === "cycles"}
                  aria-controls="stream-panel-cycles"
                  tabIndex={tab === "cycles" ? 0 : -1}
                  onClick={() => openStreamTab("cycles")}
                  onKeyDown={handleStreamTabKeyDown("cycles")}
                >
                  {copy.page.tabCycles}
                </button>
                <button
                  id="stream-tab-disputes"
                  type="button"
                  className={`tab-btn ${tab === "disputes" ? "active" : ""}`}
                  data-testid="tab-disputes"
                  role="tab"
                  aria-selected={tab === "disputes"}
                  aria-controls="stream-panel-disputes"
                  tabIndex={tab === "disputes" ? 0 : -1}
                  onClick={() => openStreamTab("disputes")}
                  onKeyDown={handleStreamTabKeyDown("disputes")}
                >
                  {copy.page.tabDisputes}
                </button>
              </div>

              {tab !== "cycles" ? (
                <StreamsFilterToolbar
                  locale={locale}
                  tab={tab}
                  searchDraft={searchDraft}
                  setSearchDraft={setSearchDraft}
                  onCommitSearch={commitSearch}
                  onClearSearch={clearSearch}
                  hasAdvancedFilters={hasAdvancedFilters}
                  showAdvancedFilters={showAdvancedFilters}
                  onToggleAdvancedFilters={() => setShowAdvancedFilters((prev) => !prev)}
                  taskSort={taskSort}
                  taskOrder={taskOrder}
                  agentSort={agentSort}
                  agentOrder={agentOrder}
                  disputeStatus={disputeStatus}
                  disputeSort={disputeSort}
                  disputeOrder={disputeOrder}
                  activeOnly={activeOnly}
                  taskStatus={taskStatus}
                  onUpdateQuery={updateQuery}
                  onResetFilters={resetFilters}
                />
              ) : null}

              <div className="stream-panel" id={panelId} role="tabpanel" aria-labelledby={`stream-tab-${tab}`}>
                {tab === "tasks" ? (
                  <TaskListPanel
                    locale={locale}
                    timeZone={timeZone}
                    tasks={tasksData.items}
                    taskAllCount={taskAllCount}
                    taskStatus={taskStatus}
                    taskStatusCounts={taskStatusCounts}
                    hasTaskFilters={hasTaskFilters}
                    loadingTasks={loadingTasks}
                    loadingMoreTasks={loadingMoreTasks}
                    taskLoadError={taskLoadError}
                    taskLoadErrorKind={taskLoadErrorKind}
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
                    agentLoadErrorKind={agentLoadErrorKind}
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
                    cycleLoadErrorKind={cycleLoadErrorKind}
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
                    disputeLoadErrorKind={disputeLoadErrorKind}
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
          ) : null}
        </div>
      </main>
    </>
  );
};
