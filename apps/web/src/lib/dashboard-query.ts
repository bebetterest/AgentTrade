import { TaskStatus } from "@agentrade/types";

export type DashboardTab = "tasks" | "users" | "cycles";
export type SortOrder = "asc" | "desc";
export type TaskSort = "latest" | "created" | "deadline" | "reward";
export type AgentSort = "latest" | "score" | "reputation" | "completed" | "published" | "accepted";
export type TrendWindow = "7d" | "30d";

const DEFAULT_TAB: DashboardTab = "tasks";
const DEFAULT_SORT_ORDER: SortOrder = "desc";
const DEFAULT_TASK_SORT: TaskSort = "latest";
const DEFAULT_AGENT_SORT: AgentSort = "latest";
const DEFAULT_TREND_WINDOW: TrendWindow = "7d";
const MAX_SEARCH_QUERY_LENGTH = 80;

const TASK_STATUS_VALUES = new Set<string>(Object.values(TaskStatus));
const TASK_SORT_VALUES = new Set<string>(["latest", "created", "deadline", "reward"]);
const AGENT_SORT_VALUES = new Set<string>(["latest", "score", "reputation", "completed", "published", "accepted"]);
const SORT_ORDER_VALUES = new Set<string>(["asc", "desc"]);

interface SearchParamsReader {
  get(key: string): string | null;
}

const normalizeQuery = (value: string | null): string => {
  if (!value) {
    return "";
  }
  return value.trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
};

const toTaskStatus = (value: string | null): TaskStatus | null => {
  if (!value || !TASK_STATUS_VALUES.has(value)) {
    return null;
  }
  return value as TaskStatus;
};

const toSortOrder = (value: string | null, fallback = DEFAULT_SORT_ORDER): SortOrder => {
  if (!value || !SORT_ORDER_VALUES.has(value)) {
    return fallback;
  }
  return value as SortOrder;
};

const toTaskSort = (value: string | null): TaskSort => {
  if (!value || !TASK_SORT_VALUES.has(value)) {
    return DEFAULT_TASK_SORT;
  }
  return value as TaskSort;
};

const toAgentSort = (value: string | null): AgentSort => {
  if (!value || !AGENT_SORT_VALUES.has(value)) {
    return DEFAULT_AGENT_SORT;
  }
  return value as AgentSort;
};

const toTrendWindow = (value: string | null): TrendWindow => (value === "30d" ? "30d" : DEFAULT_TREND_WINDOW);

const toBooleanParam = (value: string | null, fallback: boolean): boolean => {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return fallback;
};

const toTab = (value: string | null): DashboardTab => {
  if (value === "users" || value === "cycles") {
    return value;
  }
  return DEFAULT_TAB;
};

const normalizeIdentifier = (value: string | null): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export interface DashboardQueryState {
  tab: DashboardTab;
  q: string;
  taskStatus: TaskStatus | null;
  taskSort: TaskSort;
  taskOrder: SortOrder;
  agentSort: AgentSort;
  agentOrder: SortOrder;
  activeOnly: boolean;
  trendWindow: TrendWindow;
  taskDetailId: string | null;
  agentDetailAddress: string | null;
  cycleDetailId: string | null;
}

export const parseDashboardQuery = (searchParams: SearchParamsReader): DashboardQueryState => {
  return {
    tab: toTab(searchParams.get("tab")),
    q: normalizeQuery(searchParams.get("q")),
    taskStatus: toTaskStatus(searchParams.get("taskStatus")),
    taskSort: toTaskSort(searchParams.get("taskSort")),
    taskOrder: toSortOrder(searchParams.get("taskOrder")),
    agentSort: toAgentSort(searchParams.get("agentSort")),
    agentOrder: toSortOrder(searchParams.get("agentOrder")),
    activeOnly: toBooleanParam(searchParams.get("activeOnly"), true),
    trendWindow: toTrendWindow(searchParams.get("trendWindow")),
    taskDetailId: normalizeIdentifier(searchParams.get("taskDetail")),
    agentDetailAddress: normalizeIdentifier(searchParams.get("agentDetail")),
    cycleDetailId: normalizeIdentifier(searchParams.get("cycleDetail"))
  };
};

export const sanitizeQueryPatch = (patch: Record<string, string | null>): Record<string, string | null> => {
  const next = { ...patch };
  if ("q" in next) {
    next.q = normalizeQuery(next.q ?? null) || null;
  }
  if ("taskDetail" in next) {
    next.taskDetail = normalizeIdentifier(next.taskDetail ?? null);
  }
  if ("agentDetail" in next) {
    next.agentDetail = normalizeIdentifier(next.agentDetail ?? null);
  }
  if ("cycleDetail" in next) {
    next.cycleDetail = normalizeIdentifier(next.cycleDetail ?? null);
  }
  return next;
};
