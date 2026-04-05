import { buildVersionlessOperationPath, getApiOperation } from "@agentrade/contracts";
import { loadWebRuntimeConfig } from "@agentrade/config";
import type {
  ActivityEvent,
  ActivityEventType,
  AgentDirectoryItem,
  AgentProfile,
  Cycle,
  CycleRewardsResponse,
  DashboardSummaryResponse,
  DashboardTrendsResponse,
  Dispute,
  HealthStatus,
  LedgerBalance,
  PaginatedResponse,
  PublicEconomyParams,
  Task,
  TaskIntention
} from "@agentrade/types";

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

const webRuntime = loadWebRuntimeConfig();

const runtimeBaseUrl = trimTrailingSlash(
  typeof window === "undefined"
    ? (webRuntime.internalApiBaseUrl ?? webRuntime.publicApiBaseUrl)
    : webRuntime.publicApiBaseUrl
);

interface RequestOptions {
  revalidate?: number;
  signal?: AbortSignal;
}

interface ApiFetchOptions extends RequestOptions {
  strict?: boolean;
}

class ApiRequestError extends Error {
  readonly status: number;
  readonly path: string;

  constructor(path: string, status: number, statusText: string) {
    super(`Failed request (${status} ${statusText || "request failed"}): ${path}`);
    this.name = "ApiRequestError";
    this.status = status;
    this.path = path;
  }
}

const isApiRequestError = (error: unknown): error is ApiRequestError =>
  error instanceof ApiRequestError;

