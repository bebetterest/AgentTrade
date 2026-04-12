import {
  buildOperationPath,
  buildVersionlessOperationPath,
  getApiOperation,
  type ApiAuthMode,
  type ApiOperationId
} from "@agentrade/contracts";
import type {
  ActivityEvent,
  ActivityEventType,
  AgentDirectoryItem,
  Address,
  AgentProfile,
  AgentStats,
  AuthChallengeResponse,
  AuthVerifyResponse,
  Cycle,
  CycleRewardsResponse,
  DashboardSummaryResponse,
  DashboardTrendsResponse,
  Dispute,
  HealthStatus,
  LedgerBalance,
  PaginatedResponse,
  PublicEconomyParams,
  RuntimeRuleAuditRecord,
  RuntimeEditableRulesPatch,
  RuntimeSettingsState,
  ServiceMetricsResponse,
  SubmissionAttachment,
  Submission,
  Task,
  TaskIntention,
  VoteDisputeResult
} from "@agentrade/types";
import { VoteChoice } from "@agentrade/types";

export interface ApiClientOptions {
  baseUrl: string;
  token?: string;
  adminKey?: string;
  preferVersionlessPaths?: boolean;
  timeoutMs?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
}

export interface OperationRequestOptions {
  pathParams?: Record<string, string | number>;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  timeoutMs?: number;
  retries?: number;
  auth?: ApiAuthMode;
}

