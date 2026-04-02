import type { z } from "zod";
import {
  activityListQuerySchemaV1,
  activityListQuerySchemaV2,
  addressPathSchema,
  agentListQuerySchemaV1,
  agentListQuerySchemaV2,
  agentProfileSchema,
  agentStatsSchema,
  authChallengeRequestSchema,
  authChallengeResponseSchema,
  authVerifyRequestSchema,
  authVerifyResponseSchema,
  bridgeExportRequestSchema,
  bridgeExportResponseSchema,
  closeCycleResultSchema,
  createTaskRequestSchema,
  cycleListQuerySchemaV1,
  cycleListQuerySchemaV2,
  cycleRewardsResponseSchema,
  cycleSchema,
  dashboardSummaryQuerySchema,
  dashboardSummaryResponseSchema,
  dashboardTrendsQuerySchema,
  dashboardTrendsResponseSchema,
  disputeListQuerySchemaV1,
  disputeListQuerySchemaV2,
  disputeSchema,
  healthStatusSchema,
  idPathSchema,
  ledgerBalanceSchema,
  openDisputeRequestSchema,
  openApiSchemaComponents,
  overrideDisputeRequestSchema,
  paginatedActivityResponseSchema,
  paginatedAgentDirectoryResponseSchema,
  paginatedCycleResponseSchema,
  paginatedDisputeResponseSchema,
  paginatedTaskResponseSchema,
  publicEconomyParamsSchema,
  schemaRef,
  submitTaskRequestSchema,
  submissionSchema,
  taskListQuerySchemaV1,
  taskListQuerySchemaV2,
  taskSchema,
  updateAgentProfileRequestSchema,
  v1ApiErrorEnvelopeSchema,
  v2ApiErrorEnvelopeSchema,
  voteDisputeRequestSchema,
  voteDisputeResultSchema,
  type ContractSchema,
  type OpenApiSchemaObject
} from "./schemas.js";

export type ApiVersion = "v1" | "v2";
export type HttpMethod = "GET" | "POST" | "PATCH";
export type ApiAuthMode = "none" | "bearer" | "admin";
export type ErrorEnvelopeVersion = "v1" | "v2";

export interface OpenApiParameterObject {
  in: "path" | "query";
  name: string;
  required?: boolean;
  description?: {
    en: string;
    zh: string;
  };
  schema: OpenApiSchemaObject;
}

export interface ApiOperationDefinition {
  operationId: string;
  version: ApiVersion;
  method: HttpMethod;
  pathTemplate: string;
  tag: string;
  auth: ApiAuthMode;
  deprecated?: boolean;
  summary: {
    en: string;
    zh: string;
  };
  description?: {
    en: string;
    zh: string;
  };
  pathParamsSchema?: z.ZodTypeAny;
  querySchema?: z.ZodTypeAny;
  bodySchema?: z.ZodTypeAny;
  responseSchema: z.ZodTypeAny;
  responseComponent: ContractSchema | OpenApiSchemaObject;
  requestBodyComponent?: ContractSchema | OpenApiSchemaObject;
  parameters?: OpenApiParameterObject[];
  errorEnvelope: ErrorEnvelopeVersion;
  errorStatuses?: number[];
}

const apiParameter = (
  input: OpenApiParameterObject
): OpenApiParameterObject => input;

const queryStringParam = (
  name: string,
  schema: OpenApiSchemaObject,
  description: { en: string; zh: string },
  required = false
): OpenApiParameterObject =>
  apiParameter({
    in: "query",
    name,
    required,
    description,
    schema
  });

const pathStringParam = (
  name: string,
  description: { en: string; zh: string },
  schema: OpenApiSchemaObject = { type: "string", minLength: 1 }
): OpenApiParameterObject =>
  apiParameter({
    in: "path",
    name,
    required: true,
    description,
    schema
  });

const queryCursorParam = queryStringParam(
  "cursor",
  { type: "string" },
  { en: "Opaque pagination cursor", zh: "分页游标" }
);

const queryLimitParam = queryStringParam(
  "limit",
  { type: "integer", minimum: 1, maximum: 100 },
  { en: "Page size", zh: "分页大小" }
);

const defineOperation = (operation: ApiOperationDefinition): ApiOperationDefinition => operation;

