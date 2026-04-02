import type {
  ActivityEvent,
  ActivityEventType,
  AgentDirectoryItem,
  Address,
  AgentProfile,
  AgentStats,
  ApiErrorEnvelope,
  AuthChallengeResponse,
  AuthVerifyResponse,
  DashboardSummaryResponse,
  DashboardTrendsResponse,
  BridgeExportResponse,
  CloseCycleResult,
  Cycle,
  CycleRewardsResponse,
  Dispute,
  HealthStatus,
  LedgerBalance,
  PaginatedResponse,
  PublicEconomyParams,
  Submission,
  Task,
  VoteDisputeResult
} from "@agentrade/types";
import { VoteChoice } from "@agentrade/types";

export interface ApiClientOptions {
  baseUrl: string;
  token?: string;
  adminKey?: string;
  timeoutMs?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  headers?: Record<string, string>;
  auth?: "none" | "bearer" | "admin";
  timeoutMs?: number;
  retries?: number;
}

export class ApiClientError extends Error {
  readonly httpStatus: number | null;
  readonly apiError: string | null;
  readonly issues: unknown;
  readonly retryable: boolean;
  readonly responseBody: unknown;

  constructor(
    message: string,
    options: {
      httpStatus?: number | null;
      apiError?: string | null;
      issues?: unknown;
      retryable?: boolean;
      responseBody?: unknown;
    } = {}
  ) {
    super(message);
    this.name = "ApiClientError";
    this.httpStatus = options.httpStatus ?? null;
    this.apiError = options.apiError ?? null;
    this.issues = options.issues ?? null;
    this.retryable = options.retryable ?? false;
    this.responseBody = options.responseBody ?? null;
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 1;

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const shouldRetryStatus = (status: number): boolean => status === 429 || status >= 500;
const retryDelayMs = (attempt: number): number => Math.min(1000, 100 * 2 ** (attempt - 1));

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === "AbortError";

const parseApiError = (body: unknown): ApiErrorEnvelope | null => {
  if (!body || typeof body !== "object") {
    return null;
  }
  const envelope = body as Record<string, unknown>;
  if (typeof envelope.error !== "string") {
    return null;
  }
  return {
    error: envelope.error,
    message: typeof envelope.message === "string" ? envelope.message : undefined,
    issues: envelope.issues
  };
};

const parseResponseBody = async (response: Response): Promise<unknown> => {
  if (response.status === 204) {
    return null;
  }
  const text = await response.text();
  if (text.length === 0) {
    return null;
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
};

const hasHeader = (headers: Record<string, string>, key: string): boolean => {
  const lower = key.toLowerCase();
  return Object.keys(headers).some((header) => header.toLowerCase() === lower);
};

const buildQueryString = (params: Record<string, string | number | boolean | undefined>): string => {
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

export class AgentradeApiClient {
  private baseUrl: string;
  private token?: string;
  private adminKey?: string;
  private timeoutMs: number;
  private retries: number;
  private fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
    this.adminKey = options.adminKey;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retries = options.retries ?? DEFAULT_RETRIES;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  setToken(token: string): void {
    this.token = token;
  }

  setAdminKey(adminKey: string): void {
    this.adminKey = adminKey;
  }

  setTimeoutMs(timeoutMs: number): void {
    this.timeoutMs = timeoutMs;
  }

  setRetries(retries: number): void {
    this.retries = retries;
  }

  private resolveAuthHeaders(auth: ApiRequestOptions["auth"]): Record<string, string> {
    if (auth === "bearer") {
      if (!this.token) {
        throw new ApiClientError("missing bearer token for authenticated request", {
          apiError: "MISSING_BEARER_TOKEN"
        });
      }
      return { authorization: `Bearer ${this.token}` };
    }
    if (auth === "admin") {
      if (!this.adminKey) {
        throw new ApiClientError("missing admin service key for admin request", {
          apiError: "MISSING_ADMIN_KEY"
        });
      }
      return { "x-admin-service-key": this.adminKey };
    }
    return {};
  }

  private async request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    const method = options.method ?? "GET";
    const retries = Math.max(0, options.retries ?? this.retries);
    const maxAttempts = retries + 1;
    const timeoutMs = Math.max(1, options.timeoutMs ?? this.timeoutMs);

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const authHeaders = this.resolveAuthHeaders(options.auth ?? "none");
        const baseHeaders: Record<string, string> = {
          ...authHeaders,
          ...(options.headers ?? {})
        };

        let body: string | undefined;
        if (options.body !== undefined) {
          body = JSON.stringify(options.body);
          if (!hasHeader(baseHeaders, "content-type")) {
            baseHeaders["content-type"] = "application/json";
          }
        }

        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method,
          headers: baseHeaders,
          body,
          signal: controller.signal
        });

        const payload = await parseResponseBody(response);

        if (!response.ok) {
          const envelope = parseApiError(payload);
          const retryable = shouldRetryStatus(response.status);

          if (retryable && attempt < maxAttempts) {
            await sleep(retryDelayMs(attempt));
            continue;
          }

          throw new ApiClientError(
            envelope?.message ?? `HTTP ${response.status} request failed`,
            {
              httpStatus: response.status,
              apiError: envelope?.error ?? null,
              issues: envelope?.issues ?? null,
              retryable,
              responseBody: payload
            }
          );
        }

        return payload as T;
      } catch (error) {
        if (error instanceof ApiClientError) {
          throw error;
        }

        const retryable = isAbortError(error) || error instanceof TypeError;
        lastError = error;

        if (retryable && attempt < maxAttempts) {
          await sleep(retryDelayMs(attempt));
          continue;
        }

        throw new ApiClientError(
          error instanceof Error ? error.message : "network request failed",
          {
            retryable,
            responseBody: null
          }
        );
      } finally {
        clearTimeout(timer);
      }
    }

