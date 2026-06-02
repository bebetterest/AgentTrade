import type { FastifyInstance } from "fastify";
import { type Address, type TodoGroupType, type TodoScope } from "@agentrade/types";
import { getApiOperation, type ApiOperationDefinition } from "@agentrade/contracts";
import type { AppServices } from "./services.js";
import {
  parseOperationParams,
  parseOperationQuery,
  toServerRoutePath,
  validateOperationResponse
} from "./services.js";
import {
  buildTodosResponse,
  type TodoDisputeRecord,
  type TodoIntentionRecord,
  type TodoSubmissionRecord,
  type TodoTargetMentionRecord,
  type TodoTaskRecord
} from "../todos/read-model.js";

type TodosQuery = {
  scope?: TodoScope;
  type?: TodoGroupType;
  cursor?: string;
  limit?: number;
};

const todosGetOperation = getApiOperation("todosGetV2");

const registerTodosGetRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.get(toServerRoutePath(operation.pathTemplate), async (request) => {
    const params = parseOperationParams<{ address: Address }>(operation, request);
    const query = parseOperationQuery<TodosQuery>(operation, request);
    const input = {
      address: params.address,
      scope: query.scope ?? "all",
      type: query.type,
      cursor: query.cursor,
      limit: query.limit ?? 20
    };

    if (services.stateRepository) {
      return validateOperationResponse(operation, await services.stateRepository.getTodosDirect(input));
    }

    const payload = await services.read((engine) => {
      const snapshot = engine.toSnapshot();
      const addressLower = params.address.toLowerCase();
      const taskMap = new Map(snapshot.tasks.map((task) => [task.id, task]));
      const submissionMap = new Map(snapshot.submissions.map((submission) => [submission.id, submission]));
      const intentionTaskIds = new Set(
        (snapshot.intentions ?? [])
          .filter((item) => item.agent.toLowerCase() === addressLower)
          .map((item) => item.taskId)
      );

      const tasks: TodoTaskRecord[] = snapshot.tasks
        .filter(
          (task) => task.publisher.toLowerCase() === addressLower || intentionTaskIds.has(task.id)
        )
        .map((task) => ({
          id: task.id,
          publisher: task.publisher,
          title: task.title,
          status: task.status,
          deadlineUtc: task.deadlineUtc,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt
        }));

      const intentions: TodoIntentionRecord[] = (snapshot.intentions ?? [])
        .filter((item) => item.agent.toLowerCase() === addressLower)
        .map((item) => ({
          id: item.id,
          taskId: item.taskId,
          agent: item.agent,
          createdAt: item.createdAt
        }));

      const targetMentions: TodoTargetMentionRecord[] = (snapshot.targetMentions ?? [])
        .reduce<TodoTargetMentionRecord[]>((acc, mention) => {
          const task = taskMap.get(mention.taskId);
          if (!task || mention.targetAgent.toLowerCase() !== addressLower) {
            return acc;
          }
          acc.push({
            id: mention.id,
            taskId: mention.taskId,
            publisher: mention.publisher,
            targetAgent: mention.targetAgent,
            taskTitle: task.title,
            taskStatus: task.status,
            taskDeadlineUtc: task.deadlineUtc ?? null,
            status: mention.status,
            createdAt: mention.createdAt,
            updatedAt: mention.updatedAt
          });
          return acc;
        }, []);

      const submissions = snapshot.submissions.reduce<TodoSubmissionRecord[]>((acc, submission) => {
        const task = taskMap.get(submission.taskId);
        if (!task) {
          return acc;
        }
        if (
          submission.agent.toLowerCase() !== addressLower &&
          task.publisher.toLowerCase() !== addressLower
        ) {
          return acc;
        }
        acc.push({
          id: submission.id,
          taskId: submission.taskId,
          agent: submission.agent,
          taskPublisher: task.publisher,
          taskTitle: task.title,
          taskStatus: task.status,
          taskDeadlineUtc: task.deadlineUtc ?? null,
          status: submission.status,
          createdAt: submission.createdAt,
          updatedAt: submission.updatedAt
        });
        return acc;
      }, []);

      const disputes = snapshot.disputes.reduce<TodoDisputeRecord[]>((acc, dispute) => {
        if (dispute.status !== "OPEN") {
          return acc;
        }
        const task = taskMap.get(dispute.taskId);
        const submission = submissionMap.get(dispute.submissionId);
        if (!task || !submission) {
          return acc;
        }
        if (
          dispute.opener.toLowerCase() !== addressLower &&
          task.publisher.toLowerCase() !== addressLower &&
          submission.agent.toLowerCase() !== addressLower
        ) {
          return acc;
        }
        acc.push({
          id: dispute.id,
          taskId: dispute.taskId,
          submissionId: dispute.submissionId,
          opener: dispute.opener,
          taskPublisher: task.publisher,
          submissionAgent: submission.agent,
          taskTitle: task.title,
          taskDeadlineUtc: task.deadlineUtc ?? null,
          counterpartyReasonMd: dispute.counterpartyReasonMd ?? null,
          status: dispute.status,
          createdAt: dispute.createdAt,
          updatedAt: dispute.updatedAt
        });
        return acc;
      }, []);

      return buildTodosResponse({
        ...input,
        generatedAt: new Date().toISOString(),
        tasks,
        submissions,
        disputes,
        intentions,
        targetMentions
      });
    });

    return validateOperationResponse(operation, payload);
  });
};

export const registerTodoRoutes = (app: FastifyInstance, services: AppServices): void => {
  registerTodosGetRoute(app, services, todosGetOperation);
};
