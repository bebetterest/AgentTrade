import type { FastifyInstance } from "fastify";
import { TaskStatus, type Address, type Task } from "@agentrade/types";
import { getApiOperation, type ApiOperationDefinition } from "@agentrade/contracts";
import type { AppServices } from "./services.js";
import {
  isAddress,
  paginateItems,
  parseCursorOffset,
  parseOperationBody,
  parseOperationParams,
  parseOperationQuery,
  toServerRoutePath,
  validateCreateTaskInput,
  validateOperationResponse,
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

const taskListOperation = getApiOperation("tasksListV2");
const taskGetOperation = getApiOperation("tasksGetV2");
const taskCreateOperation = getApiOperation("tasksCreateV2");
const taskAcceptOperation = getApiOperation("tasksAcceptV2");
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
          offset: parseCursorOffset(query.cursor),
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
          item.publisher.toLowerCase().includes(q)
      );
    }

    sortTasks(items, sort, order);

    return validateOperationResponse(operation, paginateItems(items, query.cursor, limit));
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

const registerTaskCreateRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.post(toServerRoutePath(operation.pathTemplate), { preHandler: [app.authenticate] }, async (request) => {
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
    validateCreateTaskInput(body, services.config);

    const publisher = request.agentAddress as Address;
    if (services.stateRepository) {
      return validateOperationResponse(
        operation,
        await services.mutateDirect(() =>
          services.stateRepository!.publishTaskDirect({
            publisher,
            ...body,
            config: services.config
          })
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
        ["profiles", "balances", "tasks", "cycles"]
      )
    );
  });
};

const registerTaskAcceptRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.post(toServerRoutePath(operation.pathTemplate), { preHandler: [app.authenticate] }, async (request) => {
    const params = parseOperationParams<{ id: string }>(operation, request);
    const agent = request.agentAddress as Address;
    if (services.stateRepository) {
      return validateOperationResponse(
        operation,
        await services.mutateDirect(() => services.stateRepository!.acceptTaskDirect(params.id, agent))
      );
    }
    return validateOperationResponse(
      operation,
      await services.mutate((engine) => engine.acceptTask(params.id, agent), ["profiles", "tasks"])
    );
  });
};

const registerTaskSubmitRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.post(toServerRoutePath(operation.pathTemplate), { preHandler: [app.authenticate] }, async (request) => {
    const params = parseOperationParams<{ id: string }>(operation, request);
    const body = parseOperationBody<{ payloadMd: string }>(operation, request);
    validateSubmissionPayloadLength(body.payloadMd, services.config);

    const agent = request.agentAddress as Address;
    if (services.stateRepository) {
      return validateOperationResponse(
        operation,
        await services.mutateDirect(() =>
          services.stateRepository!.submitTaskDirect({
            taskId: params.id,
            agent,
            payloadMd: body.payloadMd,
            taskSubmissionPayloadMaxLength: services.config.taskSubmissionPayloadMaxLength,
            resubmitCooldownMinutes: services.config.resubmitCooldownMinutes
          })
        )
      );
    }
    return validateOperationResponse(
      operation,
      await services.mutate((engine) => engine.submitTask(params.id, agent, body.payloadMd), [
        "submissions"
      ])
    );
  });
};

const registerTaskTerminateRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.post(toServerRoutePath(operation.pathTemplate), { preHandler: [app.authenticate] }, async (request) => {
    const params = parseOperationParams<{ id: string }>(operation, request);
    const publisher = request.agentAddress as Address;
    if (services.stateRepository) {
      return validateOperationResponse(
        operation,
        await services.mutateDirect(() =>
          services.stateRepository!.terminateTaskDirect(params.id, publisher, services.config)
        )
      );
    }
    return validateOperationResponse(
      operation,
      await services.mutate((engine) => engine.terminateTask(params.id, publisher), [
        "profiles",
        "balances",
        "tasks",
        "cycles"
      ])
    );
  });
};

const registerSubmissionConfirmRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.post(toServerRoutePath(operation.pathTemplate), { preHandler: [app.authenticate] }, async (request) => {
    const params = parseOperationParams<{ id: string }>(operation, request);
    const publisher = request.agentAddress as Address;
    if (services.stateRepository) {
      return validateOperationResponse(
        operation,
        await services.mutateDirect(() =>
          services.stateRepository!.confirmSubmissionDirect(params.id, publisher)
        )
      );
    }
    return validateOperationResponse(
      operation,
      await services.mutate((engine) => engine.confirmSubmission(params.id, publisher), [
        "profiles",
        "balances",
        "tasks",
        "submissions"
      ])
    );
  });
};

const registerSubmissionRejectRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.post(toServerRoutePath(operation.pathTemplate), { preHandler: [app.authenticate] }, async (request) => {
    const params = parseOperationParams<{ id: string }>(operation, request);
    const publisher = request.agentAddress as Address;
    if (services.stateRepository) {
      return validateOperationResponse(
        operation,
        await services.mutateDirect(() =>
          services.stateRepository!.rejectSubmissionDirect(params.id, publisher)
        )
      );
    }
    return validateOperationResponse(
      operation,
      await services.mutate((engine) => engine.rejectSubmission(params.id, publisher), [
        "profiles",
        "submissions"
      ])
    );
  });
};

export const registerTaskRoutes = (app: FastifyInstance, services: AppServices): void => {
  registerTaskListRoute(app, services, taskListOperation);
  registerTaskGetRoute(app, services, taskGetOperation);
  registerTaskCreateRoute(app, services, taskCreateOperation);
  registerTaskAcceptRoute(app, services, taskAcceptOperation);
  registerTaskSubmitRoute(app, services, taskSubmitOperation);
  registerTaskTerminateRoute(app, services, taskTerminateOperation);
  registerSubmissionConfirmRoute(app, services, submissionConfirmOperation);
  registerSubmissionRejectRoute(app, services, submissionRejectOperation);
};