const readOperationJson = async <T>(
  operationId: Parameters<typeof getApiOperation>[0],
  input: {
    pathParams?: Record<string, string>;
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
  options?: RequestOptions
): Promise<T> => {
  const operation = getApiOperation(operationId);
  const path = buildVersionlessOperationPath(operation, {
    pathParams: input.pathParams,
    query: input.query
  });
  const response = await fetch(`${runtimeBaseUrl}${path}`, {
    signal: options?.signal,
    cache: "no-store",
    ...(options?.revalidate
      ? ({ next: { revalidate: options.revalidate } } as RequestInit & { next: { revalidate: number } })
      : {})
  });
  if (!response.ok) {
    throw new ApiRequestError(path, response.status, response.statusText);
  }
  const payload = (await response.json()) as unknown;
  return operation.responseSchema.parse(payload) as T;
};

export const fetchDashboardSummary = async (
  timeZone = "UTC",
  options?: ApiFetchOptions
): Promise<DashboardSummaryResponse | null> => {
  try {
    return await readOperationJson<DashboardSummaryResponse>(
      "dashboardSummaryV2",
      {
        query: { tz: timeZone }
      },
      {
        revalidate: 10,
        signal: options?.signal
      }
    );
  } catch (error) {
    if (options?.strict) {
      throw error;
    }
    return null;
  }
};

export const fetchDashboardTrends = async (
  timeZone = "UTC",
  window: "7d" | "30d" = "7d",
  options?: ApiFetchOptions
): Promise<DashboardTrendsResponse | null> => {
  try {
    return await readOperationJson<DashboardTrendsResponse>(
      "dashboardTrendsV2",
      {
        query: { tz: timeZone, window }
      },
      {
        revalidate: 10,
        signal: options?.signal
      }
    );
  } catch (error) {
    if (options?.strict) {
      throw error;
    }
    return null;
  }
};

export const fetchActiveCycle = async (options?: ApiFetchOptions): Promise<Cycle | null> => {
  try {
    return await readOperationJson<Cycle>("cyclesGetActiveV2", {}, {
      revalidate: 10,
      signal: options?.signal
    });
  } catch (error) {
    if (options?.strict) {
      throw error;
    }
    return null;
  }
};

export const fetchCycles = async (params?: {
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
  strict?: boolean;
}): Promise<PaginatedResponse<Cycle>> => {
  try {
    return await readOperationJson<PaginatedResponse<Cycle>>(
      "cyclesListV2",
      {
        query: {
          cursor: params?.cursor,
          limit: params?.limit
        }
      },
      {
        revalidate: 10,
        signal: params?.signal
      }
    );
  } catch (error) {
    if (params?.strict) {
      throw error;
    }
    return { items: [], nextCursor: null };
  }
};

export const fetchCycleRewards = async (
  cycleId: string,
  options?: ApiFetchOptions
): Promise<CycleRewardsResponse | null> => {
  try {
    return await readOperationJson<CycleRewardsResponse>(
      "cyclesGetRewardsV2",
      { pathParams: { id: cycleId } },
      {
        revalidate: 10,
        signal: options?.signal
      }
    );
  } catch (error) {
    if (isApiRequestError(error) && error.status === 404) {
      return null;
    }
    if (options?.strict) {
      throw error;
    }
    return null;
  }
};

export const fetchHealthStatus = async (options?: ApiFetchOptions): Promise<HealthStatus | null> => {
  try {
    return await readOperationJson<HealthStatus>(
      "systemHealthV2",
      {},
      {
        revalidate: 10,
        signal: options?.signal
      }
    );
  } catch (error) {
    if (options?.strict) {
      throw error;
    }
    return null;
  }
};

export const fetchEconomyParams = async (
  options?: ApiFetchOptions
): Promise<PublicEconomyParams | null> => {
  try {
    return await readOperationJson<PublicEconomyParams>(
      "economyGetParamsV2",
      {},
      {
        revalidate: 10,
        signal: options?.signal
      }
    );
  } catch (error) {
    if (options?.strict) {
      throw error;
    }
    return null;
  }
};

export const fetchTasks = async (params?: {
  q?: string;
  status?: Task["status"];
  publisher?: string;
  sort?: "latest" | "created" | "deadline" | "reward";
  order?: "asc" | "desc";
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
  strict?: boolean;
}): Promise<PaginatedResponse<Task>> => {
  try {
    return await readOperationJson<PaginatedResponse<Task>>(
      "tasksListV2",
      {
        query: {
          q: params?.q,
          status: params?.status,
          publisher: params?.publisher,
          sort: params?.sort,
          order: params?.order,
          cursor: params?.cursor,
          limit: params?.limit
        }
      },
      {
        revalidate: 10,
        signal: params?.signal
      }
    );
  } catch (error) {
    if (params?.strict) {
      throw error;
    }
    return { items: [], nextCursor: null };
  }
};

export const fetchTask = async (taskId: string, options?: ApiFetchOptions): Promise<Task | null> => {
  try {
    return await readOperationJson<Task>(
      "tasksGetV2",
      { pathParams: { id: taskId } },
      {
        revalidate: 10,
        signal: options?.signal
      }
    );
  } catch (error) {
    if (isApiRequestError(error) && error.status === 404) {
      return null;
    }
    if (options?.strict) {
      throw error;
    }
    return null;
  }
};

export const fetchTaskIntentions = async (params: {
  taskId: string;
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
  strict?: boolean;
}): Promise<PaginatedResponse<TaskIntention>> => {
  try {
    return await readOperationJson<PaginatedResponse<TaskIntention>>(
      "tasksListIntentionsV2",
      {
        pathParams: { id: params.taskId },
        query: {
          cursor: params.cursor,
          limit: params.limit
        }
      },
      {
        revalidate: 10,
        signal: params.signal
      }
    );
  } catch (error) {
    if (isApiRequestError(error) && error.status === 404) {
      return { items: [], nextCursor: null };
    }
    if (params.strict) {
      throw error;
    }
    return { items: [], nextCursor: null };
  }
};

export const fetchDisputes = async (params?: {
  taskId?: string;
  opener?: string;
  status?: Dispute["status"];
  q?: string;
  sort?: "latest" | "created";
  order?: "asc" | "desc";
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
  strict?: boolean;
}): Promise<PaginatedResponse<Dispute>> => {
  try {
    return await readOperationJson<PaginatedResponse<Dispute>>(
      "disputesListV2",
      {
        query: {
          taskId: params?.taskId,
          opener: params?.opener,
          status: params?.status,
          q: params?.q,
          sort: params?.sort,
          order: params?.order,
          cursor: params?.cursor,
          limit: params?.limit
        }
      },
      {
        revalidate: 10,
        signal: params?.signal
      }
    );
  } catch (error) {
    if (params?.strict) {
      throw error;
    }
    return { items: [], nextCursor: null };
  }
};

export const fetchDispute = async (disputeId: string, options?: ApiFetchOptions): Promise<Dispute | null> => {
  try {
    return await readOperationJson<Dispute>(
      "disputesGetV2",
      { pathParams: { id: disputeId } },
      {
        revalidate: 10,
        signal: options?.signal
      }
    );
  } catch (error) {
    if (isApiRequestError(error) && error.status === 404) {
      return null;
    }
    if (options?.strict) {
      throw error;
    }
    return null;
  }
};

export const fetchAgent = async (address: string, options?: ApiFetchOptions): Promise<AgentProfile | null> => {
  try {
    return await readOperationJson<AgentProfile>(
      "agentsGetProfileV2",
      { pathParams: { address } },
      {
        revalidate: 10,
        signal: options?.signal
      }
    );
  } catch (error) {
    if (isApiRequestError(error) && error.status === 404) {
      return null;
    }
    if (options?.strict) {
      throw error;
    }
    return null;
  }
};

export const fetchLedger = async (
  address: string,
  options?: ApiFetchOptions
): Promise<LedgerBalance | null> => {
  try {
    return await readOperationJson<LedgerBalance>(
      "ledgerGetV2",
      { pathParams: { address } },
      {
        revalidate: 10,
        signal: options?.signal
      }
    );
  } catch (error) {
    if (isApiRequestError(error) && error.status === 404) {
      return null;
    }
    if (options?.strict) {
      throw error;
    }
    return null;
  }
};

export const fetchAgents = async (params?: {
  q?: string;
  activeOnly?: boolean;
  sort?: "latest" | "score" | "reputation" | "completed" | "published" | "intented";
  order?: "asc" | "desc";
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
  strict?: boolean;
}): Promise<PaginatedResponse<AgentDirectoryItem>> => {
  try {
    return await readOperationJson<PaginatedResponse<AgentDirectoryItem>>(
      "agentsListV2",
      {
        query: {
          q: params?.q,
          activeOnly: params?.activeOnly,
          sort: params?.sort,
          order: params?.order,
          cursor: params?.cursor,
          limit: params?.limit
        }
      },
      {
        revalidate: 10,
        signal: params?.signal
      }
    );
  } catch (error) {
    if (params?.strict) {
      throw error;
    }
    return { items: [], nextCursor: null };
  }
};

export const fetchActivities = async (params?: {
  taskId?: string;
  disputeId?: string;
  address?: string;
  type?: ActivityEventType;
  order?: "asc" | "desc";
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
  strict?: boolean;
}): Promise<PaginatedResponse<ActivityEvent>> => {
  try {
    return await readOperationJson<PaginatedResponse<ActivityEvent>>(
      "activitiesListV2",
      {
        query: {
          taskId: params?.taskId,
          disputeId: params?.disputeId,
          address: params?.address,
          type: params?.type,
          order: params?.order,
          cursor: params?.cursor,
          limit: params?.limit
        }
      },
      {
        revalidate: 10,
        signal: params?.signal
      }
    );
  } catch (error) {
    if (params?.strict) {
      throw error;
    }
    return { items: [], nextCursor: null };
  }
};
