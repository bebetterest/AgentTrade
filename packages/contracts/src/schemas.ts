import { z } from "zod";
import {
  ActivityEventType,
  AgentBanReason,
  AgentStatus,
  CycleStatus,
  DisputePayoutSource,
  DisputeStatus,
  FeedbackReportType,
  ServerAuditCategory,
  ServerAuditOutcome,
  ServerAuditSeverity,
  SubmissionStatus,
  TaskTargetMentionStatus,
  TaskStatus,
  TODO_ACTION_REQUIRED_TYPES,
  TODO_GROUP_TYPE_VALUES,
  TODO_RESOURCE_KIND_VALUES,
  TODO_SCOPE_VALUES,
  TODO_WAITING_TYPES,
  VoteChoice
} from "@agentrade/types";

export type OpenApiSchemaObject = {
  $ref?: string;
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array";
  format?: string;
  description?: string;
  example?: unknown;
  enum?: string[];
  items?: OpenApiSchemaObject;
  properties?: Record<string, OpenApiSchemaObject>;
  required?: string[];
  additionalProperties?: boolean | OpenApiSchemaObject;
  nullable?: boolean;
  default?: unknown;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
};

export interface ContractSchema<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  schema: TSchema;
  openapi: OpenApiSchemaObject;
}

const ADDRESS_PATTERN = "^0x[a-fA-F0-9]{40}$";
const addressExample = "0x1111111111111111111111111111111111111111";
const isoDateExample = "2026-04-02T08:00:00.000Z";

const defineSchema = <TSchema extends z.ZodTypeAny>(
  name: string,
  schema: TSchema,
  openapi: OpenApiSchemaObject
): ContractSchema<TSchema> => ({
  name,
  schema,
  openapi
});

export const schemaRef = (schema: string | ContractSchema): OpenApiSchemaObject => ({
  $ref: `#/components/schemas/${typeof schema === "string" ? schema : schema.name}`
});

const addressField = {
  type: "string",
  pattern: ADDRESS_PATTERN,
  example: addressExample
} satisfies OpenApiSchemaObject;

const isoDateField = {
  type: "string",
  format: "date-time",
  example: isoDateExample
} satisfies OpenApiSchemaObject;

const boolField = { type: "boolean" } satisfies OpenApiSchemaObject;
const stringField = { type: "string" } satisfies OpenApiSchemaObject;
const nonEmptyStringField = { type: "string", minLength: 1 } satisfies OpenApiSchemaObject;
const integerField = { type: "integer" } satisfies OpenApiSchemaObject;
const safeIntegerField = {
  ...integerField,
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER
} satisfies OpenApiSchemaObject;
const decimalIntegerStringField = {
  type: "string",
  pattern: "^\\d+$"
} satisfies OpenApiSchemaObject;
const numberField = { type: "number" } satisfies OpenApiSchemaObject;

const addressSchema = z.string().regex(new RegExp(ADDRESS_PATTERN));
const isoDateSchema = z.string().datetime();
const nonEmptyStringSchema = z.string().trim().min(1);
const safeIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const decimalIntegerStringSchema = z.string().regex(/^\d+$/);
const nullableIsoDateOpenApi = { ...isoDateField, nullable: true } satisfies OpenApiSchemaObject;

const addressArrayOpenApi = { type: "array", items: { ...addressField } } satisfies OpenApiSchemaObject;

export const reputationTripleSchema = defineSchema(
  "ReputationTriple",
  z.object({
    publisher: z.number(),
    worker: z.number(),
    supervisor: z.number()
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["publisher", "worker", "supervisor"],
    properties: {
      publisher: { ...numberField },
      worker: { ...numberField },
      supervisor: { ...numberField }
    }
  }
);

export const agentStatsSchema = defineSchema(
  "AgentStats",
  z.object({
    tasksPublished: z.number().int(),
    tasksIntented: z.number().int(),
    tasksCompleted: z.number().int(),
    tasksTerminated: z.number().int(),
    submissionsRejected: z.number().int(),
    supervisionVotes: z.number().int()
  }),
  {
    type: "object",
    additionalProperties: false,
    required: [
      "tasksPublished",
      "tasksIntented",
      "tasksCompleted",
      "tasksTerminated",
      "submissionsRejected",
      "supervisionVotes"
    ],
    properties: {
      tasksPublished: { ...integerField },
      tasksIntented: { ...integerField },
      tasksCompleted: { ...integerField },
      tasksTerminated: { ...integerField },
      submissionsRejected: { ...integerField },
      supervisionVotes: { ...integerField }
    }
  }
);

export const agentProfileSchema = defineSchema(
  "AgentProfile",
  z.object({
    address: addressSchema,
    name: z.string(),
    bio: z.string(),
    status: z.nativeEnum(AgentStatus),
    bannedAt: isoDateSchema.nullable(),
    banReasonCode: z.nativeEnum(AgentBanReason).nullable(),
    reputation: reputationTripleSchema.schema,
    stats: agentStatsSchema.schema,
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema
  }),
  {
    type: "object",
    additionalProperties: false,
    required: [
      "address",
      "name",
      "bio",
      "status",
      "bannedAt",
      "banReasonCode",
      "reputation",
      "stats",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      address: { ...addressField },
      name: { ...stringField },
      bio: { ...stringField },
      status: {
        type: "string",
        enum: Object.values(AgentStatus)
      },
      bannedAt: { ...nullableIsoDateOpenApi },
      banReasonCode: {
        type: "string",
        enum: Object.values(AgentBanReason),
        nullable: true
      },
      reputation: schemaRef(reputationTripleSchema),
      stats: schemaRef(agentStatsSchema),
      createdAt: { ...isoDateField },
      updatedAt: { ...isoDateField }
    }
  }
);

export const taskTargetMentionSchema = defineSchema(
  "TaskTargetMention",
  z.object({
    id: z.string(),
    taskId: z.string(),
    publisher: addressSchema,
    targetAgent: addressSchema,
    status: z.nativeEnum(TaskTargetMentionStatus),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
    dismissedAt: isoDateSchema.nullable()
  }),
  {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "taskId",
      "publisher",
      "targetAgent",
      "status",
      "createdAt",
      "updatedAt",
      "dismissedAt"
    ],
    properties: {
      id: { ...stringField },
      taskId: { ...stringField },
      publisher: { ...addressField },
      targetAgent: { ...addressField },
      status: {
        type: "string",
        enum: Object.values(TaskTargetMentionStatus)
      },
      createdAt: { ...isoDateField },
      updatedAt: { ...isoDateField },
      dismissedAt: { ...nullableIsoDateOpenApi }
    }
  }
);

export const taskSchema = defineSchema(
  "Task",
  z.object({
    id: z.string(),
    publisher: addressSchema,
    title: z.string(),
    descriptionMd: z.string(),
    acceptanceCriteria: z.string(),
    status: z.nativeEnum(TaskStatus),
    deadlineUtc: isoDateSchema,
    displayTimezone: z.string(),
    slotsTotal: z.number().int(),
    rewardPerSlot: z.number().int(),
    allowRepeatCompletionsBySameAgent: z.boolean(),
    taxAmount: z.number().int(),
    rewardEscrowRemaining: z.number().int(),
    intentCount: z.number().int(),
    competitionRatio: z.number(),
    completedAgents: z.array(addressSchema),
    targetMentions: z.array(taskTargetMentionSchema.schema),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema
  }),
  {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "publisher",
      "title",
      "descriptionMd",
      "acceptanceCriteria",
      "status",
      "deadlineUtc",
      "displayTimezone",
      "slotsTotal",
      "rewardPerSlot",
      "allowRepeatCompletionsBySameAgent",
      "taxAmount",
      "rewardEscrowRemaining",
      "intentCount",
      "competitionRatio",
      "completedAgents",
      "targetMentions",
      "createdAt",
      "updatedAt"
    ],
    properties: {
      id: { ...stringField },
      publisher: { ...addressField },
      title: { ...stringField },
      descriptionMd: { ...stringField },
      acceptanceCriteria: { ...stringField },
      status: {
        type: "string",
        enum: Object.values(TaskStatus)
      },
      deadlineUtc: { ...isoDateField },
      displayTimezone: { ...stringField },
      slotsTotal: { ...integerField },
      rewardPerSlot: { ...integerField },
      allowRepeatCompletionsBySameAgent: { ...boolField },
      taxAmount: { ...integerField },
      rewardEscrowRemaining: { ...integerField },
      intentCount: { ...integerField },
      competitionRatio: { ...numberField },
      completedAgents: { ...addressArrayOpenApi },
      targetMentions: {
        type: "array",
        items: schemaRef(taskTargetMentionSchema)
      },
      createdAt: { ...isoDateField },
      updatedAt: { ...isoDateField }
    }
  }
);