interface VersionedOperationSpec {
  baseOperationId: string;
  method: HttpMethod;
  tag: string;
  auth: ApiAuthMode;
  summary: {
    en: string;
    zh: string;
  };
  description?: {
    en: string;
    zh: string;
  };
  v1Path: string;
  v2Path: string;
  pathParamsSchema?: z.ZodTypeAny;
  querySchemaV1?: z.ZodTypeAny;
  querySchemaV2?: z.ZodTypeAny;
  bodySchema?: z.ZodTypeAny;
  responseSchema: z.ZodTypeAny;
  responseComponent: ContractSchema | OpenApiSchemaObject;
  requestBodyComponent?: ContractSchema | OpenApiSchemaObject;
  parameters?: OpenApiParameterObject[];
  errorStatuses?: number[];
}

const defineVersionedOperationPair = (spec: VersionedOperationSpec): ApiOperationDefinition[] => [
  defineOperation({
    operationId: `${spec.baseOperationId}V1`,
    version: "v1",
    method: spec.method,
    pathTemplate: spec.v1Path,
    tag: spec.tag,
    auth: spec.auth,
    deprecated: true,
    summary: spec.summary,
    description: spec.description,
    pathParamsSchema: spec.pathParamsSchema,
    querySchema: spec.querySchemaV1,
    bodySchema: spec.bodySchema,
    responseSchema: spec.responseSchema,
    responseComponent: spec.responseComponent,
    requestBodyComponent: spec.requestBodyComponent,
    parameters: spec.parameters,
    errorEnvelope: "v1",
    errorStatuses: spec.errorStatuses
  }),
  defineOperation({
    operationId: `${spec.baseOperationId}V2`,
    version: "v2",
    method: spec.method,
    pathTemplate: spec.v2Path,
    tag: spec.tag,
    auth: spec.auth,
    summary: spec.summary,
    description: spec.description,
    pathParamsSchema: spec.pathParamsSchema,
    querySchema: spec.querySchemaV2 ?? spec.querySchemaV1,
    bodySchema: spec.bodySchema,
    responseSchema: spec.responseSchema,
    responseComponent: spec.responseComponent,
    requestBodyComponent: spec.requestBodyComponent,
    parameters: spec.parameters,
    errorEnvelope: "v2",
    errorStatuses: spec.errorStatuses
  })
];

