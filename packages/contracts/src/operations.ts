import type { z } from "zod";
import { ActivityEventType, FeedbackReportType } from "@agentrade/types";
import {
  activityListQuerySchemaV2,
  addressPathSchema,
  agentListQuerySchemaV2,
  agentProfileSchema,
  agentStatsSchema,
  authChallengeRequestSchema,
  authChallengeResponseSchema,
  authVerifyRequestSchema,
  authVerifyResponseSchema,
  createTaskRequestSchema,
  cycleListQuerySchemaV2,
  cycleRewardsResponseSchema,
  cycleSchema,
  dashboardSummaryQuerySchema,
  dashboardSummaryResponseSchema,
  dashboardTrendsQuerySchema,
  dashboardTrendsResponseSchema,
  disputeListQuerySchemaV2,
  disputeSchema,
  createFeedbackReportRequestSchema,
  feedbackReportListQuerySchemaV2,
  feedbackReportSchema,
  healthStatusSchema,
  idPathSchema,
  ledgerBalanceSchema,
  openDisputeRequestSchema,
  openApiSchemaComponents,
  paginatedActivityResponseSchema,
  paginatedAgentDirectoryResponseSchema,
  paginatedServerAuditLogResponseSchema,
  paginatedServerRequestLogResponseSchema,
  paginatedCycleResponseSchema,
  paginatedDisputeResponseSchema,
  paginatedFeedbackReportResponseSchema,
  paginatedRuntimeRuleAuditResponseSchema,
  paginatedSubmissionResponseSchema,
  paginatedTaskIntentionResponseSchema,
  paginatedTaskResponseSchema,
  publicEconomyParamsSchema,
  rejectSubmissionRequestSchema,
  respondDisputeRequestSchema,
  runtimeRuleAuditHistoryQuerySchemaV2,
  systemAuditLogsQuerySchemaV2,
  systemRequestLogsQuerySchemaV2,
  runtimeSettingsResetRequestSchema,
  runtimeSettingsStateSchema,
  runtimeSettingsUpdateRequestSchema,
  serviceMetricsResponseSchema,
  schemaRef,
  submitTaskRequestSchema,
  submissionListQuerySchemaV2,
  submissionSchema,
  taskListQuerySchemaV2,
  taskIntentionListQuerySchemaV2,
  taskIntentionSchema,
  taskSchema,
  taskTargetMentionSchema,
  todosQuerySchemaV2,
  todosResponseSchema,
  updateAgentProfileRequestSchema,
  v2ApiErrorEnvelopeSchema,
  voteDisputeRequestSchema,
  voteDisputeResultSchema,
  type ContractSchema,
  type OpenApiSchemaObject
} from "./schemas.js";

export type ApiVersion = "v2";
export type HttpMethod = "GET" | "POST" | "PATCH";
export type ApiAuthMode = "none" | "bearer" | "bearer_admin";

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

interface ApiOperationSpec {
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
  pathTemplate: string;
  pathParamsSchema?: z.ZodTypeAny;
  querySchema?: z.ZodTypeAny;
  bodySchema?: z.ZodTypeAny;
  responseSchema: z.ZodTypeAny;
  responseComponent: ContractSchema | OpenApiSchemaObject;
  requestBodyComponent?: ContractSchema | OpenApiSchemaObject;
  parameters?: OpenApiParameterObject[];
  errorStatuses?: number[];
}

const defineOperationSpec = (spec: ApiOperationSpec): ApiOperationDefinition =>
  defineOperation({
    operationId: `${spec.baseOperationId}V2`,
    version: "v2",
    method: spec.method,
    pathTemplate: spec.pathTemplate,
    tag: spec.tag,
    auth: spec.auth,
    summary: spec.summary,
    description: spec.description,
    pathParamsSchema: spec.pathParamsSchema,
    querySchema: spec.querySchema,
    bodySchema: spec.bodySchema,
    responseSchema: spec.responseSchema,
    responseComponent: spec.responseComponent,
    requestBodyComponent: spec.requestBodyComponent,
    parameters: spec.parameters,
    errorStatuses: spec.errorStatuses
  });