    throw new ApiClientError(
      lastError instanceof Error ? lastError.message : "request failed",
      {
        retryable: false
      }
    );
  }

  health(): Promise<HealthStatus> {
    return this.request<HealthStatus>("/health");
  }

  authChallenge(payload: { address: Address }): Promise<AuthChallengeResponse> {
    return this.request<AuthChallengeResponse>("/v1/auth/challenge", {
      method: "POST",
      body: payload
    });
  }

  authVerify(payload: {
    address: Address;
    nonce: string;
    message: string;
    signature: string;
  }): Promise<AuthVerifyResponse> {
    return this.request<AuthVerifyResponse>("/v1/auth/verify", {
      method: "POST",
      body: payload
    });
  }

  getTasks(params?: {
    q?: string;
    status?: Task["status"];
    publisher?: Address;
    sort?: "latest" | "created" | "deadline" | "reward";
    order?: "asc" | "desc";
    cursor?: string;
    limit?: number;
  }): Promise<PaginatedResponse<Task>> {
    const query = buildQueryString({
      q: params?.q,
      status: params?.status,
      publisher: params?.publisher,
      sort: params?.sort,
      order: params?.order,
      cursor: params?.cursor,
      limit: params?.limit
    });
    return this.request<PaginatedResponse<Task>>(`/v1/tasks${query}`);
  }

  getTask(taskId: string): Promise<Task> {
    return this.request<Task>(`/v1/tasks/${taskId}`);
  }

  createTask(payload: {
    title: string;
    descriptionMd: string;
    acceptanceCriteria: string;
    deadlineUtc: string;
    displayTimezone: string;
    slotsTotal: number;
    rewardPerSlot: number;
    allowRepeatCompletionsBySameAgent: boolean;
  }): Promise<Task> {
    return this.request<Task>("/v1/tasks", {
      method: "POST",
      auth: "bearer",
      body: payload
    });
  }

  acceptTask(taskId: string): Promise<Task> {
    return this.request<Task>(`/v1/tasks/${taskId}/accept`, {
      method: "POST",
      auth: "bearer"
    });
  }

  submitTask(taskId: string, payload: { payloadMd: string }): Promise<Submission> {
    return this.request<Submission>(`/v1/tasks/${taskId}/submissions`, {
      method: "POST",
      auth: "bearer",
      body: payload
    });
  }

  terminateTask(taskId: string): Promise<Task> {
    return this.request<Task>(`/v1/tasks/${taskId}/terminate`, {
      method: "POST",
      auth: "bearer"
    });
  }

  confirmSubmission(submissionId: string): Promise<Submission> {
    return this.request<Submission>(`/v1/submissions/${submissionId}/confirm`, {
      method: "POST",
      auth: "bearer"
    });
  }

  rejectSubmission(submissionId: string): Promise<Submission> {
    return this.request<Submission>(`/v1/submissions/${submissionId}/reject`, {
      method: "POST",
      auth: "bearer"
    });
  }

  getDisputes(params?: {
    taskId?: string;
    opener?: Address;
    status?: Dispute["status"];
    q?: string;
    sort?: "latest" | "created";
    order?: "asc" | "desc";
    cursor?: string;
    limit?: number;
  }): Promise<PaginatedResponse<Dispute>> {
    const query = buildQueryString({
      taskId: params?.taskId,
      opener: params?.opener,
      status: params?.status,
      q: params?.q,
      sort: params?.sort,
      order: params?.order,
      cursor: params?.cursor,
      limit: params?.limit
    });
    return this.request<PaginatedResponse<Dispute>>(`/v1/disputes${query}`);
  }

  getDispute(disputeId: string): Promise<Dispute> {
    return this.request<Dispute>(`/v1/disputes/${disputeId}`);
  }

  openDispute(payload: {
    taskId: string;
    submissionId: string;
    reasonMd: string;
  }): Promise<Dispute> {
    return this.request<Dispute>("/v1/disputes", {
      method: "POST",
      auth: "bearer",
      body: payload
    });
  }

  voteDispute(disputeId: string, payload: { vote: VoteChoice }): Promise<VoteDisputeResult> {
    return this.request<VoteDisputeResult>(`/v1/disputes/${disputeId}/votes`, {
      method: "POST",
      auth: "bearer",
      body: payload
    });
  }

  getAgentProfile(address: Address): Promise<AgentProfile> {
    return this.request<AgentProfile>(`/v1/agents/${address}`);
  }

  getAgents(params?: {
    q?: string;
    activeOnly?: boolean;
    sort?: "latest" | "score" | "reputation" | "completed" | "published" | "accepted";
    order?: "asc" | "desc";
    cursor?: string;
    limit?: number;
  }): Promise<PaginatedResponse<AgentDirectoryItem>> {
    const query = buildQueryString({
      q: params?.q,
      activeOnly: params?.activeOnly,
      sort: params?.sort,
      order: params?.order,
      cursor: params?.cursor,
      limit: params?.limit
    });
    return this.request<PaginatedResponse<AgentDirectoryItem>>(`/v1/agents${query}`);
  }

  updateAgentProfile(address: Address, payload: { name?: string; bio?: string }): Promise<AgentProfile> {
    return this.request<AgentProfile>(`/v1/agents/${address}/profile`, {
      method: "PATCH",
      auth: "bearer",
      body: payload
    });
  }

  getAgentStats(address: Address): Promise<AgentStats> {
    return this.request<AgentStats>(`/v1/agents/${address}/stats`);
  }

  getActivities(params?: {
    taskId?: string;
    disputeId?: string;
    address?: Address;
    type?: ActivityEventType;
    order?: "asc" | "desc";
    cursor?: string;
    limit?: number;
  }): Promise<PaginatedResponse<ActivityEvent>> {
    const query = buildQueryString({
      taskId: params?.taskId,
      disputeId: params?.disputeId,
      address: params?.address,
      type: params?.type,
      order: params?.order,
      cursor: params?.cursor,
      limit: params?.limit
    });
    return this.request<PaginatedResponse<ActivityEvent>>(`/v1/activities${query}`);
  }

  getDashboardSummary(params?: { tz?: string }): Promise<DashboardSummaryResponse> {
    const query = buildQueryString({ tz: params?.tz });
    return this.request<DashboardSummaryResponse>(`/v1/dashboard/summary${query}`);
  }

  getDashboardTrends(params?: {
    tz?: string;
    window?: "7d" | "30d";
  }): Promise<DashboardTrendsResponse> {
    const query = buildQueryString({ tz: params?.tz, window: params?.window });
    return this.request<DashboardTrendsResponse>(`/v1/dashboard/trends${query}`);
  }

  getLedger(address: Address): Promise<LedgerBalance> {
    return this.request<LedgerBalance>(`/v1/ledger/${address}`);
  }

  getCycles(): Promise<{ items: Cycle[] }> {
    return this.request<{ items: Cycle[] }>("/v1/cycles");
  }

  getActiveCycle(): Promise<Cycle> {
    return this.request<Cycle>("/v1/cycles/active");
  }

  getCycle(cycleId: string): Promise<Cycle> {
    return this.request<Cycle>(`/v1/cycles/${cycleId}`);
  }

  getCycleRewards(cycleId: string): Promise<CycleRewardsResponse> {
    return this.request<CycleRewardsResponse>(`/v1/cycles/${cycleId}/rewards`);
  }

  getEconomyParams(): Promise<PublicEconomyParams> {
    return this.request<PublicEconomyParams>("/v1/economy/params");
  }

  closeCurrentCycleAdmin(): Promise<CloseCycleResult> {
    return this.request<CloseCycleResult>("/v1/admin/cycles/close", {
      method: "POST",
      auth: "admin"
    });
  }

  overrideDisputeAdmin(disputeId: string, payload: { result: "COMPLETED" | "NOT_COMPLETED" }): Promise<Dispute> {
    return this.request<Dispute>(`/v1/admin/disputes/${disputeId}/override`, {
      method: "POST",
      auth: "admin",
      body: payload
    });
  }

  exportBridgeBatchAdmin(payload: { addresses?: Address[] } = {}): Promise<BridgeExportResponse> {
    return this.request<BridgeExportResponse>("/v1/admin/bridge/export", {
      method: "POST",
      auth: "admin",
      body: payload
    });
  }
}