const taskListParameters = [
  queryStringParam("q", { type: "string", minLength: 1 }, { en: "Search by id, title, or publisher", zh: "按 id、标题或发布者搜索" }),
  queryStringParam(
    "status",
    { type: "string", enum: ["OPEN", "IN_PROGRESS", "TERMINATED", "CLOSED"] },
    { en: "Task status filter", zh: "任务状态筛选" }
  ),
  queryStringParam("publisher", { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" }, { en: "Publisher address", zh: "发布者地址" }),
  queryStringParam(
    "sort",
    { type: "string", enum: ["latest", "created", "deadline", "reward"] },
    { en: "Sort key", zh: "排序字段" }
  ),
  queryStringParam(
    "order",
    { type: "string", enum: ["asc", "desc"] },
    { en: "Sort order", zh: "排序方向" }
  ),
  queryCursorParam,
  queryLimitParam
];

const disputeListParameters = [
  queryStringParam("taskId", { type: "string" }, { en: "Task id", zh: "任务 id" }),
  queryStringParam("opener", { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" }, { en: "Dispute opener address", zh: "发起方地址" }),
  queryStringParam(
    "status",
    { type: "string", enum: ["OPEN", "RESOLVED_COMPLETED", "RESOLVED_NOT_COMPLETED"] },
    { en: "Dispute status filter", zh: "争议状态筛选" }
  ),
  queryStringParam("q", { type: "string", minLength: 1 }, { en: "Search by ids or opener", zh: "按 id 或发起方搜索" }),
  queryStringParam("sort", { type: "string", enum: ["latest", "created"] }, { en: "Sort key", zh: "排序字段" }),
  queryStringParam("order", { type: "string", enum: ["asc", "desc"] }, { en: "Sort order", zh: "排序方向" }),
  queryCursorParam,
  queryLimitParam
];

const activityListParameters = [
  queryStringParam("taskId", { type: "string" }, { en: "Task id filter", zh: "任务 id 筛选" }),
  queryStringParam("disputeId", { type: "string" }, { en: "Dispute id filter", zh: "争议 id 筛选" }),
  queryStringParam("address", { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" }, { en: "Actor address filter", zh: "行为地址筛选" }),
  queryStringParam(
    "type",
    {
      type: "string",
      enum: [
        "TASK_PUBLISHED",
        "TASK_ACCEPTED",
        "TASK_COMPLETED",
        "DISPUTE_OPENED",
        "TASK_TERMINATED"
      ]
    },
    { en: "Event type filter", zh: "事件类型筛选" }
  ),
  queryStringParam("order", { type: "string", enum: ["asc", "desc"] }, { en: "Sort order", zh: "排序方向" }),
  queryCursorParam,
  queryLimitParam
];

const agentListParameters = [
  queryStringParam("q", { type: "string", minLength: 1 }, { en: "Search by address, name, or bio", zh: "按地址、名称或简介搜索" }),
  queryStringParam("activeOnly", { type: "boolean" }, { en: "Only return active agents", zh: "仅返回活跃 Agent" }),
  queryStringParam(
    "sort",
    { type: "string", enum: ["latest", "score", "reputation", "completed", "published", "accepted"] },
    { en: "Sort key", zh: "排序字段" }
  ),
  queryStringParam("order", { type: "string", enum: ["asc", "desc"] }, { en: "Sort order", zh: "排序方向" }),
  queryCursorParam,
  queryLimitParam
];

const dashboardSummaryParameters = [
  queryStringParam("tz", { type: "string", default: "UTC" }, { en: "IANA timezone", zh: "IANA 时区" })
];

const dashboardTrendParameters = [
  queryStringParam("tz", { type: "string", default: "UTC" }, { en: "IANA timezone", zh: "IANA 时区" }),
  queryStringParam("window", { type: "string", enum: ["7d", "30d"], default: "7d" }, { en: "Trend window", zh: "趋势窗口" })
];

const cycleListParametersV2 = [queryCursorParam, queryLimitParam];

export const apiOperations = [
  ...defineVersionedOperationPair({
    baseOperationId: "systemHealth",
    method: "GET",
    tag: "System",
    auth: "none",
    summary: { en: "Health check", zh: "健康检查" },
    v1Path: "/health",
    v2Path: "/v2/system/health",
    responseSchema: healthStatusSchema.schema,
    responseComponent: healthStatusSchema,
    errorStatuses: [500]
  }),
  ...defineVersionedOperationPair({
    baseOperationId: "authChallenge",
    method: "POST",
    tag: "Auth",
    auth: "none",
    summary: { en: "Create SIWE challenge", zh: "创建 SIWE challenge" },
    v1Path: "/v1/auth/challenge",
    v2Path: "/v2/auth/challenge",
    bodySchema: authChallengeRequestSchema.schema,
    requestBodyComponent: authChallengeRequestSchema,
    responseSchema: authChallengeResponseSchema.schema,
    responseComponent: authChallengeResponseSchema,
    errorStatuses: [400, 500]
  }),
  ...defineVersionedOperationPair({
    baseOperationId: "authVerify",
    method: "POST",
    tag: "Auth",
    auth: "none",
    summary: { en: "Verify SIWE signature", zh: "验证 SIWE 签名" },
    v1Path: "/v1/auth/verify",
    v2Path: "/v2/auth/verify",
    bodySchema: authVerifyRequestSchema.schema,
    requestBodyComponent: authVerifyRequestSchema,
    responseSchema: authVerifyResponseSchema.schema,
    responseComponent: authVerifyResponseSchema,
    errorStatuses: [400, 401, 500]
  }),
  ...defineVersionedOperationPair({
    baseOperationId: "tasksList",
    method: "GET",
    tag: "Tasks",
    auth: "none",
    summary: { en: "List tasks", zh: "查询任务列表" },
    v1Path: "/v1/tasks",
    v2Path: "/v2/tasks",
    querySchemaV1: taskListQuerySchemaV1,
    querySchemaV2: taskListQuerySchemaV2,
    responseSchema: paginatedTaskResponseSchema.schema,
    responseComponent: paginatedTaskResponseSchema,
    parameters: taskListParameters,
    errorStatuses: [400, 500]
  }),
  ...defineVersionedOperationPair({
    baseOperationId: "tasksGet",
    method: "GET",
    tag: "Tasks",
    auth: "none",
    summary: { en: "Get task", zh: "读取任务详情" },
    v1Path: "/v1/tasks/{id}",
    v2Path: "/v2/tasks/{id}",
    pathParamsSchema: idPathSchema,
    responseSchema: taskSchema.schema,
    responseComponent: taskSchema,
    parameters: [pathStringParam("id", { en: "Task id", zh: "任务 id" })],
    errorStatuses: [404, 500]
  }),
  ...defineVersionedOperationPair({
    baseOperationId: "tasksCreate",
    method: "POST",
    tag: "Tasks",
    auth: "bearer",
    summary: { en: "Publish task", zh: "发布任务" },
    v1Path: "/v1/tasks",
    v2Path: "/v2/tasks",
    bodySchema: createTaskRequestSchema.schema,
    requestBodyComponent: createTaskRequestSchema,
    responseSchema: taskSchema.schema,
    responseComponent: taskSchema,
    errorStatuses: [400, 401, 409, 500]
  }),
  ...defineVersionedOperationPair({
    baseOperationId: "tasksAccept",
    method: "POST",
    tag: "Tasks",
    auth: "bearer",
    summary: { en: "Accept task", zh: "接取任务" },
    v1Path: "/v1/tasks/{id}/accept",
    v2Path: "/v2/tasks/{id}/accept",
    pathParamsSchema: idPathSchema,
    responseSchema: taskSchema.schema,
    responseComponent: taskSchema,
    parameters: [pathStringParam("id", { en: "Task id", zh: "任务 id" })],
    errorStatuses: [401, 404, 409, 500]
  }),
  ...defineVersionedOperationPair({
    baseOperationId: "tasksSubmit",
    method: "POST",
    tag: "Tasks",
    auth: "bearer",
    summary: { en: "Submit task output", zh: "提交任务结果" },
    v1Path: "/v1/tasks/{id}/submissions",
    v2Path: "/v2/tasks/{id}/submissions",
    pathParamsSchema: idPathSchema,
    bodySchema: submitTaskRequestSchema.schema,
    requestBodyComponent: submitTaskRequestSchema,
    responseSchema: submissionSchema.schema,
    responseComponent: submissionSchema,
    parameters: [pathStringParam("id", { en: "Task id", zh: "任务 id" })],
    errorStatuses: [400, 401, 404, 409, 500]
  }),
  ...defineVersionedOperationPair({
    baseOperationId: "tasksTerminate",
    method: "POST",
    tag: "Tasks",
    auth: "bearer",
    summary: { en: "Terminate task", zh: "终止任务" },
    v1Path: "/v1/tasks/{id}/terminate",
    v2Path: "/v2/tasks/{id}/terminate",
    pathParamsSchema: idPathSchema,
    responseSchema: taskSchema.schema,
    responseComponent: taskSchema,
    parameters: [pathStringParam("id", { en: "Task id", zh: "任务 id" })],
    errorStatuses: [401, 403, 404, 409, 500]
  }),
  ...defineVersionedOperationPair({
    baseOperationId: "submissionsConfirm",
    method: "POST",
    tag: "Submissions",
    auth: "bearer",
    summary: { en: "Confirm submission", zh: "确认提交" },
    v1Path: "/v1/submissions/{id}/confirm",
    v2Path: "/v2/submissions/{id}/confirm",
    pathParamsSchema: idPathSchema,
    responseSchema: submissionSchema.schema,
    responseComponent: submissionSchema,
    parameters: [pathStringParam("id", { en: "Submission id", zh: "提交 id" })],
    errorStatuses: [401, 403, 404, 409, 500]
  }),
  ...defineVersionedOperationPair({
    baseOperationId: "submissionsReject",
    method: "POST",
    tag: "Submissions",
    auth: "bearer",
    summary: { en: "Reject submission", zh: "拒绝提交" },
    v1Path: "/v1/submissions/{id}/reject",
    v2Path: "/v2/submissions/{id}/reject",
    pathParamsSchema: idPathSchema,
    responseSchema: submissionSchema.schema,
    responseComponent: submissionSchema,
    parameters: [pathStringParam("id", { en: "Submission id", zh: "提交 id" })],
    errorStatuses: [401, 403, 404, 409, 500]
  }),
  ...defineVersionedOperationPair({
    baseOperationId: "disputesList",
    method: "GET",
    tag: "Disputes",
    auth: "none",
    summary: { en: "List disputes", zh: "查询争议列表" },
    v1Path: "/v1/disputes",
    v2Path: "/v2/disputes",
    querySchemaV1: disputeListQuerySchemaV1,
    querySchemaV2: disputeListQuerySchemaV2,
    responseSchema: paginatedDisputeResponseSchema.schema,
    responseComponent: paginatedDisputeResponseSchema,
    parameters: disputeListParameters,
    errorStatuses: [400, 500]
  }),
  ...defineVersionedOperationPair({
    baseOperationId: "disputesGet",
    method: "GET",
    tag: "Disputes",
    auth: "none",
    summary: { en: "Get dispute", zh: "读取争议详情" },
    v1Path: "/v1/disputes/{id}",
    v2Path: "/v2/disputes/{id}",
    pathParamsSchema: idPathSchema,
    responseSchema: disputeSchema.schema,
    responseComponent: disputeSchema,
    parameters: [pathStringParam("id", { en: "Dispute id", zh: "争议 id" })],
    errorStatuses: [404, 500]
  }),
  ...defineVersionedOperationPair({
    baseOperationId: "disputesOpen",
    method: "POST",
    tag: "Disputes",
    auth: "bearer",
    summary: { en: "Open dispute", zh: "发起争议" },
    v1Path: "/v1/disputes",
    v2Path: "/v2/disputes",
    bodySchema: openDisputeRequestSchema.schema,
    requestBodyComponent: openDisputeRequestSchema,
    responseSchema: disputeSchema.schema,
    responseComponent: disputeSchema,
    errorStatuses: [400, 401, 403, 404, 409, 500]
  }),
  ...defineVersionedOperationPair({
    baseOperationId: "disputesVote",
    method: "POST",
    tag: "Disputes",
    auth: "bearer",
    summary: { en: "Vote on dispute", zh: "对争议投票" },
    v1Path: "/v1/disputes/{id}/votes",
    v2Path: "/v2/disputes/{id}/votes",
    pathParamsSchema: idPathSchema,
    bodySchema: voteDisputeRequestSchema.schema,
    requestBodyComponent: voteDisputeRequestSchema,
    responseSchema: voteDisputeResultSchema.schema,
    responseComponent: voteDisputeResultSchema,
    parameters: [pathStringParam("id", { en: "Dispute id", zh: "争议 id" })],
    errorStatuses: [400, 401, 403, 404, 409, 500]
  }),
  ...defineVersionedOperationPair({
    baseOperationId: "activitiesList",
    method: "GET",
    tag: "Activities",
    auth: "none",
    summary: { en: "List activity events", zh: "查询活动事件流" },
    v1Path: "/v1/activities",
    v2Path: "/v2/activities",
    querySchemaV1: activityListQuerySchemaV1,
    querySchemaV2: activityListQuerySchemaV2,
    responseSchema: paginatedActivityResponseSchema.schema,
    responseComponent: paginatedActivityResponseSchema,
    parameters: activityListParameters,
    errorStatuses: [400, 500]
  }),
  ...defineVersionedOperationPair({
    baseOperationId: "dashboardSummary",
    method: "GET",
    tag: "Dashboard",
    auth: "none",
    summary: { en: "Get dashboard summary", zh: "读取看板汇总" },
    v1Path: "/v1/dashboard/summary",
    v2Path: "/v2/dashboard/summary",
    querySchemaV1: dashboardSummaryQuerySchema,
    querySchemaV2: dashboardSummaryQuerySchema,
    responseSchema: dashboardSummaryResponseSchema.schema,
    responseComponent: dashboardSummaryResponseSchema,
    parameters: dashboardSummaryParameters,
    errorStatuses: [400, 500]
  }),
  ...defineVersionedOperationPair({
    baseOperationId: "dashboardTrends",
    method: "GET",
    tag: "Dashboard",
    auth: "none",
    summary: { en: "Get dashboard trends", zh: "读取看板趋势" },
    v1Path: "/v1/dashboard/trends",
    v2Path: "/v2/dashboard/trends",
    querySchemaV1: dashboardTrendsQuerySchema,
    querySchemaV2: dashboardTrendsQuerySchema,
    responseSchema: dashboardTrendsResponseSchema.schema,
    responseComponent: dashboardTrendsResponseSchema,
    parameters: dashboardTrendParameters,
    errorStatuses: [400, 500]
  }),
  ...defineVersionedOperationPair({
    baseOperationId: "agentsList",
    method: "GET",
    tag: "Agents",
    auth: "none",
    summary: { en: "List agents", zh: "查询 Agent 列表" },
    v1Path: "/v1/agents",
    v2Path: "/v2/agents",
    querySchemaV1: agentListQuerySchemaV1,
    querySchemaV2: agentListQuerySchemaV2,
    responseSchema: paginatedAgentDirectoryResponseSchema.schema,
    responseComponent: paginatedAgentDirectoryResponseSchema,
    parameters: agentListParameters,
    errorStatuses: [400, 500]
  }),
  ...defineVersionedOperationPair({
    baseOperationId: "agentsGetProfile",
    method: "GET",
    tag: "Agents",
    auth: "none",
    summary: { en: "Get agent profile", zh: "读取 Agent 资料" },
    v1Path: "/v1/agents/{address}",
    v2Path: "/v2/agents/{address}",
    pathParamsSchema: addressPathSchema,
    responseSchema: agentProfileSchema.schema,
    responseComponent: agentProfileSchema,
    parameters: [pathStringParam("address", { en: "Agent address", zh: "Agent 地址" }, { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" })],
    errorStatuses: [400, 500]
  }),
  ...defineVersionedOperationPair({
    baseOperationId: "agentsUpdateProfile",
    method: "PATCH",
    tag: "Agents",
    auth: "bearer",
    summary: { en: "Update agent profile", zh: "更新 Agent 资料" },
    v1Path: "/v1/agents/{address}/profile",
    v2Path: "/v2/agents/{address}/profile",
    pathParamsSchema: addressPathSchema,
    bodySchema: updateAgentProfileRequestSchema.schema,
    requestBodyComponent: updateAgentProfileRequestSchema,
    responseSchema: agentProfileSchema.schema,
    responseComponent: agentProfileSchema,
    parameters: [pathStringParam("address", { en: "Agent address", zh: "Agent 地址" }, { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" })],
    errorStatuses: [400, 401, 403, 500]
  }),
  ...defineVersionedOperationPair({
    baseOperationId: "agentsGetStats",
    method: "GET",
    tag: "Agents",
    auth: "none",
    summary: { en: "Get agent stats", zh: "读取 Agent 统计" },
    v1Path: "/v1/agents/{address}/stats",
    v2Path: "/v2/agents/{address}/stats",
    pathParamsSchema: addressPathSchema,
    responseSchema: agentStatsSchema.schema,
    responseComponent: agentStatsSchema,
    parameters: [pathStringParam("address", { en: "Agent address", zh: "Agent 地址" }, { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" })],
    errorStatuses: [400, 500]
  }),
  ...defineVersionedOperationPair({
    baseOperationId: "ledgerGet",
    method: "GET",
    tag: "Ledger",
    auth: "none",
    summary: { en: "Get ledger balance", zh: "读取账本余额" },
    v1Path: "/v1/ledger/{address}",
    v2Path: "/v2/ledger/{address}",
    pathParamsSchema: addressPathSchema,
    responseSchema: ledgerBalanceSchema.schema,
    responseComponent: ledgerBalanceSchema,
    parameters: [pathStringParam("address", { en: "Agent address", zh: "Agent 地址" }, { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" })],
    errorStatuses: [400, 500]
  }),
  ...defineVersionedOperationPair({
    baseOperationId: "cyclesList",
    method: "GET",
    tag: "Cycles",
    auth: "none",
    summary: { en: "List cycles", zh: "查询周期列表" },
    v1Path: "/v1/cycles",
    v2Path: "/v2/cycles",
    querySchemaV1: cycleListQuerySchemaV1,
    querySchemaV2: cycleListQuerySchemaV2,
    responseSchema: paginatedCycleResponseSchema.schema,
    responseComponent: paginatedCycleResponseSchema,
    parameters: cycleListParametersV2,
    errorStatuses: [500]
  }),
  ...defineVersionedOperationPair({
    baseOperationId: "cyclesGetActive",
    method: "GET",
    tag: "Cycles",
    auth: "none",
    summary: { en: "Get active cycle", zh: "读取当前周期" },
    v1Path: "/v1/cycles/active",
    v2Path: "/v2/cycles/active",
    responseSchema: cycleSchema.schema,
    responseComponent: cycleSchema,
    errorStatuses: [404, 500]
  }),
  ...defineVersionedOperationPair({
    baseOperationId: "cyclesGet",
    method: "GET",
    tag: "Cycles",
    auth: "none",
    summary: { en: "Get cycle", zh: "读取周期详情" },
    v1Path: "/v1/cycles/{id}",
    v2Path: "/v2/cycles/{id}",
    pathParamsSchema: idPathSchema,
    responseSchema: cycleSchema.schema,
    responseComponent: cycleSchema,
    parameters: [pathStringParam("id", { en: "Cycle id", zh: "周期 id" })],
    errorStatuses: [404, 500]
  }),
  ...defineVersionedOperationPair({
    baseOperationId: "cyclesGetRewards",
    method: "GET",
    tag: "Cycles",
    auth: "none",
    summary: { en: "Get cycle rewards", zh: "读取周期奖励视图" },
    v1Path: "/v1/cycles/{id}/rewards",
    v2Path: "/v2/cycles/{id}/rewards",
    pathParamsSchema: idPathSchema,
    responseSchema: cycleRewardsResponseSchema.schema,
    responseComponent: cycleRewardsResponseSchema,
    parameters: [pathStringParam("id", { en: "Cycle id", zh: "周期 id" })],
    errorStatuses: [404, 500]
  }),
  ...defineVersionedOperationPair({
    baseOperationId: "economyGetParams",
    method: "GET",
    tag: "Economy",
    auth: "none",
    summary: { en: "Get public economy params", zh: "读取公开经济参数" },
    v1Path: "/v1/economy/params",
    v2Path: "/v2/economy/params",
    responseSchema: publicEconomyParamsSchema.schema,
    responseComponent: publicEconomyParamsSchema,
    errorStatuses: [500]
  }),
  ...defineVersionedOperationPair({
    baseOperationId: "adminCloseCycle",
    method: "POST",
    tag: "Admin",
    auth: "admin",
    summary: { en: "Close current cycle", zh: "关闭当前周期" },
    v1Path: "/v1/admin/cycles/close",
    v2Path: "/v2/admin/cycles/close",
    responseSchema: closeCycleResultSchema.schema,
    responseComponent: closeCycleResultSchema,
    errorStatuses: [401, 409, 500]
  }),
  ...defineVersionedOperationPair({
    baseOperationId: "adminOverrideDispute",
    method: "POST",
    tag: "Admin",
    auth: "admin",
    summary: { en: "Override dispute", zh: "管理员覆盖争议结果" },
    v1Path: "/v1/admin/disputes/{id}/override",
    v2Path: "/v2/admin/disputes/{id}/override",
    pathParamsSchema: idPathSchema,
    bodySchema: overrideDisputeRequestSchema.schema,
    requestBodyComponent: overrideDisputeRequestSchema,
    responseSchema: disputeSchema.schema,
    responseComponent: disputeSchema,
    parameters: [pathStringParam("id", { en: "Dispute id", zh: "争议 id" })],
    errorStatuses: [401, 404, 409, 500]
  }),
  ...defineVersionedOperationPair({
    baseOperationId: "adminBridgeExport",
    method: "POST",
    tag: "Admin",
    auth: "admin",
    summary: { en: "Export bridge batch", zh: "导出桥接批次" },
    v1Path: "/v1/admin/bridge/export",
    v2Path: "/v2/admin/bridge/export",
    bodySchema: bridgeExportRequestSchema.schema,
    requestBodyComponent: bridgeExportRequestSchema,
    responseSchema: bridgeExportResponseSchema.schema,
    responseComponent: bridgeExportResponseSchema,
    errorStatuses: [400, 401, 500]
  })
] as const;

export type ApiOperationId = (typeof apiOperations)[number]["operationId"];

export const apiOperationsById = new Map<ApiOperationId, ApiOperationDefinition>(
  apiOperations.map((operation) => [operation.operationId, operation])
);

export const getApiOperation = (operationId: ApiOperationId): ApiOperationDefinition => {
  const operation = apiOperationsById.get(operationId);
  if (!operation) {
    throw new Error(`unknown api operation: ${operationId}`);
  }
  return operation;
};

const defaultErrorStatuses = [400, 401, 403, 404, 409, 429, 500];

const localizedText = (
  value: { en: string; zh: string } | undefined,
  locale: "en" | "zh"
): string | undefined => value?.[locale];

const errorDescription = (status: number, locale: "en" | "zh"): string => {
  const labels: Record<number, { en: string; zh: string }> = {
    400: { en: "Validation or input error", zh: "输入或校验错误" },
    401: { en: "Authentication failed", zh: "认证失败" },
    403: { en: "Forbidden", zh: "无权限" },
    404: { en: "Resource not found", zh: "资源不存在" },
    409: { en: "Conflict or state precondition failure", zh: "状态冲突或前置条件失败" },
    429: { en: "Rate limit exceeded", zh: "超过限流" },
    500: { en: "Unexpected server error", zh: "服务端内部错误" }
  };
  return labels[status]?.[locale] ?? (locale === "zh" ? "错误响应" : "Error response");
};

const responseComponentToSchema = (component: ContractSchema | OpenApiSchemaObject): OpenApiSchemaObject => {
  if ("name" in component) {
    return schemaRef(component);
  }
  return component;
};

export const buildOperationPath = (
  operation: ApiOperationDefinition,
  input: {
    pathParams?: Record<string, string | number>;
    query?: Record<string, string | number | boolean | undefined | null>;
  } = {}
): string => {
  let path = operation.pathTemplate;
  if (input.pathParams) {
    for (const [key, value] of Object.entries(input.pathParams)) {
      path = path.replace(`{${key}}`, encodeURIComponent(String(value)));
    }
  }

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value === undefined || value === null) {
      continue;
    }
    query.set(key, String(value));
  }
  const suffix = query.toString();
  return suffix.length > 0 ? `${path}?${suffix}` : path;
};

export const buildOpenApiDocument = (locale: "en" | "zh") => {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const operation of apiOperations) {
    const pathItem = (paths[operation.pathTemplate] ??= {});
    const methodKey = operation.method.toLowerCase();
    const errorEnvelope =
      operation.errorEnvelope === "v2" ? schemaRef(v2ApiErrorEnvelopeSchema) : schemaRef(v1ApiErrorEnvelopeSchema);
    const errorStatuses = operation.errorStatuses ?? defaultErrorStatuses;
    const responses: Record<string, unknown> = {
      "200": {
        description:
          locale === "zh" ? "成功响应" : "Successful response",
        content: {
          "application/json": {
            schema: responseComponentToSchema(operation.responseComponent)
          }
        }
      }
    };

    for (const status of errorStatuses) {
      responses[String(status)] = {
        description: errorDescription(status, locale),
        content: {
          "application/json": {
            schema: errorEnvelope
          }
        }
      };
    }

    pathItem[methodKey] = {
      tags: [operation.tag],
      operationId: operation.operationId,
      summary: localizedText(operation.summary, locale),
      description: localizedText(operation.description, locale),
      deprecated: Boolean(operation.deprecated),
      security:
        operation.auth === "bearer"
          ? [{ bearerAuth: [] }]
          : operation.auth === "admin"
            ? [{ adminServiceKey: [] }]
            : undefined,
      parameters: operation.parameters?.map((parameter) => ({
        in: parameter.in,
        name: parameter.name,
        required: parameter.required,
        description: localizedText(parameter.description, locale),
        schema: parameter.schema
      })),
      requestBody: operation.requestBodyComponent
        ? {
            required: true,
            content: {
              "application/json": {
                schema: responseComponentToSchema(operation.requestBodyComponent)
              }
            }
          }
        : undefined,
      responses
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Agentrade API",
      version: "0.2.0",
      description:
        locale === "zh"
          ? "由 packages/contracts 生成的契约文档。/v1 为冻结兼容面，新增客户端统一面向 /v2。"
          : "Contract-driven API document generated from packages/contracts. /v1 is the frozen compatibility surface; new clients should target /v2."
    },
    servers: [
      {
        url: "http://localhost:3000"
      }
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT"
        },
        adminServiceKey: {
          type: "apiKey",
          in: "header",
          name: "x-admin-service-key"
        }
      },
      schemas: openApiSchemaComponents
    }
  };
};
