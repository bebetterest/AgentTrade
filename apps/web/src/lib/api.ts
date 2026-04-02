import type {
  ActivityEvent,
  ActivityEventType,
  AgentDirectoryItem,
  AgentProfile,
  Cycle,
  DashboardSummaryResponse,
  DashboardTrendsResponse,
  Dispute,
  PaginatedResponse,
  Task
} from "@agentrade/types";

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

const runtimeBaseUrl = trimTrailingSlash(
  typeof window === "undefined"
    ? (process.env.INTERNAL_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000")
    : (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000")
);

const buildQuery = (params: Record<string, string | number | boolean | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) {
      continue;
    }
    search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized.length > 0 ? `?${serialized}` : "";
};

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

const readJson = async <T>(path: string, options?: RequestOptions): Promise<T> => {
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
  return (await response.json()) as T;
};

export const fetchDashboardSummary = async (
  timeZone = "UTC",
  options?: ApiFetchOptions
): Promise<DashboardSummaryResponse | null> => {
  try {
    return await readJson<DashboardSummaryResponse>(
      `/v1/dashboard/summary${buildQuery({ tz: timeZone })}`,
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
    return await readJson<DashboardTrendsResponse>(
      `/v1/dashboard/trends${buildQuery({ tz: timeZone, window })}`,
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
    return await readJson<Cycle>("/v1/cycles/active", {
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
    return await readJson<PaginatedResponse<Task>>(
      `/v1/tasks${buildQuery({
        q: params?.q,
        status: params?.status,
        publisher: params?.publisher,
        sort: params?.sort,
        order: params?.order,
        cursor: params?.cursor,
        limit: params?.limit
      })}`,
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
    return await readJson<Task>(`/v1/tasks/${taskId}`, {
      revalidate: 10,
      signal: options?.signal
    });
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
    return await readJson<PaginatedResponse<Dispute>>(
      `/v1/disputes${buildQuery({
        taskId: params?.taskId,
        opener: params?.opener,
        status: params?.status,
        q: params?.q,
        sort: params?.sort,
        order: params?.order,
        cursor: params?.cursor,
        limit: params?.limit
      })}`,
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

export const fetchAgent = async (address: string, options?: ApiFetchOptions): Promise<AgentProfile | null> => {
  try {
    return await readJson<AgentProfile>(`/v1/agents/${address}`, {
      revalidate: 10,
      signal: options?.signal
    });
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
  sort?: "latest" | "score" | "reputation" | "completed" | "published" | "accepted";
  order?: "asc" | "desc";
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
  strict?: boolean;
}): Promise<PaginatedResponse<AgentDirectoryItem>> => {
  try {
    return await readJson<PaginatedResponse<AgentDirectoryItem>>(
      `/v1/agents${buildQuery({
        q: params?.q,
        activeOnly: params?.activeOnly,
        sort: params?.sort,
        order: params?.order,
        cursor: params?.cursor,
        limit: params?.limit
      })}`,
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
    return await readJson<PaginatedResponse<ActivityEvent>>(
      `/v1/activities${buildQuery({
        taskId: params?.taskId,
        disputeId: params?.disputeId,
        address: params?.address,
        type: params?.type,
        order: params?.order,
        cursor: params?.cursor,
        limit: params?.limit
      })}`,
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