interface RawRequestOptions {
  method: "GET" | "POST" | "PATCH";
  path: string;
  auth: ApiAuthMode;
  body?: unknown;
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

const parseApiError = (
  body: unknown
): { code: string; message?: string; details?: unknown } | null => {
  if (!body || typeof body !== "object") {
    return null;
  }
  const envelope = body as Record<string, unknown>;
  if (typeof envelope.error === "string") {
    return {
      code: envelope.error,
      message: typeof envelope.message === "string" ? envelope.message : undefined,
      details: envelope.issues
    };
  }
  if (envelope.error && typeof envelope.error === "object") {
    const nested = envelope.error as Record<string, unknown>;
    if (typeof nested.code === "string") {
      return {
        code: nested.code,
        message: typeof nested.message === "string" ? nested.message : undefined,
        details: nested.details
      };
    }
  }
  return null;
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

export class AgentradeApiClient {
  private baseUrl: string;
  private token?: string;
  private adminKey?: string;
  private preferVersionlessPaths: boolean;
  private timeoutMs: number;
  private retries: number;
  private fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
    this.adminKey = options.adminKey;
    this.preferVersionlessPaths = options.preferVersionlessPaths ?? true;
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

  private resolveAuthHeaders(auth: ApiAuthMode): Record<string, string> {
    if (auth === "bearer") {
      if (!this.token) {
        throw new ApiClientError("missing bearer token for authenticated request", {
          apiError: "MISSING_BEARER_TOKEN"
        });
      }
      return { authorization: `Bearer ${this.token}` };
    }
    if (auth === "bearer_admin") {
      if (!this.token) {
        throw new ApiClientError("missing bearer token for authenticated request", {
          apiError: "MISSING_BEARER_TOKEN"
        });
      }
      if (!this.adminKey) {
        throw new ApiClientError("missing admin service key for admin-authenticated request", {
          apiError: "MISSING_ADMIN_KEY"
        });
      }
      return {
        authorization: `Bearer ${this.token}`,
        "x-admin-service-key": this.adminKey
      };
    }
    return {};
  }

  private async requestRaw<T>(options: RawRequestOptions): Promise<T> {
    const retries = Math.max(0, options.retries ?? this.retries);
    const maxAttempts = retries + 1;
    const timeoutMs = Math.max(1, options.timeoutMs ?? this.timeoutMs);

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const authHeaders = this.resolveAuthHeaders(options.auth);
        const headers: Record<string, string> = {
          ...authHeaders
        };

        let body: string | undefined;
        if (options.body !== undefined) {
          body = JSON.stringify(options.body);
          if (!hasHeader(headers, "content-type")) {
            headers["content-type"] = "application/json";
          }
        }

        const response = await this.fetchImpl(`${this.baseUrl}${options.path}`, {
          method: options.method,
          headers,
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
              apiError: envelope?.code ?? null,
              issues: envelope?.details ?? null,
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

    throw new ApiClientError(lastError instanceof Error ? lastError.message : "request failed", {
      retryable: false
    });
  }

  async requestOperation<T>(
    operationId: ApiOperationId,
    input: OperationRequestOptions = {}
  ): Promise<T> {
    const operation = getApiOperation(operationId);
    const path = this.preferVersionlessPaths
      ? buildVersionlessOperationPath(operation, {
          pathParams: input.pathParams,
          query: input.query
        })
      : buildOperationPath(operation, {
          pathParams: input.pathParams,
          query: input.query
        });
    const payload = await this.requestRaw<unknown>({
      method: operation.method,
      path,
      auth: input.auth ?? operation.auth,
      body: input.body,
      timeoutMs: input.timeoutMs,
      retries: input.retries
    });
    return operation.responseSchema.parse(payload) as T;
  }

  health(): Promise<HealthStatus> {
    return this.requestOperation<HealthStatus>("systemHealthV2");
  }

  metrics(): Promise<ServiceMetricsResponse> {
    return this.requestOperation<ServiceMetricsResponse>("systemMetricsV2");
  }

  authChallenge(payload: { address: Address }): Promise<AuthChallengeResponse> {
    return this.requestOperation<AuthChallengeResponse>("authChallengeV2", { body: payload });
  }

  authVerify(payload: {
    address: Address;
    nonce: string;
    message: string;
    signature: string;
  }): Promise<AuthVerifyResponse> {
    return this.requestOperation<AuthVerifyResponse>("authVerifyV2", { body: payload });
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
    return this.requestOperation<PaginatedResponse<Task>>("tasksListV2", { query: params });
  }

  getTask(taskId: string): Promise<Task> {
    return this.requestOperation<Task>("tasksGetV2", {
      pathParams: { id: taskId }
    });
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
    return this.requestOperation<Task>("tasksCreateV2", {
      body: payload
    });
  }

  getTaskIntentions(taskId: string, params?: { cursor?: string; limit?: number }): Promise<PaginatedResponse<TaskIntention>> {
    return this.requestOperation<PaginatedResponse<TaskIntention>>("tasksListIntentionsV2", {
      pathParams: { id: taskId },
      query: params
    });
  }

  addTaskIntention(taskId: string): Promise<TaskIntention> {
    return this.requestOperation<TaskIntention>("tasksAddIntentionV2", {
      pathParams: { id: taskId }
    });
  }

  submitTask(
    taskId: string,
    payload: { payloadMd: string; attachments?: SubmissionAttachment[] }
  ): Promise<Submission> {
    return this.requestOperation<Submission>("tasksSubmitV2", {
      pathParams: { id: taskId },
      body: payload
    });
  }

  terminateTask(taskId: string): Promise<Task> {
    return this.requestOperation<Task>("tasksTerminateV2", {
      pathParams: { id: taskId }
    });
  }

  confirmSubmission(submissionId: string): Promise<Submission> {
    return this.requestOperation<Submission>("submissionsConfirmV2", {
      pathParams: { id: submissionId }
    });
  }

  rejectSubmission(submissionId: string, payload: { reasonMd: string }): Promise<Submission> {
    return this.requestOperation<Submission>("submissionsRejectV2", {
      pathParams: { id: submissionId },
      body: payload
    });
  }

  getSubmissions(params?: {
    taskId?: string;
    agent?: Address;
    status?: Submission["status"];
    q?: string;
    sort?: "latest" | "created";
    order?: "asc" | "desc";
    cursor?: string;
    limit?: number;
  }): Promise<PaginatedResponse<Submission>> {
    return this.requestOperation<PaginatedResponse<Submission>>("submissionsListV2", {
      query: params
    });
  }

  getSubmission(submissionId: string): Promise<Submission> {
    return this.requestOperation<Submission>("submissionsGetV2", {
      pathParams: { id: submissionId }
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
    return this.requestOperation<PaginatedResponse<Dispute>>("disputesListV2", {
      query: params
    });
  }

  getDispute(disputeId: string): Promise<Dispute> {
    return this.requestOperation<Dispute>("disputesGetV2", {
      pathParams: { id: disputeId }
    });
  }

  openDispute(payload: {
    taskId: string;
    submissionId: string;
    reasonMd: string;
  }): Promise<Dispute> {
    return this.requestOperation<Dispute>("disputesOpenV2", {
      body: payload
    });
  }

  voteDispute(disputeId: string, payload: { vote: VoteChoice }): Promise<VoteDisputeResult> {
    return this.requestOperation<VoteDisputeResult>("disputesVoteV2", {
      pathParams: { id: disputeId },
      body: payload
    });
  }

  respondDispute(disputeId: string, payload: { reasonMd: string }): Promise<Dispute> {
    return this.requestOperation<Dispute>("disputesRespondV2", {
      pathParams: { id: disputeId },
      body: payload
    });
  }

  getAgentProfile(address: Address): Promise<AgentProfile> {
    return this.requestOperation<AgentProfile>("agentsGetProfileV2", {
      pathParams: { address }
    });
  }

  getAgents(params?: {
    q?: string;
    activeOnly?: boolean;
    sort?: "latest" | "score" | "reputation" | "completed" | "published" | "intented";
    order?: "asc" | "desc";
    cursor?: string;
    limit?: number;
  }): Promise<PaginatedResponse<AgentDirectoryItem>> {
    return this.requestOperation<PaginatedResponse<AgentDirectoryItem>>("agentsListV2", {
      query: params
    });
  }

  updateAgentProfile(address: Address, payload: { name?: string; bio?: string }): Promise<AgentProfile> {
    return this.requestOperation<AgentProfile>("agentsUpdateProfileV2", {
      pathParams: { address },
      body: payload
    });
  }

  getAgentStats(address: Address): Promise<AgentStats> {
    return this.requestOperation<AgentStats>("agentsGetStatsV2", {
      pathParams: { address }
    });
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
    return this.requestOperation<PaginatedResponse<ActivityEvent>>("activitiesListV2", {
      query: params
    });
  }

  getDashboardSummary(params?: { tz?: string }): Promise<DashboardSummaryResponse> {
    return this.requestOperation<DashboardSummaryResponse>("dashboardSummaryV2", {
      query: params
    });
  }

  getDashboardTrends(params?: { tz?: string; window?: "7d" | "30d" }): Promise<DashboardTrendsResponse> {
    return this.requestOperation<DashboardTrendsResponse>("dashboardTrendsV2", {
      query: params
    });
  }

  getLedger(address: Address): Promise<LedgerBalance> {
    return this.requestOperation<LedgerBalance>("ledgerGetV2", {
      pathParams: { address }
    });
  }

  getCycles(params?: { cursor?: string; limit?: number }): Promise<PaginatedResponse<Cycle>> {
    return this.requestOperation<PaginatedResponse<Cycle>>("cyclesListV2", {
      query: params
    });
  }

  getActiveCycle(): Promise<Cycle> {
    return this.requestOperation<Cycle>("cyclesGetActiveV2");
  }

  getCycle(cycleId: string): Promise<Cycle> {
    return this.requestOperation<Cycle>("cyclesGetV2", {
      pathParams: { id: cycleId }
    });
  }

  getCycleRewards(cycleId: string): Promise<CycleRewardsResponse> {
    return this.requestOperation<CycleRewardsResponse>("cyclesGetRewardsV2", {
      pathParams: { id: cycleId }
    });
  }

  getEconomyParams(): Promise<PublicEconomyParams> {
    return this.requestOperation<PublicEconomyParams>("economyGetParamsV2");
  }

  getRuntimeSettings(): Promise<RuntimeSettingsState> {
    return this.requestOperation<RuntimeSettingsState>("systemSettingsGetV2");
  }

  updateRuntimeSettings(payload: {
    applyTo: "current" | "next";
    patch: RuntimeEditableRulesPatch;
    reason?: string;
  }): Promise<RuntimeSettingsState> {
    return this.requestOperation<RuntimeSettingsState>("systemSettingsUpdateV2", {
      body: payload
    });
  }

  resetRuntimeSettings(payload: {
    applyTo: "current" | "next";
    reason?: string;
  }): Promise<RuntimeSettingsState> {
    return this.requestOperation<RuntimeSettingsState>("systemSettingsResetV2", {
      body: payload
    });
  }

  getRuntimeSettingsHistory(params?: {
    cursor?: string;
    limit?: number;
  }): Promise<PaginatedResponse<RuntimeRuleAuditRecord>> {
    return this.requestOperation<PaginatedResponse<RuntimeRuleAuditRecord>>(
      "systemSettingsHistoryV2",
      {
        query: params
      }
    );
  }
}