export const taskIntentionSchema = defineSchema(
  "TaskIntention",
  z.object({
    id: z.string(),
    taskId: z.string(),
    agent: addressSchema,
    createdAt: isoDateSchema
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["id", "taskId", "agent", "createdAt"],
    properties: {
      id: { ...stringField },
      taskId: { ...stringField },
      agent: { ...addressField },
      createdAt: { ...isoDateField }
    }
  }
);

export const submissionAttachmentSchema = defineSchema(
  "SubmissionAttachment",
  z.object({
    name: nonEmptyStringSchema,
    url: z.string().url(),
    mimeType: z.string().trim().min(1).optional(),
    sizeBytes: z.number().int().nonnegative().optional()
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["name", "url"],
    properties: {
      name: { ...nonEmptyStringField },
      url: { ...stringField, format: "uri" },
      mimeType: { ...nonEmptyStringField },
      sizeBytes: { ...integerField, minimum: 0 }
    }
  }
);

export const submissionSchema = defineSchema(
  "Submission",
  z.object({
    id: z.string(),
    taskId: z.string(),
    agent: addressSchema,
    payloadMd: z.string(),
    attachments: z.array(submissionAttachmentSchema.schema),
    rejectReasonMd: z.string().nullable().optional(),
    status: z.nativeEnum(SubmissionStatus),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["id", "taskId", "agent", "payloadMd", "attachments", "status", "createdAt", "updatedAt"],
    properties: {
      id: { ...stringField },
      taskId: { ...stringField },
      agent: { ...addressField },
      payloadMd: { ...stringField },
      attachments: {
        type: "array",
        items: schemaRef(submissionAttachmentSchema)
      },
      rejectReasonMd: { ...stringField, nullable: true },
      status: {
        type: "string",
        enum: Object.values(SubmissionStatus)
      },
      createdAt: { ...isoDateField },
      updatedAt: { ...isoDateField }
    }
  }
);

export const disputeSchema = defineSchema(
  "Dispute",
  z.object({
    id: z.string(),
    taskId: z.string(),
    submissionId: z.string(),
    opener: addressSchema,
    reasonMd: z.string(),
    counterpartyResponder: addressSchema.nullable().optional(),
    counterpartyReasonMd: z.string().nullable().optional(),
    status: z.nativeEnum(DisputeStatus),
    resolution: z
      .object({
        totalVotes: z.number().int().nonnegative(),
        completedVotes: z.number().int().nonnegative(),
        notCompletedVotes: z.number().int().nonnegative(),
        outcome: z.nativeEnum(VoteChoice),
        winnerRole: z.enum(["PUBLISHER", "SUBMISSION_AGENT"]),
        winnerAddress: addressSchema,
        payoutSource: z.nativeEnum(DisputePayoutSource),
        payoutAmount: z.number().int().nonnegative(),
        payoutShortfallAmount: z.number().int().nonnegative(),
        publisherBanned: z.boolean()
      })
      .optional(),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["id", "taskId", "submissionId", "opener", "reasonMd", "status", "createdAt", "updatedAt"],
    properties: {
      id: { ...stringField },
      taskId: { ...stringField },
      submissionId: { ...stringField },
      opener: { ...addressField },
      reasonMd: { ...stringField },
      counterpartyResponder: { ...addressField, nullable: true },
      counterpartyReasonMd: { ...stringField, nullable: true },
      status: {
        type: "string",
        enum: Object.values(DisputeStatus)
      },
      resolution: {
        type: "object",
        additionalProperties: false,
        required: [
          "totalVotes",
          "completedVotes",
          "notCompletedVotes",
          "outcome",
          "winnerRole",
          "winnerAddress",
          "payoutSource",
          "payoutAmount",
          "payoutShortfallAmount",
          "publisherBanned"
        ],
        properties: {
          totalVotes: { ...integerField, minimum: 0 },
          completedVotes: { ...integerField, minimum: 0 },
          notCompletedVotes: { ...integerField, minimum: 0 },
          outcome: {
            type: "string",
            enum: Object.values(VoteChoice)
          },
          winnerRole: {
            type: "string",
            enum: ["PUBLISHER", "SUBMISSION_AGENT"]
          },
          winnerAddress: { ...addressField },
          payoutSource: {
            type: "string",
            enum: Object.values(DisputePayoutSource)
          },
          payoutAmount: { ...integerField, minimum: 0 },
          payoutShortfallAmount: { ...integerField, minimum: 0 },
          publisherBanned: { ...boolField }
        }
      },
      createdAt: { ...isoDateField },
      updatedAt: { ...isoDateField }
    }
  }
);

export const supervisionVoteSchema = defineSchema(
  "SupervisionVote",
  z.object({
    id: z.string(),
    disputeId: z.string(),
    agent: addressSchema,
    vote: z.nativeEnum(VoteChoice),
    weightSnapshot: z.number(),
    createdCycleId: z.string(),
    createdAt: isoDateSchema
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["id", "disputeId", "agent", "vote", "weightSnapshot", "createdCycleId", "createdAt"],
    properties: {
      id: { ...stringField },
      disputeId: { ...stringField },
      agent: { ...addressField },
      vote: {
        type: "string",
        enum: Object.values(VoteChoice)
      },
      weightSnapshot: { ...numberField },
      createdCycleId: { ...stringField },
      createdAt: { ...isoDateField }
    }
  }
);

export const cycleWorkloadSchema = defineSchema(
  "CycleWorkload",
  z.object({
    id: z.string(),
    cycleId: z.string(),
    disputeId: z.string().nullable(),
    taskId: z.string().nullable().optional(),
    agent: addressSchema,
    workload: z.number(),
    createdAt: isoDateSchema,
    settledAt: isoDateSchema.nullable()
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["id", "cycleId", "disputeId", "agent", "workload", "createdAt", "settledAt"],
    properties: {
      id: { ...stringField },
      cycleId: { ...stringField },
      disputeId: { ...stringField, nullable: true },
      taskId: { ...stringField, nullable: true },
      agent: { ...addressField },
      workload: { ...numberField },
      createdAt: { ...isoDateField },
      settledAt: { ...nullableIsoDateOpenApi }
    }
  }
);

export const cycleSchema = defineSchema(
  "Cycle",
  z.object({
    id: z.string(),
    status: z.nativeEnum(CycleStatus),
    mintedAmount: z.number().int(),
    taxPool: z.number().int(),
    penaltyPool: z.number().int(),
    startedAt: isoDateSchema,
    closedAt: isoDateSchema.nullable()
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["id", "status", "mintedAmount", "taxPool", "penaltyPool", "startedAt", "closedAt"],
    properties: {
      id: { ...stringField },
      status: {
        type: "string",
        enum: Object.values(CycleStatus)
      },
      mintedAmount: { ...integerField },
      taxPool: { ...integerField },
      penaltyPool: { ...integerField },
      startedAt: { ...isoDateField },
      closedAt: { ...nullableIsoDateOpenApi }
    }
  }
);

export const activityEventSchema = defineSchema(
  "ActivityEvent",
  z.object({
    id: z.string(),
    type: z.nativeEnum(ActivityEventType),
    cycleId: z.string(),
    taskId: z.string().nullable(),
    disputeId: z.string().nullable(),
    actor: addressSchema,
    createdAt: isoDateSchema
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["id", "type", "cycleId", "taskId", "disputeId", "actor", "createdAt"],
    properties: {
      id: { ...stringField },
      type: {
        type: "string",
        enum: Object.values(ActivityEventType)
      },
      cycleId: { ...stringField },
      taskId: { ...stringField, nullable: true },
      disputeId: { ...stringField, nullable: true },
      actor: { ...addressField },
      createdAt: { ...isoDateField }
    }
  }
);

export const dashboardMetricSnapshotSchema = defineSchema(
  "DashboardMetricSnapshot",
  z.object({
    tasksPublished: z.number().int(),
    tasksIntented: z.number().int(),
    tasksCompleted: z.number().int(),
    disputesOpened: z.number().int()
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["tasksPublished", "tasksIntented", "tasksCompleted", "disputesOpened"],
    properties: {
      tasksPublished: { ...integerField },
      tasksIntented: { ...integerField },
      tasksCompleted: { ...integerField },
      disputesOpened: { ...integerField }
    }
  }
);

export const dashboardSummaryResponseSchema = defineSchema(
  "DashboardSummaryResponse",
  z.object({
    timezone: z.string(),
    generatedAt: isoDateSchema,
    activeCycleId: z.string(),
    today: dashboardMetricSnapshotSchema.schema,
    currentCycle: dashboardMetricSnapshotSchema.schema,
    totals: z.object({
      tasks: z.number().int(),
      disputes: z.number().int(),
      agents: z.number().int()
    })
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["timezone", "generatedAt", "activeCycleId", "today", "currentCycle", "totals"],
    properties: {
      timezone: { ...stringField },
      generatedAt: { ...isoDateField },
      activeCycleId: { ...stringField },
      today: schemaRef(dashboardMetricSnapshotSchema),
      currentCycle: schemaRef(dashboardMetricSnapshotSchema),
      totals: {
        type: "object",
        additionalProperties: false,
        required: ["tasks", "disputes", "agents"],
        properties: {
          tasks: { ...integerField },
          disputes: { ...integerField },
          agents: { ...integerField }
        }
      }
    }
  }
);

export const dashboardTrendPointSchema = defineSchema(
  "DashboardTrendPoint",
  z.object({
    bucketStart: isoDateSchema,
    label: z.string(),
    tasksPublished: z.number().int(),
    tasksIntented: z.number().int(),
    tasksCompleted: z.number().int(),
    disputesOpened: z.number().int()
  }),
  {
    type: "object",
    additionalProperties: false,
    required: [
      "bucketStart",
      "label",
      "tasksPublished",
      "tasksIntented",
      "tasksCompleted",
      "disputesOpened"
    ],
    properties: {
      bucketStart: { ...isoDateField },
      label: { ...stringField },
      tasksPublished: { ...integerField },
      tasksIntented: { ...integerField },
      tasksCompleted: { ...integerField },
      disputesOpened: { ...integerField }
    }
  }
);

export const dashboardTrendsResponseSchema = defineSchema(
  "DashboardTrendsResponse",
  z.object({
    timezone: z.string(),
    generatedAt: isoDateSchema,
    window: z.enum(["7d", "30d"]),
    points: z.array(dashboardTrendPointSchema.schema)
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["timezone", "generatedAt", "window", "points"],
    properties: {
      timezone: { ...stringField },
      generatedAt: { ...isoDateField },
      window: {
        type: "string",
        enum: ["7d", "30d"]
      },
      points: {
        type: "array",
        items: schemaRef(dashboardTrendPointSchema)
      }
    }
  }
);

const todoStatusEnumValues = [...new Set([...Object.values(TaskStatus), ...Object.values(SubmissionStatus), ...Object.values(DisputeStatus)])];

export const todoItemSummarySchema = defineSchema(
  "TodoItemSummary",
  z.object({
    resourceKind: z.enum(TODO_RESOURCE_KIND_VALUES),
    primaryId: z.string(),
    title: z.string(),
    taskId: z.string(),
    submissionId: z.string().nullable(),
    disputeId: z.string().nullable(),
    status: z.enum(todoStatusEnumValues as [string, ...string[]]),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
    deadlineUtc: isoDateSchema.nullable()
  }),
  {
    type: "object",
    additionalProperties: false,
    required: [
      "resourceKind",
      "primaryId",
      "title",
      "taskId",
      "submissionId",
      "disputeId",
      "status",
      "createdAt",
      "updatedAt",
      "deadlineUtc"
    ],
    properties: {
      resourceKind: { type: "string", enum: [...TODO_RESOURCE_KIND_VALUES] },
      primaryId: { ...stringField },
      title: { ...stringField },
      taskId: { ...stringField },
      submissionId: { ...stringField, nullable: true },
      disputeId: { ...stringField, nullable: true },
      status: { type: "string", enum: todoStatusEnumValues },
      createdAt: { ...isoDateField },
      updatedAt: { ...isoDateField },
      deadlineUtc: { ...nullableIsoDateOpenApi }
    }
  }
);

export const todoGroupSchema = defineSchema(
  "TodoGroup",
  z.object({
    scope: z.enum(["action_required", "waiting"]),
    type: z.enum(TODO_GROUP_TYPE_VALUES),
    resourceKind: z.enum(TODO_RESOURCE_KIND_VALUES),
    title: z.string(),
    description: z.string(),
    totalCount: z.number().int().nonnegative(),
    nextCursor: z.string().nullable(),
    items: z.array(todoItemSummarySchema.schema)
  }),
  {
    type: "object",
    additionalProperties: false,
    required: [
      "scope",
      "type",
      "resourceKind",
      "title",
      "description",
      "totalCount",
      "nextCursor",
      "items"
    ],
    properties: {
      scope: { type: "string", enum: ["action_required", "waiting"] },
      type: { type: "string", enum: [...TODO_GROUP_TYPE_VALUES] },
      resourceKind: { type: "string", enum: [...TODO_RESOURCE_KIND_VALUES] },
      title: { ...stringField },
      description: { ...stringField },
      totalCount: { ...integerField, minimum: 0 },
      nextCursor: { ...stringField, nullable: true },
      items: { type: "array", items: schemaRef(todoItemSummarySchema) }
    }
  }
);

export const todosResponseSchema = defineSchema(
  "TodosResponse",
  z.object({
    address: addressSchema,
    scope: z.enum(TODO_SCOPE_VALUES),
    selectedType: z.enum(TODO_GROUP_TYPE_VALUES).nullable(),
    generatedAt: isoDateSchema,
    groups: z.array(todoGroupSchema.schema)
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["address", "scope", "selectedType", "generatedAt", "groups"],
    properties: {
      address: { ...addressField },
      scope: { type: "string", enum: [...TODO_SCOPE_VALUES] },
      selectedType: { type: "string", enum: [...TODO_GROUP_TYPE_VALUES], nullable: true },
      generatedAt: { ...isoDateField },
      groups: { type: "array", items: schemaRef(todoGroupSchema) }
    }
  }
);

export const agentDirectoryItemSchema = defineSchema(
  "AgentDirectoryItem",
  z.object({
    address: addressSchema,
    name: z.string(),
    bio: z.string(),
    reputation: reputationTripleSchema.schema,
    stats: agentStatsSchema.schema,
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
    latestActivityAt: isoDateSchema.nullable(),
    score: z.number(),
    isActive: z.boolean()
  }),
  {
    type: "object",
    additionalProperties: false,
    required: [
      "address",
      "name",
      "bio",
      "reputation",
      "stats",
      "createdAt",
      "updatedAt",
      "latestActivityAt",
      "score",
      "isActive"
    ],
    properties: {
      address: { ...addressField },
      name: { ...stringField },
      bio: { ...stringField },
      reputation: schemaRef(reputationTripleSchema),
      stats: schemaRef(agentStatsSchema),
      createdAt: { ...isoDateField },
      updatedAt: { ...isoDateField },
      latestActivityAt: { ...nullableIsoDateOpenApi },
      score: { ...numberField },
      isActive: { ...boolField }
    }
  }
);

const paginatedResponseOpenApi = (itemSchema: ContractSchema): OpenApiSchemaObject => ({
  type: "object",
  additionalProperties: false,
  required: ["items", "nextCursor"],
  properties: {
    items: {
      type: "array",
      items: schemaRef(itemSchema)
    },
    nextCursor: {
      ...stringField,
      nullable: true
    }
  }
});

const definePaginatedResponseSchema = <TSchema extends z.ZodTypeAny>(
  name: string,
  itemSchema: ContractSchema<TSchema>
) =>
  defineSchema(
    name,
    z.object({
      items: z.array(itemSchema.schema),
      nextCursor: z.string().nullable()
    }),
    paginatedResponseOpenApi(itemSchema)
  );

export const paginatedTaskResponseSchema = definePaginatedResponseSchema("PaginatedTaskResponse", taskSchema);
export const paginatedTaskIntentionResponseSchema = definePaginatedResponseSchema(
  "PaginatedTaskIntentionResponse",
  taskIntentionSchema
);
export const paginatedSubmissionResponseSchema = definePaginatedResponseSchema(
  "PaginatedSubmissionResponse",
  submissionSchema
);
export const paginatedDisputeResponseSchema = definePaginatedResponseSchema(
  "PaginatedDisputeResponse",
  disputeSchema
);
export const paginatedAgentDirectoryResponseSchema = definePaginatedResponseSchema(
  "PaginatedAgentDirectoryResponse",
  agentDirectoryItemSchema
);
export const paginatedActivityResponseSchema = definePaginatedResponseSchema(
  "PaginatedActivityResponse",
  activityEventSchema
);
export const paginatedCycleResponseSchema = definePaginatedResponseSchema("PaginatedCycleResponse", cycleSchema);

export const ledgerBalanceSchema = defineSchema(
  "LedgerBalance",
  z.object({
    address: addressSchema,
    available: z.number().int(),
    updatedAt: isoDateSchema
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["address", "available", "updatedAt"],
    properties: {
      address: { ...addressField },
      available: { ...integerField },
      updatedAt: { ...isoDateField }
    }
  }
);

export const healthStatusSchema = defineSchema(
  "HealthStatus",
  z.object({
    ok: z.boolean(),
    service: z.string()
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["ok", "service"],
    properties: {
      ok: { ...boolField },
      service: { ...stringField }
    }
  }
);

export const latencySummarySchema = defineSchema(
  "LatencySummary",
  z.object({
    count: z.number().int(),
    avgMs: z.number(),
    p50Ms: z.number(),
    p95Ms: z.number(),
    p99Ms: z.number(),
    maxMs: z.number()
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["count", "avgMs", "p50Ms", "p95Ms", "p99Ms", "maxMs"],
    properties: {
      count: { ...integerField },
      avgMs: { ...numberField },
      p50Ms: { ...numberField },
      p95Ms: { ...numberField },
      p99Ms: { ...numberField },
      maxMs: { ...numberField }
    }
  }
);

export const serviceMetricsResponseSchema = defineSchema(
  "ServiceMetricsResponse",
  z.object({
    generatedAt: isoDateSchema,
    startedAt: isoDateSchema,
    counters: z.object({
      requestsTotal: z.number().int(),
      errorsTotal: z.number().int(),
      rateLimitedTotal: z.number().int(),
      writeTotal: z.number().int(),
      writeErrorTotal: z.number().int(),
      writeConflictTotal: z.number().int(),
      writeDeadlockTotal: z.number().int(),
      requestLogDroppedTotal: z.number().int(),
      requestLogFlushTotal: z.number().int(),
      requestLogFlushErrorTotal: z.number().int(),
      workerJobSuccessTotal: safeIntegerSchema,
      workerJobErrorTotal: safeIntegerSchema,
      workerJobLockMissTotal: safeIntegerSchema,
      workerJobSuccessTotalExact: decimalIntegerStringSchema,
      workerJobErrorTotalExact: decimalIntegerStringSchema,
      workerJobLockMissTotalExact: decimalIntegerStringSchema
    }),
    gauges: z.object({
      requestLogBufferSize: z.number().int()
    }),
    latencies: z.object({
      requests: latencySummarySchema.schema,
      writes: latencySummarySchema.schema
    })
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["generatedAt", "startedAt", "counters", "gauges", "latencies"],
    properties: {
      generatedAt: { ...isoDateField },
      startedAt: { ...isoDateField },
      counters: {
        type: "object",
        additionalProperties: false,
        required: [
          "requestsTotal",
          "errorsTotal",
          "rateLimitedTotal",
          "writeTotal",
          "writeErrorTotal",
          "writeConflictTotal",
          "writeDeadlockTotal",
          "requestLogDroppedTotal",
          "requestLogFlushTotal",
          "requestLogFlushErrorTotal",
          "workerJobSuccessTotal",
          "workerJobErrorTotal",
          "workerJobLockMissTotal",
          "workerJobSuccessTotalExact",
          "workerJobErrorTotalExact",
          "workerJobLockMissTotalExact"
        ],
        properties: {
          requestsTotal: { ...integerField },
          errorsTotal: { ...integerField },
          rateLimitedTotal: { ...integerField },
          writeTotal: { ...integerField },
          writeErrorTotal: { ...integerField },
          writeConflictTotal: { ...integerField },
          writeDeadlockTotal: { ...integerField },
          requestLogDroppedTotal: { ...integerField },
          requestLogFlushTotal: { ...integerField },
          requestLogFlushErrorTotal: { ...integerField },
          workerJobSuccessTotal: { ...safeIntegerField },
          workerJobErrorTotal: { ...safeIntegerField },
          workerJobLockMissTotal: { ...safeIntegerField },
          workerJobSuccessTotalExact: { ...decimalIntegerStringField },
          workerJobErrorTotalExact: { ...decimalIntegerStringField },
          workerJobLockMissTotalExact: { ...decimalIntegerStringField }
        }
      },
      gauges: {
        type: "object",
        additionalProperties: false,
        required: ["requestLogBufferSize"],
        properties: {
          requestLogBufferSize: { ...integerField }
        }
      },
      latencies: {
        type: "object",
        additionalProperties: false,
        required: ["requests", "writes"],
        properties: {
          requests: schemaRef(latencySummarySchema),
          writes: schemaRef(latencySummarySchema)
        }
      }
    }
  }
);

export const serverRequestLogRecordSchema = defineSchema(
  "ServerRequestLogRecord",
  z.object({
    id: z.string(),
    requestId: z.string(),
    method: z.string(),
    path: z.string(),
    routeId: z.string(),
    statusCode: z.number().int(),
    durationMs: z.number(),
    clientIp: z.string(),
    forwardedFor: z.string().nullable(),
    userAgent: z.string().nullable(),
    actorAddress: addressSchema.nullable(),
    errorCode: z.string().nullable(),
    createdAt: isoDateSchema
  }),
  {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "requestId",
      "method",
      "path",
      "routeId",
      "statusCode",
      "durationMs",
      "clientIp",
      "forwardedFor",
      "userAgent",
      "actorAddress",
      "errorCode",
      "createdAt"
    ],
    properties: {
      id: { ...stringField },
      requestId: { ...stringField },
      method: { ...stringField },
      path: { ...stringField },
      routeId: { ...stringField },
      statusCode: { ...integerField, minimum: 100, maximum: 599 },
      durationMs: { ...numberField },
      clientIp: { ...stringField },
      forwardedFor: { ...stringField, nullable: true },
      userAgent: { ...stringField, nullable: true },
      actorAddress: { ...addressField, nullable: true },
      errorCode: { ...stringField, nullable: true },
      createdAt: { ...isoDateField }
    }
  }
);

export const serverAuditLogRecordSchema = defineSchema(
  "ServerAuditLogRecord",
  z.object({
    id: z.string(),
    category: z.nativeEnum(ServerAuditCategory),
    action: z.string(),
    severity: z.nativeEnum(ServerAuditSeverity),
    outcome: z.nativeEnum(ServerAuditOutcome),
    requestId: z.string().nullable(),
    clientIp: z.string().nullable(),
    actorAddress: addressSchema.nullable(),
    method: z.string().nullable(),
    routeId: z.string().nullable(),
    targetType: z.string().nullable(),
    targetId: z.string().nullable(),
    cycleId: z.string().nullable(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).nullable(),
    createdAt: isoDateSchema
  }),
  {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "category",
      "action",
      "severity",
      "outcome",
      "requestId",
      "clientIp",
      "actorAddress",
      "method",
      "routeId",
      "targetType",
      "targetId",
      "cycleId",
      "message",
      "details",
      "createdAt"
    ],
    properties: {
      id: { ...stringField },
      category: { type: "string", enum: Object.values(ServerAuditCategory) },
      action: { ...stringField },
      severity: { type: "string", enum: Object.values(ServerAuditSeverity) },
      outcome: { type: "string", enum: Object.values(ServerAuditOutcome) },
      requestId: { ...stringField, nullable: true },
      clientIp: { ...stringField, nullable: true },
      actorAddress: { ...addressField, nullable: true },
      method: { ...stringField, nullable: true },
      routeId: { ...stringField, nullable: true },
      targetType: { ...stringField, nullable: true },
      targetId: { ...stringField, nullable: true },
      cycleId: { ...stringField, nullable: true },
      message: { ...stringField },
      details: {
        type: "object",
        nullable: true,
        additionalProperties: {}
      },
      createdAt: { ...isoDateField }
    }
  }
);

export const paginatedServerRequestLogResponseSchema = defineSchema(
  "PaginatedServerRequestLogResponse",
  z.object({
    items: z.array(serverRequestLogRecordSchema.schema),
    nextCursor: z.string().nullable()
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["items", "nextCursor"],
    properties: {
      items: { type: "array", items: schemaRef(serverRequestLogRecordSchema) },
      nextCursor: { type: "string", nullable: true }
    }
  }
);

export const paginatedServerAuditLogResponseSchema = defineSchema(
  "PaginatedServerAuditLogResponse",
  z.object({
    items: z.array(serverAuditLogRecordSchema.schema),
    nextCursor: z.string().nullable()
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["items", "nextCursor"],
    properties: {
      items: { type: "array", items: schemaRef(serverAuditLogRecordSchema) },
      nextCursor: { type: "string", nullable: true }
    }
  }
);

export const feedbackReportSchema = defineSchema(
  "FeedbackReport",
  z.object({
    id: z.string(),
    type: z.nativeEnum(FeedbackReportType),
    title: z.string(),
    bodyMd: z.string(),
    reporterAddress: addressSchema,
    createdAt: isoDateSchema
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["id", "type", "title", "bodyMd", "reporterAddress", "createdAt"],
    properties: {
      id: { ...stringField },
      type: { type: "string", enum: Object.values(FeedbackReportType) },
      title: { ...stringField },
      bodyMd: { ...stringField },
      reporterAddress: { ...addressField },
      createdAt: { ...isoDateField }
    }
  }
);

export const paginatedFeedbackReportResponseSchema = defineSchema(
  "PaginatedFeedbackReportResponse",
  z.object({
    items: z.array(feedbackReportSchema.schema),
    nextCursor: z.string().nullable()
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["items", "nextCursor"],
    properties: {
      items: { type: "array", items: schemaRef(feedbackReportSchema) },
      nextCursor: { type: "string", nullable: true }
    }
  }
);

export const authChallengeRequestSchema = defineSchema(
  "AuthChallengeRequest",
  z.object({
    address: addressSchema
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["address"],
    properties: {
      address: { ...addressField }
    }
  }
);

export const authChallengeResponseSchema = defineSchema(
  "AuthChallengeResponse",
  z.object({
    nonce: z.string(),
    message: z.string()
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["nonce", "message"],
    properties: {
      nonce: { ...stringField },
      message: { ...stringField }
    }
  }
);

export const authVerifyRequestSchema = defineSchema(
  "AuthVerifyRequest",
  z.object({
    address: addressSchema,
    nonce: nonEmptyStringSchema,
    message: nonEmptyStringSchema,
    signature: nonEmptyStringSchema
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["address", "nonce", "message", "signature"],
    properties: {
      address: { ...addressField },
      nonce: { ...nonEmptyStringField },
      message: { ...nonEmptyStringField },
      signature: { ...nonEmptyStringField }
    }
  }
);

export const authVerifyResponseSchema = defineSchema(
  "AuthVerifyResponse",
  z.object({
    token: z.string(),
    expiresIn: z.string()
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["token", "expiresIn"],
    properties: {
      token: { ...stringField },
      expiresIn: { ...stringField }
    }
  }
);

export const voteDisputeResultSchema = defineSchema(
  "VoteDisputeResult",
  z.object({
    vote: supervisionVoteSchema.schema,
    workload: cycleWorkloadSchema.schema
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["vote", "workload"],
    properties: {
      vote: schemaRef(supervisionVoteSchema),
      workload: schemaRef(cycleWorkloadSchema)
    }
  }
);

export const cycleDistributionSchema = defineSchema(
  "CycleDistribution",
  z.object({
    agent: addressSchema,
    amount: z.number().int()
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["agent", "amount"],
    properties: {
      agent: { ...addressField },
      amount: { ...integerField }
    }
  }
);

export const closeCycleResultSchema = defineSchema(
  "CloseCycleResult",
  z.object({
    closedCycleId: z.string(),
    openedCycleId: z.string(),
    rewardPool: z.number().int(),
    distributions: z.array(cycleDistributionSchema.schema),
    finalizedDisputes: z.array(z.string())
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["closedCycleId", "openedCycleId", "rewardPool", "distributions", "finalizedDisputes"],
    properties: {
      closedCycleId: { ...stringField },
      openedCycleId: { ...stringField },
      rewardPool: { ...integerField },
      distributions: {
        type: "array",
        items: schemaRef(cycleDistributionSchema)
      },
      finalizedDisputes: {
        type: "array",
        items: { ...stringField }
      }
    }
  }
);

export const cycleRewardsResponseSchema = defineSchema(
  "CycleRewardsResponse",
  z.object({
    cycle: cycleSchema.schema,
    rewardPool: z.number().int(),
    distributions: z.array(cycleDistributionSchema.schema),
    workloads: z.array(cycleWorkloadSchema.schema)
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["cycle", "rewardPool", "distributions", "workloads"],
    properties: {
      cycle: schemaRef(cycleSchema),
      rewardPool: { ...integerField },
      distributions: {
        type: "array",
        items: schemaRef(cycleDistributionSchema)
      },
      workloads: {
        type: "array",
        items: schemaRef(cycleWorkloadSchema)
      }
    }
  }
);

export const bridgeExportItemSchema = defineSchema(
  "BridgeExportItem",
  z.object({
    address: addressSchema,
    amount: z.number().int()
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["address", "amount"],
    properties: {
      address: { ...addressField },
      amount: { ...integerField }
    }
  }
);

export const bridgeExportResponseSchema = defineSchema(
  "BridgeExportResponse",
  z.object({
    chain: z.string(),
    mode: z.literal("OFFCHAIN_EXPORT_ONLY"),
    exports: z.array(bridgeExportItemSchema.schema)
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["chain", "mode", "exports"],
    properties: {
      chain: { ...stringField },
      mode: {
        type: "string",
        enum: ["OFFCHAIN_EXPORT_ONLY"]
      },
      exports: {
        type: "array",
        items: schemaRef(bridgeExportItemSchema)
      }
    }
  }
);

export const publicEconomyParamsSchema = defineSchema(
  "PublicEconomyParams",
  z.object({
    appName: z.string(),
    enablePersistence: z.boolean(),
    enableRedisRateLimit: z.boolean(),
    authChallengeTtlMinutes: z.number().int(),
    rateLimitPerMinute: z.number().int(),
    rateLimitBurst: z.number().int(),
    taskTitleMaxLength: z.number().int(),
    taskDescriptionMaxLength: z.number().int(),
    taskAcceptanceCriteriaMaxLength: z.number().int(),
    taskSubmissionPayloadMaxLength: z.number().int(),
    taskSubmissionAttachmentMaxCount: z.number().int(),
    taskSubmissionAttachmentNameMaxLength: z.number().int(),
    taskSubmissionAttachmentUrlMaxLength: z.number().int(),
    taskSubmissionAttachmentMaxSizeBytes: z.number().int(),
    taskTargetMentionMaxCount: z.number().int(),
    disputeReasonMaxLength: z.number().int(),
    feedbackTitleMaxLength: z.number().int(),
    feedbackBodyMaxLength: z.number().int(),
    taskSlotsMax: z.number().int(),
    taskRewardPerSlotMax: z.number().int(),
    taskDeadlineMaxHours: z.number().int(),
    taxRateBps: z.number().int(),
    taxMin: z.number().int(),
    rewardMin: z.number().int(),
    initialAgentBalance: z.number().int(),
    mintPerCycle: z.number().int(),
    cycleDurationHours: z.number().int(),
    terminationPenaltyBps: z.number().int(),
    submissionTimeoutHours: z.number().int(),
    resubmitCooldownMinutes: z.number().int(),
    disputeQuorum: z.number().int(),
    disputeApprovalBps: z.number().int(),
    reputationWeightPublisherBps: z.number().int(),
    reputationWeightWorkerBps: z.number().int(),
    reputationWeightSupervisorBps: z.number().int(),
    scoreWeightReputationBps: z.number().int(),
    scoreWeightCompletionBps: z.number().int(),
    scoreWeightQualityBps: z.number().int(),
    bridgeChain: z.string(),
    bridgeMode: z.literal("OFFCHAIN_EXPORT_ONLY")
  }),
  {
    type: "object",
    additionalProperties: false,
    required: [
      "appName",
      "enablePersistence",
      "enableRedisRateLimit",
      "authChallengeTtlMinutes",
      "rateLimitPerMinute",
      "rateLimitBurst",
      "taskTitleMaxLength",
      "taskDescriptionMaxLength",
      "taskAcceptanceCriteriaMaxLength",
      "taskSubmissionPayloadMaxLength",
      "taskSubmissionAttachmentMaxCount",
      "taskSubmissionAttachmentNameMaxLength",
      "taskSubmissionAttachmentUrlMaxLength",
      "taskSubmissionAttachmentMaxSizeBytes",
      "taskTargetMentionMaxCount",
      "disputeReasonMaxLength",
      "feedbackTitleMaxLength",
      "feedbackBodyMaxLength",
      "taskSlotsMax",
      "taskRewardPerSlotMax",
      "taskDeadlineMaxHours",
      "taxRateBps",
      "taxMin",
      "rewardMin",
      "initialAgentBalance",
      "mintPerCycle",
      "cycleDurationHours",
      "terminationPenaltyBps",
      "submissionTimeoutHours",
      "resubmitCooldownMinutes",
      "disputeQuorum",
      "disputeApprovalBps",
      "reputationWeightPublisherBps",
      "reputationWeightWorkerBps",
      "reputationWeightSupervisorBps",
      "scoreWeightReputationBps",
      "scoreWeightCompletionBps",
      "scoreWeightQualityBps",
      "bridgeChain",
      "bridgeMode"
    ],
    properties: {
      appName: { ...stringField },
      enablePersistence: { ...boolField },
      enableRedisRateLimit: { ...boolField },
      authChallengeTtlMinutes: { ...integerField },
      rateLimitPerMinute: { ...integerField },
      rateLimitBurst: { ...integerField },
      taskTitleMaxLength: { ...integerField },
      taskDescriptionMaxLength: { ...integerField },
      taskAcceptanceCriteriaMaxLength: { ...integerField },
      taskSubmissionPayloadMaxLength: { ...integerField },
      taskSubmissionAttachmentMaxCount: { ...integerField },
      taskSubmissionAttachmentNameMaxLength: { ...integerField },
      taskSubmissionAttachmentUrlMaxLength: { ...integerField },
      taskSubmissionAttachmentMaxSizeBytes: { ...integerField },
      taskTargetMentionMaxCount: { ...integerField },
      disputeReasonMaxLength: { ...integerField },
      feedbackTitleMaxLength: { ...integerField },
      feedbackBodyMaxLength: { ...integerField },
      taskSlotsMax: { ...integerField },
      taskRewardPerSlotMax: { ...integerField },
      taskDeadlineMaxHours: { ...integerField },
      taxRateBps: { ...integerField },
      taxMin: { ...integerField },
      rewardMin: { ...integerField },
      initialAgentBalance: { ...integerField },
      mintPerCycle: { ...integerField },
      cycleDurationHours: { ...integerField },
      terminationPenaltyBps: { ...integerField },
      submissionTimeoutHours: { ...integerField },
      resubmitCooldownMinutes: { ...integerField },
      disputeQuorum: { ...integerField },
      disputeApprovalBps: { ...integerField },
      reputationWeightPublisherBps: { ...integerField },
      reputationWeightWorkerBps: { ...integerField },
      reputationWeightSupervisorBps: { ...integerField },
      scoreWeightReputationBps: { ...integerField },
      scoreWeightCompletionBps: { ...integerField },
      scoreWeightQualityBps: { ...integerField },
      bridgeChain: { ...stringField },
      bridgeMode: {
        type: "string",
        enum: ["OFFCHAIN_EXPORT_ONLY"]
      }
    }
  }
);

export const runtimeEditableRulesSchema = defineSchema(
  "RuntimeEditableRules",
  z.object({
    cycleDurationHours: z.number().int(),
    mintPerCycle: z.number().int(),
    taxRateBps: z.number().int(),
    taskCompletionPublisherWorkload: z.number(),
    taskCompletionWorkerWorkload: z.number(),
    disputeQuorum: z.number().int(),
    disputeApprovalBps: z.number().int(),
    terminationPenaltyBps: z.number().int(),
    submissionTimeoutHours: z.number().int(),
    resubmitCooldownMinutes: z.number().int(),
    reputationWeightPublisherBps: z.number().int(),
    reputationWeightWorkerBps: z.number().int(),
    reputationWeightSupervisorBps: z.number().int(),
    scoreWeightReputationBps: z.number().int(),
    scoreWeightCompletionBps: z.number().int(),
    scoreWeightQualityBps: z.number().int()
  }),
  {
    type: "object",
    additionalProperties: false,
    required: [
      "cycleDurationHours",
      "mintPerCycle",
      "taxRateBps",
      "taskCompletionPublisherWorkload",
      "taskCompletionWorkerWorkload",
      "disputeQuorum",
      "disputeApprovalBps",
      "terminationPenaltyBps",
      "submissionTimeoutHours",
      "resubmitCooldownMinutes",
      "reputationWeightPublisherBps",
      "reputationWeightWorkerBps",
      "reputationWeightSupervisorBps",
      "scoreWeightReputationBps",
      "scoreWeightCompletionBps",
      "scoreWeightQualityBps"
    ],
    properties: {
      cycleDurationHours: { ...integerField },
      mintPerCycle: { ...integerField },
      taxRateBps: { ...integerField },
      taskCompletionPublisherWorkload: { ...numberField },
      taskCompletionWorkerWorkload: { ...numberField },
      disputeQuorum: { ...integerField },
      disputeApprovalBps: { ...integerField },
      terminationPenaltyBps: { ...integerField },
      submissionTimeoutHours: { ...integerField },
      resubmitCooldownMinutes: { ...integerField },
      reputationWeightPublisherBps: { ...integerField },
      reputationWeightWorkerBps: { ...integerField },
      reputationWeightSupervisorBps: { ...integerField },
      scoreWeightReputationBps: { ...integerField },
      scoreWeightCompletionBps: { ...integerField },
      scoreWeightQualityBps: { ...integerField }
    }
  }
);

export const runtimeEditableRulesPatchSchema = defineSchema(
  "RuntimeEditableRulesPatch",
  runtimeEditableRulesSchema.schema.partial(),
  {
    type: "object",
    additionalProperties: false,
    properties: {
      cycleDurationHours: { ...integerField },
      mintPerCycle: { ...integerField },
      taxRateBps: { ...integerField },
      taskCompletionPublisherWorkload: { ...numberField },
      taskCompletionWorkerWorkload: { ...numberField },
      disputeQuorum: { ...integerField },
      disputeApprovalBps: { ...integerField },
      terminationPenaltyBps: { ...integerField },
      submissionTimeoutHours: { ...integerField },
      resubmitCooldownMinutes: { ...integerField },
      reputationWeightPublisherBps: { ...integerField },
      reputationWeightWorkerBps: { ...integerField },
      reputationWeightSupervisorBps: { ...integerField },
      scoreWeightReputationBps: { ...integerField },
      scoreWeightCompletionBps: { ...integerField },
      scoreWeightQualityBps: { ...integerField }
    }
  }
);

export const runtimeSettingsStateSchema = defineSchema(
  "RuntimeSettingsState",
  z.object({
    currentRules: runtimeEditableRulesSchema.schema,
    pendingNextPatch: runtimeEditableRulesPatchSchema.schema.nullable(),
    nextRules: runtimeEditableRulesSchema.schema,
    updatedAt: isoDateSchema
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["currentRules", "pendingNextPatch", "nextRules", "updatedAt"],
    properties: {
      currentRules: schemaRef(runtimeEditableRulesSchema),
      pendingNextPatch: { ...schemaRef(runtimeEditableRulesPatchSchema), nullable: true },
      nextRules: schemaRef(runtimeEditableRulesSchema),
      updatedAt: { ...isoDateField }
    }
  }
);

export const runtimeSettingsUpdateRequestSchema = defineSchema(
  "RuntimeSettingsUpdateRequest",
  z.object({
    applyTo: z.enum(["current", "next"]),
    patch: runtimeEditableRulesPatchSchema.schema.refine(
      (value) => Object.keys(value).length > 0,
      "patch must contain at least one editable rule"
    ),
    reason: z.string().trim().min(1).max(1000).optional()
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["applyTo", "patch"],
    properties: {
      applyTo: { type: "string", enum: ["current", "next"] },
      patch: schemaRef(runtimeEditableRulesPatchSchema),
      reason: { ...stringField, minLength: 1, maxLength: 1000 }
    }
  }
);

export const runtimeSettingsResetRequestSchema = defineSchema(
  "RuntimeSettingsResetRequest",
  z.object({
    applyTo: z.enum(["current", "next"]),
    reason: z.string().trim().min(1).max(1000).optional()
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["applyTo"],
    properties: {
      applyTo: { type: "string", enum: ["current", "next"] },
      reason: { ...stringField, minLength: 1, maxLength: 1000 }
    }
  }
);

export const runtimeRuleAuditRecordSchema = defineSchema(
  "RuntimeRuleAuditRecord",
  z.object({
    id: z.string(),
    eventType: z.enum(["UPDATE", "RESET", "AUTO_APPLY_NEXT"]),
    applyTo: z.enum(["current", "next"]).nullable(),
    reason: z.string().nullable(),
    actor: z.string().nullable(),
    cycleId: z.string().nullable(),
    beforeRules: runtimeEditableRulesSchema.schema.nullable(),
    afterRules: runtimeEditableRulesSchema.schema.nullable(),
    patch: runtimeEditableRulesPatchSchema.schema.nullable(),
    pendingNextPatch: runtimeEditableRulesPatchSchema.schema.nullable(),
    createdAt: isoDateSchema
  }),
  {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "eventType",
      "applyTo",
      "reason",
      "actor",
      "cycleId",
      "beforeRules",
      "afterRules",
      "patch",
      "pendingNextPatch",
      "createdAt"
    ],
    properties: {
      id: { ...stringField },
      eventType: { type: "string", enum: ["UPDATE", "RESET", "AUTO_APPLY_NEXT"] },
      applyTo: { type: "string", enum: ["current", "next"], nullable: true },
      reason: { ...stringField, nullable: true },
      actor: { ...stringField, nullable: true },
      cycleId: { ...stringField, nullable: true },
      beforeRules: { ...schemaRef(runtimeEditableRulesSchema), nullable: true },
      afterRules: { ...schemaRef(runtimeEditableRulesSchema), nullable: true },
      patch: { ...schemaRef(runtimeEditableRulesPatchSchema), nullable: true },
      pendingNextPatch: { ...schemaRef(runtimeEditableRulesPatchSchema), nullable: true },
      createdAt: { ...isoDateField }
    }
  }
);

export const paginatedRuntimeRuleAuditResponseSchema = defineSchema(
  "PaginatedRuntimeRuleAuditResponse",
  z.object({
    items: z.array(runtimeRuleAuditRecordSchema.schema),
    nextCursor: z.string().nullable()
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["items", "nextCursor"],
    properties: {
      items: { type: "array", items: schemaRef(runtimeRuleAuditRecordSchema) },
      nextCursor: { type: "string", nullable: true }
    }
  }
);

export const createTaskRequestSchema = defineSchema(
  "CreateTaskRequest",
  z.object({
    title: nonEmptyStringSchema,
    descriptionMd: nonEmptyStringSchema,
    acceptanceCriteria: nonEmptyStringSchema,
    deadlineUtc: isoDateSchema,
    displayTimezone: nonEmptyStringSchema,
    slotsTotal: z.number().int().positive(),
    rewardPerSlot: z.number().int().positive(),
    allowRepeatCompletionsBySameAgent: z.boolean(),
    targetAgentAddresses: z.array(addressSchema).optional()
  }),
  {
    type: "object",
    additionalProperties: false,
    required: [
      "title",
      "descriptionMd",
      "acceptanceCriteria",
      "deadlineUtc",
      "displayTimezone",
      "slotsTotal",
      "rewardPerSlot",
      "allowRepeatCompletionsBySameAgent"
    ],
    properties: {
      title: { ...nonEmptyStringField },
      descriptionMd: { ...nonEmptyStringField },
      acceptanceCriteria: { ...nonEmptyStringField },
      deadlineUtc: { ...isoDateField },
      displayTimezone: { ...nonEmptyStringField },
      slotsTotal: { ...integerField, minimum: 1 },
      rewardPerSlot: { ...integerField, minimum: 1 },
      allowRepeatCompletionsBySameAgent: { ...boolField },
      targetAgentAddresses: {
        type: "array",
        items: { ...addressField }
      }
    }
  }
);

export const submitTaskRequestSchema = defineSchema(
  "SubmitTaskRequest",
  z.object({
    payloadMd: nonEmptyStringSchema,
    attachments: z.array(submissionAttachmentSchema.schema).optional()
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["payloadMd"],
    properties: {
      payloadMd: { ...nonEmptyStringField },
      attachments: {
        type: "array",
        items: schemaRef(submissionAttachmentSchema)
      }
    }
  }
);

export const rejectSubmissionRequestSchema = defineSchema(
  "RejectSubmissionRequest",
  z.object({
    reasonMd: nonEmptyStringSchema
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["reasonMd"],
    properties: {
      reasonMd: { ...nonEmptyStringField }
    }
  }
);

export const openDisputeRequestSchema = defineSchema(
  "OpenDisputeRequest",
  z.object({
    taskId: nonEmptyStringSchema,
    submissionId: nonEmptyStringSchema,
    reasonMd: nonEmptyStringSchema
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["taskId", "submissionId", "reasonMd"],
    properties: {
      taskId: { ...nonEmptyStringField },
      submissionId: { ...nonEmptyStringField },
      reasonMd: { ...nonEmptyStringField }
    }
  }
);

export const voteDisputeRequestSchema = defineSchema(
  "VoteDisputeRequest",
  z.object({
    vote: z.nativeEnum(VoteChoice)
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["vote"],
    properties: {
      vote: {
        type: "string",
        enum: Object.values(VoteChoice)
      }
    }
  }
);

export const respondDisputeRequestSchema = defineSchema(
  "RespondDisputeRequest",
  z.object({
    reasonMd: nonEmptyStringSchema
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["reasonMd"],
    properties: {
      reasonMd: { ...nonEmptyStringField }
    }
  }
);

export const createFeedbackReportRequestSchema = defineSchema(
  "CreateFeedbackReportRequest",
  z.object({
    type: z.nativeEnum(FeedbackReportType),
    title: nonEmptyStringSchema,
    bodyMd: nonEmptyStringSchema
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["type", "title", "bodyMd"],
    properties: {
      type: { type: "string", enum: Object.values(FeedbackReportType) },
      title: { ...nonEmptyStringField },
      bodyMd: { ...nonEmptyStringField }
    }
  }
);

export const updateAgentProfileRequestSchema = defineSchema(
  "UpdateAgentProfileRequest",
  z.object({
    name: z.string().max(120).optional(),
    bio: z.string().max(1000).optional()
  }),
  {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { ...stringField, maxLength: 120 },
      bio: { ...stringField, maxLength: 1000 }
    }
  }
);

export const bridgeExportRequestSchema = defineSchema(
  "BridgeExportRequest",
  z.object({
    addresses: z.array(addressSchema).optional()
  }),
  {
    type: "object",
    additionalProperties: false,
    properties: {
      addresses: { ...addressArrayOpenApi }
    }
  }
);

export const v2ApiErrorEnvelopeSchema = defineSchema(
  "V2ApiErrorEnvelope",
  z.object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional(),
      requestId: z.string(),
      retryable: z.boolean()
    })
  }),
  {
    type: "object",
    additionalProperties: false,
    required: ["error"],
    properties: {
      error: {
        type: "object",
        additionalProperties: false,
        required: ["code", "message", "requestId", "retryable"],
        properties: {
          code: { ...stringField },
          message: { ...stringField },
          details: {},
          requestId: { ...stringField },
          retryable: { ...boolField }
        }
      }
    }
  }
);

const booleanQuerySchema = z
  .union([z.boolean(), z.enum(["true", "false"]).transform((value) => value === "true")])
  .optional();
const todoActionRequiredTypeSet = new Set<string>(TODO_ACTION_REQUIRED_TYPES);
const todoWaitingTypeSet = new Set<string>(TODO_WAITING_TYPES);

export const taskListQuerySchemaV2 = z.object({
  q: nonEmptyStringSchema.optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  publisher: z.string().optional(),
  sort: z.enum(["latest", "created", "deadline", "reward"]).default("latest"),
  order: z.enum(["asc", "desc"]).default("desc"),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export const taskIntentionListQuerySchemaV2 = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export const submissionListQuerySchemaV2 = z.object({
  taskId: z.string().optional(),
  agent: z.string().optional(),
  status: z.nativeEnum(SubmissionStatus).optional(),
  q: nonEmptyStringSchema.optional(),
  sort: z.enum(["latest", "created"]).default("latest"),
  order: z.enum(["asc", "desc"]).default("desc"),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export const disputeListQuerySchemaV2 = z.object({
  taskId: z.string().optional(),
  opener: z.string().optional(),
  status: z.nativeEnum(DisputeStatus).optional(),
  q: nonEmptyStringSchema.optional(),
  sort: z.enum(["latest", "created"]).default("latest"),
  order: z.enum(["asc", "desc"]).default("desc"),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export const activityListQuerySchemaV2 = z.object({
  taskId: z.string().optional(),
  disputeId: z.string().optional(),
  address: z.string().optional(),
  type: z.nativeEnum(ActivityEventType).optional(),
  order: z.enum(["asc", "desc"]).default("desc"),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export const agentListQuerySchemaV2 = z.object({
  q: nonEmptyStringSchema.optional(),
  activeOnly: booleanQuerySchema.transform((value) => value ?? false),
  sort: z.enum(["latest", "score", "reputation", "completed", "published", "intented"]).default("latest"),
  order: z.enum(["asc", "desc"]).default("desc"),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export const dashboardSummaryQuerySchema = z.object({
  tz: nonEmptyStringSchema.default("UTC")
});

export const dashboardTrendsQuerySchema = z.object({
  tz: nonEmptyStringSchema.default("UTC"),
  window: z.enum(["7d", "30d"]).default("7d")
});

export const cycleListQuerySchemaV2 = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export const runtimeRuleAuditHistoryQuerySchemaV2 = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export const systemRequestLogsQuerySchemaV2 = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  requestId: nonEmptyStringSchema.optional(),
  actor: addressSchema.optional(),
  ip: nonEmptyStringSchema.optional(),
  method: nonEmptyStringSchema.optional(),
  routeId: nonEmptyStringSchema.optional(),
  status: z.coerce.number().int().min(100).max(599).optional()
});

export const systemAuditLogsQuerySchemaV2 = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  requestId: nonEmptyStringSchema.optional(),
  actor: addressSchema.optional(),
  ip: nonEmptyStringSchema.optional(),
  category: z.nativeEnum(ServerAuditCategory).optional(),
  action: nonEmptyStringSchema.optional(),
  outcome: z.nativeEnum(ServerAuditOutcome).optional()
});

export const feedbackReportListQuerySchemaV2 = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: z.nativeEnum(FeedbackReportType).optional(),
  reporter: addressSchema.optional()
});

export const todosQuerySchemaV2 = z
  .object({
    scope: z.enum(TODO_SCOPE_VALUES).default("all"),
    type: z.enum(TODO_GROUP_TYPE_VALUES).optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20)
  })
  .superRefine((value, ctx) => {
    if (value.cursor && !value.type) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cursor"],
        message: "cursor requires type"
      });
    }

    if (!value.type || value.scope === "all") {
      return;
    }

    const allowedTypes = value.scope === "action_required" ? todoActionRequiredTypeSet : todoWaitingTypeSet;
    if (!allowedTypes.has(value.type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["type"],
        message: `type must belong to scope ${value.scope}`
      });
    }
  });

export const idPathSchema = z.object({
  id: nonEmptyStringSchema
});

export const addressPathSchema = z.object({
  address: addressSchema
});

export const emptyObjectSchema = z.object({});

export const namedSchemas = [
  reputationTripleSchema,
  agentStatsSchema,
  agentProfileSchema,
  taskTargetMentionSchema,
  taskSchema,
  taskIntentionSchema,
  submissionAttachmentSchema,
  submissionSchema,
  disputeSchema,
  supervisionVoteSchema,
  cycleWorkloadSchema,
  cycleSchema,
  activityEventSchema,
  dashboardMetricSnapshotSchema,
  dashboardSummaryResponseSchema,
  dashboardTrendPointSchema,
  dashboardTrendsResponseSchema,
  todoItemSummarySchema,
  todoGroupSchema,
  todosResponseSchema,
  agentDirectoryItemSchema,
  paginatedTaskResponseSchema,
  paginatedTaskIntentionResponseSchema,
  paginatedSubmissionResponseSchema,
  paginatedDisputeResponseSchema,
  paginatedAgentDirectoryResponseSchema,
  paginatedActivityResponseSchema,
  paginatedCycleResponseSchema,
  ledgerBalanceSchema,
  healthStatusSchema,
  latencySummarySchema,
  serviceMetricsResponseSchema,
  serverRequestLogRecordSchema,
  serverAuditLogRecordSchema,
  paginatedServerRequestLogResponseSchema,
  paginatedServerAuditLogResponseSchema,
  feedbackReportSchema,
  paginatedFeedbackReportResponseSchema,
  authChallengeRequestSchema,
  authChallengeResponseSchema,
  authVerifyRequestSchema,
  authVerifyResponseSchema,
  voteDisputeResultSchema,
  cycleDistributionSchema,
  closeCycleResultSchema,
  cycleRewardsResponseSchema,
  bridgeExportItemSchema,
  bridgeExportResponseSchema,
  publicEconomyParamsSchema,
  runtimeEditableRulesSchema,
  runtimeEditableRulesPatchSchema,
  runtimeSettingsStateSchema,
  runtimeSettingsUpdateRequestSchema,
  runtimeSettingsResetRequestSchema,
  runtimeRuleAuditRecordSchema,
  paginatedRuntimeRuleAuditResponseSchema,
  createTaskRequestSchema,
  submitTaskRequestSchema,
  rejectSubmissionRequestSchema,
  openDisputeRequestSchema,
  voteDisputeRequestSchema,
  respondDisputeRequestSchema,
  createFeedbackReportRequestSchema,
  updateAgentProfileRequestSchema,
  bridgeExportRequestSchema,
  v2ApiErrorEnvelopeSchema
] as const;

export const openApiSchemaComponents = Object.fromEntries(
  namedSchemas.map((item) => [item.name, item.openapi])
);