const taskListParameters = [
  queryStringParam(
    "q",
    { type: "string", minLength: 1 },
    { en: "Search by id, title, description, criteria, or publisher", zh: "按 id、标题、描述、验收标准或发布者搜索" }
  ),
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
    { type: "string", enum: ["OPEN", "RESOLVED_COMPLETED"] },
    { en: "Dispute status filter", zh: "争议状态筛选" }
  ),
  queryStringParam(
    "q",
    { type: "string", minLength: 1 },
    { en: "Search by ids, opener, or dispute party reasons", zh: "按 id、发起方或争议双方说明搜索" }
  ),
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
      enum: Object.values(ActivityEventType)
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
    { type: "string", enum: ["latest", "score", "reputation", "completed", "published", "intented"] },
    { en: "Sort key", zh: "排序字段" }
  ),
  queryStringParam("order", { type: "string", enum: ["asc", "desc"] }, { en: "Sort order", zh: "排序方向" }),
  queryCursorParam,
  queryLimitParam
];

const taskIntentionListParameters = [queryCursorParam, queryLimitParam];

const submissionListParameters = [
  queryStringParam("taskId", { type: "string" }, { en: "Task id filter", zh: "任务 id 筛选" }),
  queryStringParam(
    "agent",
    { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" },
    { en: "Submission agent address", zh: "提交方地址" }
  ),
  queryStringParam(
    "status",
    { type: "string", enum: ["SUBMITTED", "CONFIRMED", "REJECTED"] },
    { en: "Submission status filter", zh: "提交状态筛选" }
  ),
  queryStringParam(
    "q",
    { type: "string", minLength: 1 },
    { en: "Search by ids, agent, or payload", zh: "按 id、提交者或提交内容搜索" }
  ),
  queryStringParam("sort", { type: "string", enum: ["latest", "created"] }, { en: "Sort key", zh: "排序字段" }),
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

const todosParameters = [
  pathStringParam("address", { en: "Agent address", zh: "Agent 地址" }, { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" }),
  queryStringParam(
    "scope",
    { type: "string", enum: ["all", "action_required", "waiting"], default: "all" },
    { en: "Todo scope", zh: "待办范围" }
  ),
  queryStringParam(
    "type",
    {
      type: "string",
      enum: [
        "latest_rejected_submission_no_followup",
        "open_dispute_counterparty_response_required",
        "published_task_submission_pending_review",
        "expired_published_task_cleanup_required",
        "intended_task_never_submitted",
        "submitted_submission_waiting_review",
        "published_task_waiting_new_submission",
        "open_dispute_waiting_resolution"
      ]
    },
    { en: "Optional todo group type filter", zh: "可选待办类型筛选" }
  ),
  queryStringParam(
    "cursor",
    { type: "string" },
    { en: "Opaque pagination cursor; requires type", zh: "分页游标；需要同时提供 type" }
  ),
  queryLimitParam
];

const cycleListParametersV2 = [queryCursorParam, queryLimitParam];
const runtimeRuleHistoryParametersV2 = [queryCursorParam, queryLimitParam];
const systemRequestLogParametersV2 = [
  queryCursorParam,
  queryLimitParam,
  queryStringParam("from", { type: "string", format: "date-time" }, { en: "Start time (inclusive)", zh: "开始时间（含）" }),
  queryStringParam("to", { type: "string", format: "date-time" }, { en: "End time (inclusive)", zh: "结束时间（含）" }),
  queryStringParam("requestId", { type: "string", minLength: 1 }, { en: "Request id filter", zh: "请求 id 筛选" }),
  queryStringParam("actor", { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" }, { en: "Actor address filter", zh: "操作地址筛选" }),
  queryStringParam("ip", { type: "string", minLength: 1 }, { en: "Client IP filter", zh: "客户端 IP 筛选" }),
  queryStringParam("method", { type: "string", minLength: 1 }, { en: "HTTP method filter", zh: "HTTP 方法筛选" }),
  queryStringParam("routeId", { type: "string", minLength: 1 }, { en: "Route id filter", zh: "路由标识筛选" }),
  queryStringParam("status", { type: "integer", minimum: 100, maximum: 599 }, { en: "HTTP status code filter", zh: "HTTP 状态码筛选" })
] as const;
const systemAuditLogParametersV2 = [
  queryCursorParam,
  queryLimitParam,
  queryStringParam("from", { type: "string", format: "date-time" }, { en: "Start time (inclusive)", zh: "开始时间（含）" }),
  queryStringParam("to", { type: "string", format: "date-time" }, { en: "End time (inclusive)", zh: "结束时间（含）" }),
  queryStringParam("requestId", { type: "string", minLength: 1 }, { en: "Request id filter", zh: "请求 id 筛选" }),
  queryStringParam("actor", { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" }, { en: "Actor address filter", zh: "操作地址筛选" }),
  queryStringParam("ip", { type: "string", minLength: 1 }, { en: "Client IP filter", zh: "客户端 IP 筛选" }),
  queryStringParam(
    "category",
    {
      type: "string",
      enum: ["RUNTIME", "AUTH", "SECURITY", "ADMIN", "DOMAIN_WRITE", "BACKGROUND_JOB"]
    },
    { en: "Audit category filter", zh: "审计类别筛选" }
  ),
  queryStringParam("action", { type: "string", minLength: 1 }, { en: "Audit action filter", zh: "审计动作筛选" }),
  queryStringParam(
    "outcome",
    { type: "string", enum: ["SUCCESS", "FAILURE", "REJECTED"] },
    { en: "Audit outcome filter", zh: "审计结果筛选" }
  )
] as const;
const feedbackReportListParametersV2 = [
  queryCursorParam,
  queryLimitParam,
  queryStringParam(
    "type",
    { type: "string", enum: Object.values(FeedbackReportType) },
    { en: "Feedback type filter", zh: "反馈类型筛选" }
  ),
  queryStringParam(
    "reporter",
    { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" },
    { en: "Reporter address filter", zh: "上报者地址筛选" }
  )
] as const;

export const apiOperations = [
  defineOperationSpec({
    baseOperationId: "systemHealth",
    method: "GET",
    tag: "System",
    auth: "none",
    summary: { en: "Health check", zh: "健康检查" },
    pathTemplate: "/v2/system/health",
    responseSchema: healthStatusSchema.schema,
    responseComponent: healthStatusSchema,
    errorStatuses: [500]
  }),
  defineOperationSpec({
    baseOperationId: "systemMetrics",
    method: "GET",
    tag: "System",
    auth: "bearer",
    summary: { en: "Get service metrics", zh: "读取服务指标" },
    pathTemplate: "/v2/system/metrics",
    responseSchema: serviceMetricsResponseSchema.schema,
    responseComponent: serviceMetricsResponseSchema,
    errorStatuses: [401, 500]
  }),
  defineOperationSpec({
    baseOperationId: "systemRequestLogsList",
    method: "GET",
    tag: "System",
    auth: "bearer_admin",
    summary: { en: "List server request logs", zh: "读取服务请求日志" },
    pathTemplate: "/v2/system/logs/requests",
    querySchema: systemRequestLogsQuerySchemaV2,
    responseSchema: paginatedServerRequestLogResponseSchema.schema,
    responseComponent: paginatedServerRequestLogResponseSchema,
    parameters: [...systemRequestLogParametersV2],
    errorStatuses: [401, 500]
  }),
  defineOperationSpec({
    baseOperationId: "systemAuditLogsList",
    method: "GET",
    tag: "System",
    auth: "bearer_admin",
    summary: { en: "List server audit logs", zh: "读取服务审计日志" },
    pathTemplate: "/v2/system/logs/audits",
    querySchema: systemAuditLogsQuerySchemaV2,
    responseSchema: paginatedServerAuditLogResponseSchema.schema,
    responseComponent: paginatedServerAuditLogResponseSchema,
    parameters: [...systemAuditLogParametersV2],
    errorStatuses: [401, 500]
  }),
  defineOperationSpec({
    baseOperationId: "systemSettingsGet",
    method: "GET",
    tag: "System",
    auth: "bearer",
    summary: { en: "Get runtime settings", zh: "读取运行规则设置" },
    pathTemplate: "/v2/system/settings",
    responseSchema: runtimeSettingsStateSchema.schema,
    responseComponent: runtimeSettingsStateSchema,
    errorStatuses: [401, 500]
  }),
  defineOperationSpec({
    baseOperationId: "systemSettingsUpdate",
    method: "PATCH",
    tag: "System",
    auth: "bearer_admin",
    summary: { en: "Update runtime settings", zh: "更新运行规则设置" },
    pathTemplate: "/v2/system/settings",
    bodySchema: runtimeSettingsUpdateRequestSchema.schema,
    requestBodyComponent: runtimeSettingsUpdateRequestSchema,
    responseSchema: runtimeSettingsStateSchema.schema,
    responseComponent: runtimeSettingsStateSchema,
    errorStatuses: [400, 401, 500]
  }),
  defineOperationSpec({
    baseOperationId: "systemSettingsReset",
    method: "POST",
    tag: "System",
    auth: "bearer_admin",
    summary: { en: "Reset runtime settings", zh: "重置运行规则设置" },
    pathTemplate: "/v2/system/settings/reset",
    bodySchema: runtimeSettingsResetRequestSchema.schema,
    requestBodyComponent: runtimeSettingsResetRequestSchema,
    responseSchema: runtimeSettingsStateSchema.schema,
    responseComponent: runtimeSettingsStateSchema,
    errorStatuses: [400, 401, 500]
  }),
  defineOperationSpec({
    baseOperationId: "systemSettingsHistory",
    method: "GET",
    tag: "System",
    auth: "bearer",
    summary: { en: "List runtime settings history", zh: "读取运行规则变更历史" },
    pathTemplate: "/v2/system/settings/history",
    querySchema: runtimeRuleAuditHistoryQuerySchemaV2,
    responseSchema: paginatedRuntimeRuleAuditResponseSchema.schema,
    responseComponent: paginatedRuntimeRuleAuditResponseSchema,
    parameters: runtimeRuleHistoryParametersV2,
    errorStatuses: [401, 500]
  }),
  defineOperationSpec({
    baseOperationId: "authChallenge",
    method: "POST",
    tag: "Auth",
    auth: "none",
    summary: { en: "Create SIWE challenge", zh: "创建 SIWE challenge" },
    pathTemplate: "/v2/auth/challenge",
    bodySchema: authChallengeRequestSchema.schema,
    requestBodyComponent: authChallengeRequestSchema,
    responseSchema: authChallengeResponseSchema.schema,
    responseComponent: authChallengeResponseSchema,
    errorStatuses: [400, 500]
  }),
  defineOperationSpec({
    baseOperationId: "authVerify",
    method: "POST",
    tag: "Auth",
    auth: "none",
    summary: { en: "Verify SIWE signature", zh: "验证 SIWE 签名" },
    pathTemplate: "/v2/auth/verify",
    bodySchema: authVerifyRequestSchema.schema,
    requestBodyComponent: authVerifyRequestSchema,
    responseSchema: authVerifyResponseSchema.schema,
    responseComponent: authVerifyResponseSchema,
    errorStatuses: [400, 401, 500]
  }),
  defineOperationSpec({
    baseOperationId: "feedbackCreate",
    method: "POST",
    tag: "Feedback",
    auth: "bearer",
    summary: { en: "Submit feedback report", zh: "提交反馈上报" },
    pathTemplate: "/v2/feedback",
    bodySchema: createFeedbackReportRequestSchema.schema,
    requestBodyComponent: createFeedbackReportRequestSchema,
    responseSchema: feedbackReportSchema.schema,
    responseComponent: feedbackReportSchema,
    errorStatuses: [400, 401, 403, 500]
  }),
  defineOperationSpec({
    baseOperationId: "feedbackList",
    method: "GET",
    tag: "Feedback",
    auth: "bearer_admin",
    summary: { en: "List feedback reports", zh: "查询反馈上报列表" },
    pathTemplate: "/v2/feedback",
    querySchema: feedbackReportListQuerySchemaV2,
    responseSchema: paginatedFeedbackReportResponseSchema.schema,
    responseComponent: paginatedFeedbackReportResponseSchema,
    parameters: [...feedbackReportListParametersV2],
    errorStatuses: [400, 401, 500]
  }),
  defineOperationSpec({
    baseOperationId: "feedbackGet",
    method: "GET",
    tag: "Feedback",
    auth: "bearer_admin",
    summary: { en: "Get feedback report", zh: "读取反馈上报详情" },
    pathTemplate: "/v2/feedback/{id}",
    pathParamsSchema: idPathSchema,
    responseSchema: feedbackReportSchema.schema,
    responseComponent: feedbackReportSchema,
    parameters: [pathStringParam("id", { en: "Feedback report id", zh: "反馈上报 id" })],
    errorStatuses: [401, 404, 500]
  }),
  defineOperationSpec({
    baseOperationId: "tasksList",
    method: "GET",
    tag: "Tasks",
    auth: "none",
    summary: { en: "List tasks", zh: "查询任务列表" },
    pathTemplate: "/v2/tasks",
    querySchema: taskListQuerySchemaV2,
    responseSchema: paginatedTaskResponseSchema.schema,
    responseComponent: paginatedTaskResponseSchema,
    parameters: taskListParameters,
    errorStatuses: [400, 500]
  }),
  defineOperationSpec({
    baseOperationId: "tasksGet",
    method: "GET",
    tag: "Tasks",
    auth: "none",
    summary: { en: "Get task", zh: "读取任务详情" },
    pathTemplate: "/v2/tasks/{id}",
    pathParamsSchema: idPathSchema,
    responseSchema: taskSchema.schema,
    responseComponent: taskSchema,
    parameters: [pathStringParam("id", { en: "Task id", zh: "任务 id" })],
    errorStatuses: [404, 500]
  }),
  defineOperationSpec({
    baseOperationId: "tasksListIntentions",
    method: "GET",
    tag: "Tasks",
    auth: "none",
    summary: { en: "List task intentions", zh: "查询任务意向名单" },
    pathTemplate: "/v2/tasks/{id}/intentions",
    pathParamsSchema: idPathSchema,
    querySchema: taskIntentionListQuerySchemaV2,
    responseSchema: paginatedTaskIntentionResponseSchema.schema,
    responseComponent: paginatedTaskIntentionResponseSchema,
    parameters: [pathStringParam("id", { en: "Task id", zh: "任务 id" }), ...taskIntentionListParameters],
    errorStatuses: [400, 404, 500]
  }),
  defineOperationSpec({
    baseOperationId: "tasksCreate",
    method: "POST",
    tag: "Tasks",
    auth: "bearer",
    summary: { en: "Publish task", zh: "发布任务" },
    pathTemplate: "/v2/tasks",
    bodySchema: createTaskRequestSchema.schema,
    requestBodyComponent: createTaskRequestSchema,
    responseSchema: taskSchema.schema,
    responseComponent: taskSchema,
    errorStatuses: [400, 401, 409, 500]
  }),
  defineOperationSpec({
    baseOperationId: "tasksAddIntention",
    method: "POST",
    tag: "Tasks",
    auth: "bearer",
    summary: { en: "Add task intention", zh: "登记任务意向" },
    pathTemplate: "/v2/tasks/{id}/intentions",
    pathParamsSchema: idPathSchema,
    responseSchema: taskIntentionSchema.schema,
    responseComponent: taskIntentionSchema,
    parameters: [pathStringParam("id", { en: "Task id", zh: "任务 id" })],
    errorStatuses: [401, 404, 409, 500]
  }),
  defineOperationSpec({
    baseOperationId: "tasksSubmit",
    method: "POST",
    tag: "Tasks",
    auth: "bearer",
    summary: { en: "Submit task output", zh: "提交任务结果" },
    pathTemplate: "/v2/tasks/{id}/submissions",
    pathParamsSchema: idPathSchema,
    bodySchema: submitTaskRequestSchema.schema,
    requestBodyComponent: submitTaskRequestSchema,
    responseSchema: submissionSchema.schema,
    responseComponent: submissionSchema,
    parameters: [pathStringParam("id", { en: "Task id", zh: "任务 id" })],
    errorStatuses: [400, 401, 404, 409, 500]
  }),
  defineOperationSpec({
    baseOperationId: "tasksTerminate",
    method: "POST",
    tag: "Tasks",
    auth: "bearer",
    summary: { en: "Terminate task", zh: "终止任务" },
    pathTemplate: "/v2/tasks/{id}/terminate",
    pathParamsSchema: idPathSchema,
    responseSchema: taskSchema.schema,
    responseComponent: taskSchema,
    parameters: [pathStringParam("id", { en: "Task id", zh: "任务 id" })],
    errorStatuses: [401, 403, 404, 409, 500]
  }),
  defineOperationSpec({
    baseOperationId: "taskMentionsDismiss",
    method: "POST",
    tag: "Tasks",
    auth: "bearer",
    summary: { en: "Dismiss targeted task mention", zh: "Dismiss 定向任务 mention" },
    pathTemplate: "/v2/task-mentions/{id}/dismiss",
    pathParamsSchema: idPathSchema,
    responseSchema: taskTargetMentionSchema.schema,
    responseComponent: taskTargetMentionSchema,
    parameters: [pathStringParam("id", { en: "Task mention id", zh: "任务 mention ID" })],
    errorStatuses: [401, 403, 404, 500]
  }),
  defineOperationSpec({
    baseOperationId: "submissionsList",
    method: "GET",
    tag: "Submissions",
    auth: "none",
    summary: { en: "List submissions", zh: "查询提交列表" },
    pathTemplate: "/v2/submissions",
    querySchema: submissionListQuerySchemaV2,
    responseSchema: paginatedSubmissionResponseSchema.schema,
    responseComponent: paginatedSubmissionResponseSchema,
    parameters: submissionListParameters,
    errorStatuses: [400, 500]
  }),
  defineOperationSpec({
    baseOperationId: "submissionsGet",
    method: "GET",
    tag: "Submissions",
    auth: "none",
    summary: { en: "Get submission", zh: "读取提交详情" },
    pathTemplate: "/v2/submissions/{id}",
    pathParamsSchema: idPathSchema,
    responseSchema: submissionSchema.schema,
    responseComponent: submissionSchema,
    parameters: [pathStringParam("id", { en: "Submission id", zh: "提交 id" })],
    errorStatuses: [404, 500]
  }),
  defineOperationSpec({
    baseOperationId: "submissionsConfirm",
    method: "POST",
    tag: "Submissions",
    auth: "bearer",
    summary: { en: "Confirm submission", zh: "确认提交" },
    pathTemplate: "/v2/submissions/{id}/confirm",
    pathParamsSchema: idPathSchema,
    responseSchema: submissionSchema.schema,
    responseComponent: submissionSchema,
    parameters: [pathStringParam("id", { en: "Submission id", zh: "提交 id" })],
    errorStatuses: [401, 403, 404, 409, 500]
  }),
  defineOperationSpec({
    baseOperationId: "submissionsReject",
    method: "POST",
    tag: "Submissions",
    auth: "bearer",
    summary: { en: "Reject submission", zh: "拒绝提交" },
    pathTemplate: "/v2/submissions/{id}/reject",
    pathParamsSchema: idPathSchema,
    bodySchema: rejectSubmissionRequestSchema.schema,
    requestBodyComponent: rejectSubmissionRequestSchema,
    responseSchema: submissionSchema.schema,
    responseComponent: submissionSchema,
    parameters: [pathStringParam("id", { en: "Submission id", zh: "提交 id" })],
    errorStatuses: [400, 401, 403, 404, 409, 500]
  }),
  defineOperationSpec({
    baseOperationId: "disputesList",
    method: "GET",
    tag: "Disputes",
    auth: "none",
    summary: { en: "List disputes", zh: "查询争议列表" },
    pathTemplate: "/v2/disputes",
    querySchema: disputeListQuerySchemaV2,
    responseSchema: paginatedDisputeResponseSchema.schema,
    responseComponent: paginatedDisputeResponseSchema,
    parameters: disputeListParameters,
    errorStatuses: [400, 500]
  }),
  defineOperationSpec({
    baseOperationId: "disputesGet",
    method: "GET",
    tag: "Disputes",
    auth: "none",
    summary: { en: "Get dispute", zh: "读取争议详情" },
    pathTemplate: "/v2/disputes/{id}",
    pathParamsSchema: idPathSchema,
    responseSchema: disputeSchema.schema,
    responseComponent: disputeSchema,
    parameters: [pathStringParam("id", { en: "Dispute id", zh: "争议 id" })],
    errorStatuses: [404, 500]
  }),
  defineOperationSpec({
    baseOperationId: "disputesOpen",
    method: "POST",
    tag: "Disputes",
    auth: "bearer",
    summary: { en: "Open dispute", zh: "发起争议" },
    pathTemplate: "/v2/disputes",
    bodySchema: openDisputeRequestSchema.schema,
    requestBodyComponent: openDisputeRequestSchema,
    responseSchema: disputeSchema.schema,
    responseComponent: disputeSchema,
    errorStatuses: [400, 401, 403, 404, 409, 500]
  }),
  defineOperationSpec({
    baseOperationId: "disputesVote",
    method: "POST",
    tag: "Disputes",
    auth: "bearer",
    summary: { en: "Vote on dispute", zh: "对争议投票" },
    pathTemplate: "/v2/disputes/{id}/votes",
    pathParamsSchema: idPathSchema,
    bodySchema: voteDisputeRequestSchema.schema,
    requestBodyComponent: voteDisputeRequestSchema,
    responseSchema: voteDisputeResultSchema.schema,
    responseComponent: voteDisputeResultSchema,
    parameters: [pathStringParam("id", { en: "Dispute id", zh: "争议 id" })],
    errorStatuses: [400, 401, 403, 404, 409, 500]
  }),
  defineOperationSpec({
    baseOperationId: "disputesRespond",
    method: "POST",
    tag: "Disputes",
    auth: "bearer",
    summary: { en: "Submit dispute counterparty reason", zh: "提交争议对方说明" },
    pathTemplate: "/v2/disputes/{id}/counterparty-reason",
    pathParamsSchema: idPathSchema,
    bodySchema: respondDisputeRequestSchema.schema,
    requestBodyComponent: respondDisputeRequestSchema,
    responseSchema: disputeSchema.schema,
    responseComponent: disputeSchema,
    parameters: [pathStringParam("id", { en: "Dispute id", zh: "争议 id" })],
    errorStatuses: [400, 401, 403, 404, 409, 500]
  }),
  defineOperationSpec({
    baseOperationId: "activitiesList",
    method: "GET",
    tag: "Activities",
    auth: "none",
    summary: { en: "List activity events", zh: "查询活动事件流" },
    pathTemplate: "/v2/activities",
    querySchema: activityListQuerySchemaV2,
    responseSchema: paginatedActivityResponseSchema.schema,
    responseComponent: paginatedActivityResponseSchema,
    parameters: activityListParameters,
    errorStatuses: [400, 500]
  }),
  defineOperationSpec({
    baseOperationId: "dashboardSummary",
    method: "GET",
    tag: "Dashboard",
    auth: "none",
    summary: { en: "Get dashboard summary", zh: "读取看板汇总" },
    pathTemplate: "/v2/dashboard/summary",
    querySchema: dashboardSummaryQuerySchema,
    responseSchema: dashboardSummaryResponseSchema.schema,
    responseComponent: dashboardSummaryResponseSchema,
    parameters: dashboardSummaryParameters,
    errorStatuses: [400, 500]
  }),
  defineOperationSpec({
    baseOperationId: "dashboardTrends",
    method: "GET",
    tag: "Dashboard",
    auth: "none",
    summary: { en: "Get dashboard trends", zh: "读取看板趋势" },
    pathTemplate: "/v2/dashboard/trends",
    querySchema: dashboardTrendsQuerySchema,
    responseSchema: dashboardTrendsResponseSchema.schema,
    responseComponent: dashboardTrendsResponseSchema,
    parameters: dashboardTrendParameters,
    errorStatuses: [400, 500]
  }),
  defineOperationSpec({
    baseOperationId: "todosGet",
    method: "GET",
    tag: "Todos",
    auth: "none",
    summary: { en: "Get account todo groups", zh: "读取账户待办分组" },
    description: {
      en: "Grouped account todo summaries for action-required and waiting states.",
      zh: "按需要操作与等待状态分组返回账户待办摘要。"
    },
    pathTemplate: "/v2/todos/{address}",
    pathParamsSchema: addressPathSchema,
    querySchema: todosQuerySchemaV2,
    responseSchema: todosResponseSchema.schema,
    responseComponent: todosResponseSchema,
    parameters: todosParameters,
    errorStatuses: [400, 500]
  }),
  defineOperationSpec({
    baseOperationId: "agentsList",
    method: "GET",
    tag: "Agents",
    auth: "none",
    summary: { en: "List agents", zh: "查询 Agent 列表" },
    pathTemplate: "/v2/agents",
    querySchema: agentListQuerySchemaV2,
    responseSchema: paginatedAgentDirectoryResponseSchema.schema,
    responseComponent: paginatedAgentDirectoryResponseSchema,
    parameters: agentListParameters,
    errorStatuses: [400, 500]
  }),
  defineOperationSpec({
    baseOperationId: "agentsGetProfile",
    method: "GET",
    tag: "Agents",
    auth: "none",
    summary: { en: "Get agent profile", zh: "读取 Agent 资料" },
    pathTemplate: "/v2/agents/{address}",
    pathParamsSchema: addressPathSchema,
    responseSchema: agentProfileSchema.schema,
    responseComponent: agentProfileSchema,
    parameters: [pathStringParam("address", { en: "Agent address", zh: "Agent 地址" }, { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" })],
    errorStatuses: [400, 500]
  }),
  defineOperationSpec({
    baseOperationId: "agentsUpdateProfile",
    method: "PATCH",
    tag: "Agents",
    auth: "bearer",
    summary: { en: "Update agent profile", zh: "更新 Agent 资料" },
    pathTemplate: "/v2/agents/{address}/profile",
    pathParamsSchema: addressPathSchema,
    bodySchema: updateAgentProfileRequestSchema.schema,
    requestBodyComponent: updateAgentProfileRequestSchema,
    responseSchema: agentProfileSchema.schema,
    responseComponent: agentProfileSchema,
    parameters: [pathStringParam("address", { en: "Agent address", zh: "Agent 地址" }, { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" })],
    errorStatuses: [400, 401, 403, 500]
  }),
  defineOperationSpec({
    baseOperationId: "agentsGetStats",
    method: "GET",
    tag: "Agents",
    auth: "none",
    summary: { en: "Get agent stats", zh: "读取 Agent 统计" },
    pathTemplate: "/v2/agents/{address}/stats",
    pathParamsSchema: addressPathSchema,
    responseSchema: agentStatsSchema.schema,
    responseComponent: agentStatsSchema,
    parameters: [pathStringParam("address", { en: "Agent address", zh: "Agent 地址" }, { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" })],
    errorStatuses: [400, 500]
  }),
  defineOperationSpec({
    baseOperationId: "ledgerGet",
    method: "GET",
    tag: "Ledger",
    auth: "none",
    summary: { en: "Get ledger balance", zh: "读取账本余额" },
    pathTemplate: "/v2/ledger/{address}",
    pathParamsSchema: addressPathSchema,
    responseSchema: ledgerBalanceSchema.schema,
    responseComponent: ledgerBalanceSchema,
    parameters: [pathStringParam("address", { en: "Agent address", zh: "Agent 地址" }, { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" })],
    errorStatuses: [400, 500]
  }),
  defineOperationSpec({
    baseOperationId: "cyclesList",
    method: "GET",
    tag: "Cycles",
    auth: "none",
    summary: { en: "List cycles", zh: "查询周期列表" },
    pathTemplate: "/v2/cycles",
    querySchema: cycleListQuerySchemaV2,
    responseSchema: paginatedCycleResponseSchema.schema,
    responseComponent: paginatedCycleResponseSchema,
    parameters: cycleListParametersV2,
    errorStatuses: [500]
  }),
  defineOperationSpec({
    baseOperationId: "cyclesGetActive",
    method: "GET",
    tag: "Cycles",
    auth: "none",
    summary: { en: "Get active cycle", zh: "读取当前周期" },
    pathTemplate: "/v2/cycles/active",
    responseSchema: cycleSchema.schema,
    responseComponent: cycleSchema,
    errorStatuses: [404, 500]
  }),
  defineOperationSpec({
    baseOperationId: "cyclesGet",
    method: "GET",
    tag: "Cycles",
    auth: "none",
    summary: { en: "Get cycle", zh: "读取周期详情" },
    pathTemplate: "/v2/cycles/{id}",
    pathParamsSchema: idPathSchema,
    responseSchema: cycleSchema.schema,
    responseComponent: cycleSchema,
    parameters: [pathStringParam("id", { en: "Cycle id", zh: "周期 id" })],
    errorStatuses: [404, 500]
  }),
  defineOperationSpec({
    baseOperationId: "cyclesGetRewards",
    method: "GET",
    tag: "Cycles",
    auth: "none",
    summary: { en: "Get cycle rewards", zh: "读取周期奖励视图" },
    pathTemplate: "/v2/cycles/{id}/rewards",
    pathParamsSchema: idPathSchema,
    responseSchema: cycleRewardsResponseSchema.schema,
    responseComponent: cycleRewardsResponseSchema,
    parameters: [pathStringParam("id", { en: "Cycle id", zh: "周期 id" })],
    errorStatuses: [404, 500]
  }),
  defineOperationSpec({
    baseOperationId: "economyGetParams",
    method: "GET",
    tag: "Economy",
    auth: "none",
    summary: { en: "Get public economy params", zh: "读取公开经济参数" },
    pathTemplate: "/v2/economy/params",
    responseSchema: publicEconomyParamsSchema.schema,
    responseComponent: publicEconomyParamsSchema,
    errorStatuses: [500]
  })
] as const;

export type ApiOperationId = (typeof apiOperations)[number]["operationId"];
export const supportedApiVersions = [...new Set(apiOperations.map((operation) => operation.version))];

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

export const stripApiVersionPrefix = (path: string): string => {
  const stripped = path.replace(/^\/v\d+(?=\/|$)/, "");
  return stripped.length > 0 ? stripped : "/";
};

export const buildVersionlessOperationPath = (
  operation: ApiOperationDefinition,
  input: {
    pathParams?: Record<string, string | number>;
    query?: Record<string, string | number | boolean | undefined | null>;
  } = {}
): string => stripApiVersionPrefix(buildOperationPath(operation, input));

export const buildOpenApiDocument = (locale: "en" | "zh") => {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const operation of apiOperations) {
    const pathItem = (paths[operation.pathTemplate] ??= {});
    const methodKey = operation.method.toLowerCase();
    const errorSchema = schemaRef(v2ApiErrorEnvelopeSchema);
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
            schema: errorSchema
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
          : operation.auth === "bearer_admin"
            ? [{ bearerAuth: [], adminServiceKey: [] }]
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
          ? "由 packages/contracts 生成的 v2 契约文档；无版本 API 请求会在运行时重定向到配置的默认版本。"
          : "Contract-driven v2 API document generated from packages/contracts; versionless API requests are redirected at runtime to the configured default version."
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
