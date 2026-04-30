import type { FastifyInstance } from "fastify";
import { TaskStatus, type Address, type SubmissionAttachment, type Task } from "@agentrade/types";
import { getApiOperation, type ApiOperationDefinition } from "@agentrade/contracts";
import type { AppServices } from "./services.js";
import {
  isAddress,
  paginateItemsByCursor,
  parseOperationBody,
  parseOperationParams,
  parseOperationQuery,
  toServerRoutePath,
  toWriteAuditContext,
  validateCreateTaskInput,
  validateDisputeReasonLength,
  validateOperationResponse,
  validateSubmissionAttachments,
  validateSubmissionPayloadLength
} from "./services.js";
import { DomainError } from "../domain/errors.js";

type TaskListQuery = {
  q?: string;
  status?: TaskStatus;
  publisher?: string;
  sort?: "latest" | "created" | "deadline" | "reward";
  order?: "asc" | "desc";
  cursor?: string;
  limit?: number;
};

type TaskIntentionListQuery = {
  cursor?: string;
  limit?: number;
};

const taskListOperation = getApiOperation("tasksListV2");
const taskGetOperation = getApiOperation("tasksGetV2");
const taskIntentionsListOperation = getApiOperation("tasksListIntentionsV2");
const taskCreateOperation = getApiOperation("tasksCreateV2");
const taskIntendOperation = getApiOperation("tasksAddIntentionV2");
const taskSubmitOperation = getApiOperation("tasksSubmitV2");
const taskTerminateOperation = getApiOperation("tasksTerminateV2");
const submissionConfirmOperation = getApiOperation("submissionsConfirmV2");
const submissionRejectOperation = getApiOperation("submissionsRejectV2");

const sortTasks = (
  items: Task[],
  sortKey: "latest" | "created" | "deadline" | "reward",
  order: "asc" | "desc"
) => {
  items.sort((left, right) => {
    let delta = 0;
    if (sortKey === "created") {
      delta = left.createdAt.localeCompare(right.createdAt);
    } else if (sortKey === "deadline") {
      delta = left.deadlineUtc.localeCompare(right.deadlineUtc);
    } else if (sortKey === "reward") {
      delta = left.rewardPerSlot - right.rewardPerSlot;
    } else {
      delta = left.updatedAt.localeCompare(right.updatedAt);
    }
    if (delta === 0) {
      delta = left.id.localeCompare(right.id);
    }
    return order === "asc" ? delta : -delta;
  });
};

const taskCursorPrimary = (item: Task, sortKey: "latest" | "created" | "deadline" | "reward"): string | number =>
  sortKey === "created"
    ? item.createdAt
    : sortKey === "deadline"
      ? item.deadlineUtc
      : sortKey === "reward"
        ? item.rewardPerSlot
        : item.updatedAt;

const compareTaskAfterCursor = (
  item: Task,
  sortKey: "latest" | "created" | "deadline" | "reward",
  order: "asc" | "desc",
  cursorValues: Record<string, unknown>
): number => {
  const cursorId = cursorValues.id;
  if (typeof cursorId !== "string" || cursorId.length === 0) {
    throw new DomainError("INVALID_CURSOR", "cursor id must be a non-empty string", 400);
  }
  const cursorPrimary = cursorValues.primary;
  let delta = 0;
  if (sortKey === "reward") {
    const asNumber =
      typeof cursorPrimary === "number"
        ? cursorPrimary
        : typeof cursorPrimary === "string"
          ? Number(cursorPrimary)
          : Number.NaN;
    if (!Number.isFinite(asNumber)) {
      throw new DomainError("INVALID_CURSOR", "cursor primary must be a finite number", 400);
    }
    delta = item.rewardPerSlot - asNumber;
  } else {
    if (typeof cursorPrimary !== "string" || cursorPrimary.length === 0) {
      throw new DomainError("INVALID_CURSOR", "cursor primary must be a non-empty ISO datetime string", 400);
    }
    delta = taskCursorPrimary(item, sortKey).toString().localeCompare(cursorPrimary);
  }
  if (delta === 0) {
    delta = item.id.localeCompare(cursorId);
  }
  return order === "asc" ? delta : -delta;
};

const registerTaskListRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.get(toServerRoutePath(operation.pathTemplate), async (request) => {
    const query = parseOperationQuery<TaskListQuery>(operation, request);
    if (query.publisher && !isAddress(query.publisher)) {
      throw new DomainError("INVALID_ADDRESS", "invalid publisher address", 400);
    }

    const sort = query.sort ?? "latest";
    const order = query.order ?? "desc";
    const limit = query.limit ?? 20;

    if (services.stateRepository) {
      return validateOperationResponse(
        operation,
        await services.stateRepository.queryTasksDirect({
          q: query.q,
          status: query.status,
          publisher: query.publisher as Address | undefined,
          sort,
          order,
          cursor: query.cursor,
          limit,
          paged: true
        })
      );
    }

    let items = await services.readTasks();
    if (query.status) {
      items = items.filter((item) => item.status === query.status);
    }
    if (query.publisher) {
      const publisherLower = query.publisher.toLowerCase();
      items = items.filter((item) => item.publisher.toLowerCase() === publisherLower);
    }
    if (query.q) {
      const q = query.q.toLowerCase();
      items = items.filter(
        (item) =>
          item.id.toLowerCase().includes(q) ||
          item.title.toLowerCase().includes(q) ||
          item.descriptionMd.toLowerCase().includes(q) ||
          item.acceptanceCriteria.toLowerCase().includes(q) ||
          item.publisher.toLowerCase().includes(q)
      );
    }

    sortTasks(items, sort, order);
    return validateOperationResponse(
      operation,
      paginateItemsByCursor(items, {
        cursor: query.cursor,
        limit,
        resource: "tasks",
        sort,
        order,
        toCursorValues: (item) => ({
          primary: taskCursorPrimary(item, sort),
          id: item.id
        }),
        compareAfterCursor: (item, cursorValues) =>
          compareTaskAfterCursor(
            item,
            sort,
            order,
            cursorValues as Record<string, unknown>
          )
      })
    );
  });
};

const registerTaskGetRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.get(toServerRoutePath(operation.pathTemplate), async (request) => {
    const params = parseOperationParams<{ id: string }>(operation, request);
    if (services.stateRepository) {
      const task = await services.stateRepository.getTaskDirect(params.id);
      if (!task) {
        throw new DomainError("TASK_NOT_FOUND", `Task ${params.id} does not exist`, 404);
      }
      return validateOperationResponse(operation, task);
    }
    return validateOperationResponse(operation, await services.read((engine) => engine.getTask(params.id)));
  });
};

const registerTaskIntentionsListRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.get(toServerRoutePath(operation.pathTemplate), async (request) => {
    const params = parseOperationParams<{ id: string }>(operation, request);
    const query = parseOperationQuery<TaskIntentionListQuery>(operation, request);
    const limit = query.limit ?? 20;

    if (services.stateRepository) {
      return validateOperationResponse(
        operation,
        await services.stateRepository.queryTaskIntentionsDirect({
          taskId: params.id,
          cursor: query.cursor,
          limit
        })
      );
    }

    const items = await services.read((engine) => engine.listTaskIntentions(params.id));
    return validateOperationResponse(
      operation,
      paginateItemsByCursor(items, {
        cursor: query.cursor,
        limit,
        resource: "task-intentions",
        toCursorValues: (item) => ({
          primary: item.createdAt,
          id: item.id
        }),
        compareAfterCursor: (item, cursorValues) => {
          const cursorId = cursorValues.id;
          const cursorPrimary = cursorValues.primary;
          if (typeof cursorId !== "string" || cursorId.length === 0) {
            throw new DomainError("INVALID_CURSOR", "cursor id must be a non-empty string", 400);
          }
          if (typeof cursorPrimary !== "string" || cursorPrimary.length === 0) {
            throw new DomainError(
              "INVALID_CURSOR",
              "cursor primary must be a non-empty ISO datetime string",
              400
            );
          }
          const delta = item.createdAt.localeCompare(cursorPrimary);
          return delta === 0 ? item.id.localeCompare(cursorId) : delta;
        }
      })
    );
  });
};

const registerTaskCreateRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.post(
    toServerRoutePath(operation.pathTemplate),
    { preHandler: [app.authenticate, app.requireActiveAgent] },
    async (request) => {
    const body = parseOperationBody<{
      title: string;
      descriptionMd: string;
      acceptanceCriteria: string;
      deadlineUtc: string;
      displayTimezone: string;
      slotsTotal: number;
      rewardPerSlot: number;
      allowRepeatCompletionsBySameAgent: boolean;
    }>(operation, request);
    await services.refreshRuntimeSettings();
    validateCreateTaskInput(body, services.config);

    const publisher = request.agentAddress as Address;
    const writeMeta = services.writeMeta({
      request,
      operation: "tasks.create",
      actor: publisher,
      targetType: "task"
    });
    if (services.stateRepository) {
      return validateOperationResponse(
        operation,
        await services.mutateDirect(() =>
          services.stateRepository!.publishTaskDirect({
            publisher,
            ...body,
            auditContext: toWriteAuditContext(writeMeta)
          }),
          writeMeta
        )
      );
    }
    return validateOperationResponse(
      operation,
      await services.mutate(
        (engine) =>
          engine.publishTask({
            publisher,
            ...body
          }),
        ["profiles", "balances", "tasks", "cycles"],
        writeMeta
      )
    );
    }
  );
};

const registerTaskIntendRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.post(
    toServerRoutePath(operation.pathTemplate),
    { preHandler: [app.authenticate, app.requireActiveAgent] },
    async (request) => {
    const params = parseOperationParams<{ id: string }>(operation, request);
    const agent = request.agentAddress as Address;
    const writeMeta = services.writeMeta({
      request,
      operation: "tasks.intend",
      actor: agent,
      targetType: "task",
      targetId: params.id,
      details: {
        taskId: params.id
      }
    });
    if (services.stateRepository) {
      return validateOperationResponse(
        operation,
        await services.mutateDirect(
          () =>
            services.stateRepository!.addTaskIntentionDirect(
              params.id,
              agent,
              toWriteAuditContext(writeMeta)
            ),
          writeMeta
        )
      );
    }
    return validateOperationResponse(
      operation,
      await services.mutate(
        (engine) => engine.addTaskIntention(params.id, agent),
        ["profiles", "tasks"],
        writeMeta
      )
    );
    }
  );
};

const registerTaskSubmitRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.post(
    toServerRoutePath(operation.pathTemplate),
    { preHandler: [app.authenticate, app.requireActiveAgent] },
    async (request) => {
    const params = parseOperationParams<{ id: string }>(operation, request);
    const body = parseOperationBody<{ payloadMd: string; attachments?: SubmissionAttachment[] }>(operation, request);
    await services.refreshRuntimeSettings();
    validateSubmissionPayloadLength(body.payloadMd, services.config);
    validateSubmissionAttachments(body.attachments, services.config);

    const agent = request.agentAddress as Address;
    const writeMeta = services.writeMeta({
      request,
      operation: "tasks.submit",
      actor: agent,
      targetType: "task",
      targetId: params.id,
      details: {
        taskId: params.id,
        attachmentCount: body.attachments?.length ?? 0
      }
    });
    if (services.stateRepository) {
      return validateOperationResponse(
        operation,
        await services.mutateDirect(() =>
          services.stateRepository!.submitTaskDirect({
            taskId: params.id,
            agent,
            payloadMd: body.payloadMd,
            attachments: body.attachments,
            auditContext: toWriteAuditContext(writeMeta)
          }),
          writeMeta
        )
      );
    }
    return validateOperationResponse(
      operation,
      await services.mutate((engine) => engine.submitTask(params.id, agent, body.payloadMd, body.attachments ?? []), [
        "submissions",
        "tasks"
      ], writeMeta)
    );
    }
  );
};

const registerTaskTerminateRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.post(
    toServerRoutePath(operation.pathTemplate),
    { preHandler: [app.authenticate, app.requireActiveAgent] },
    async (request) => {
    const params = parseOperationParams<{ id: string }>(operation, request);
    const publisher = request.agentAddress as Address;
    const writeMeta = services.writeMeta({
      request,
      operation: "tasks.terminate",
      actor: publisher,
      targetType: "task",
      targetId: params.id,
      details: {
        taskId: params.id
      }
    });
    if (services.stateRepository) {
      return validateOperationResponse(
        operation,
        await services.mutateDirect(() =>
          services.stateRepository!.terminateTaskDirect(
            params.id,
            publisher,
            toWriteAuditContext(writeMeta)
          )
        , writeMeta)
      );
    }
    return validateOperationResponse(
      operation,
      await services.mutate((engine) => engine.terminateTask(params.id, publisher), [
        "profiles",
        "balances",
        "tasks",
        "cycles"
      ], writeMeta)
    );
    }
  );
};

const registerSubmissionConfirmRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.post(
    toServerRoutePath(operation.pathTemplate),
    { preHandler: [app.authenticate, app.requireActiveAgent] },
    async (request) => {
    const params = parseOperationParams<{ id: string }>(operation, request);
    const publisher = request.agentAddress as Address;
    const writeMeta = services.writeMeta({
      request,
      operation: "submissions.confirm",
      actor: publisher,
      targetType: "submission",
      targetId: params.id,
      details: {
        submissionId: params.id
      }
    });
    if (services.stateRepository) {
      return validateOperationResponse(
        operation,
        await services.mutateDirect(() =>
          services.stateRepository!.confirmSubmissionDirect(
            params.id,
            publisher,
            toWriteAuditContext(writeMeta)
          )
        , writeMeta)
      );
    }
    return validateOperationResponse(
      operation,
      await services.mutate((engine) => engine.confirmSubmission(params.id, publisher), [
        "profiles",
        "balances",
        "tasks",
        "submissions"
      ], writeMeta)
    );
    }
  );
};

const registerSubmissionRejectRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.post(
    toServerRoutePath(operation.pathTemplate),
    { preHandler: [app.authenticate, app.requireActiveAgent] },
    async (request) => {
    const params = parseOperationParams<{ id: string }>(operation, request);
    const body = parseOperationBody<{ reasonMd: string }>(operation, request);
    await services.refreshRuntimeSettings();
    validateDisputeReasonLength(body.reasonMd, services.config);
    const publisher = request.agentAddress as Address;
    const writeMeta = services.writeMeta({
      request,
      operation: "submissions.reject",
      actor: publisher,
      targetType: "submission",
      targetId: params.id,
      details: {
        submissionId: params.id
      }
    });
    if (services.stateRepository) {
      return validateOperationResponse(
        operation,
        await services.mutateDirect(() =>
          services.stateRepository!.rejectSubmissionDirect({
            submissionId: params.id,
            publisher,
            reasonMd: body.reasonMd,
            auditContext: toWriteAuditContext(writeMeta)
          })
        , writeMeta)
      );
    }
    return validateOperationResponse(
      operation,
      await services.mutate((engine) => engine.rejectSubmission(params.id, publisher, body.reasonMd), [
        "profiles",
        "submissions"
      ], writeMeta)
    );
    }
  );
};

export const registerTaskRoutes = (app: FastifyInstance, services: AppServices): void => {
  registerTaskListRoute(app, services, taskListOperation);
  registerTaskGetRoute(app, services, taskGetOperation);
  registerTaskIntentionsListRoute(app, services, taskIntentionsListOperation);
  registerTaskCreateRoute(app, services, taskCreateOperation);
  registerTaskIntendRoute(app, services, taskIntendOperation);
  registerTaskSubmitRoute(app, services, taskSubmitOperation);
  registerTaskTerminateRoute(app, services, taskTerminateOperation);
  registerSubmissionConfirmRoute(app, services, submissionConfirmOperation);
  registerSubmissionRejectRoute(app, services, submissionRejectOperation);
};
