import type { FastifyInstance } from "fastify";
import { getApiOperation, type ApiOperationDefinition } from "@agentrade/contracts";
import { type Address, type Submission } from "@agentrade/types";
import type { AppServices } from "./services.js";
import {
  isAddress,
  paginateItemsByCursor,
  parseOperationParams,
  parseOperationQuery,
  toServerRoutePath,
  validateOperationResponse
} from "./services.js";
import { DomainError } from "../domain/errors.js";

type SubmissionListQuery = {
  taskId?: string;
  agent?: string;
  status?: Submission["status"];
  q?: string;
  sort?: "latest" | "created";
  order?: "asc" | "desc";
  cursor?: string;
  limit?: number;
};

const submissionListOperation = getApiOperation("submissionsListV2");
const submissionGetOperation = getApiOperation("submissionsGetV2");

const sortSubmissions = (
  items: Submission[],
  sortKey: "latest" | "created",
  order: "asc" | "desc"
) => {
  items.sort((left, right) => {
    const delta =
      sortKey === "created"
        ? left.createdAt.localeCompare(right.createdAt)
        : left.updatedAt.localeCompare(right.updatedAt);
    if (delta !== 0) {
      return order === "asc" ? delta : -delta;
    }
    const fallback = left.id.localeCompare(right.id);
    return order === "asc" ? fallback : -fallback;
  });
};

const submissionCursorPrimary = (
  item: Submission,
  sortKey: "latest" | "created"
): string => (sortKey === "created" ? item.createdAt : item.updatedAt);

const compareSubmissionAfterCursor = (
  item: Submission,
  sortKey: "latest" | "created",
  order: "asc" | "desc",
  cursorValues: Record<string, unknown>
): number => {
  const cursorId = cursorValues.id;
  if (typeof cursorId !== "string" || cursorId.length === 0) {
    throw new DomainError("INVALID_CURSOR", "cursor id must be a non-empty string", 400);
  }
  const cursorPrimary = cursorValues.primary;
  if (typeof cursorPrimary !== "string" || cursorPrimary.length === 0) {
    throw new DomainError("INVALID_CURSOR", "cursor primary must be a non-empty ISO datetime string", 400);
  }

  let delta = submissionCursorPrimary(item, sortKey).localeCompare(cursorPrimary);
  if (delta === 0) {
    delta = item.id.localeCompare(cursorId);
  }
  return order === "asc" ? delta : -delta;
};

const registerSubmissionListRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.get(toServerRoutePath(operation.pathTemplate), async (request) => {
    const query = parseOperationQuery<SubmissionListQuery>(operation, request);
    if (query.agent && !isAddress(query.agent)) {
      throw new DomainError("INVALID_ADDRESS", "invalid submission agent address", 400);
    }

    const sort = query.sort ?? "latest";
    const order = query.order ?? "desc";
    const limit = query.limit ?? 20;

    if (services.stateRepository) {
      return validateOperationResponse(
        operation,
        await services.stateRepository.querySubmissionsDirect({
          taskId: query.taskId,
          agent: query.agent as Address | undefined,
          status: query.status,
          q: query.q,
          sort,
          order,
          cursor: query.cursor,
          limit,
          paged: true
        })
      );
    }

    let items = await services.readSubmissions();
    if (query.taskId) {
      items = items.filter((item) => item.taskId === query.taskId);
    }
    if (query.agent) {
      const lowerAddress = query.agent.toLowerCase();
      items = items.filter((item) => item.agent.toLowerCase() === lowerAddress);
    }
    if (query.status) {
      items = items.filter((item) => item.status === query.status);
    }
    if (query.q) {
      const q = query.q.toLowerCase();
      items = items.filter((item) =>
        item.id.toLowerCase().includes(q) ||
        item.taskId.toLowerCase().includes(q) ||
        item.agent.toLowerCase().includes(q) ||
        item.payloadMd.toLowerCase().includes(q)
      );
    }

    sortSubmissions(items, sort, order);
    return validateOperationResponse(
      operation,
      paginateItemsByCursor(items, {
        cursor: query.cursor,
        limit,
        resource: "submissions",
        sort,
        order,
        toCursorValues: (item) => ({
          primary: submissionCursorPrimary(item, sort),
          id: item.id
        }),
        compareAfterCursor: (item, cursorValues) =>
          compareSubmissionAfterCursor(
            item,
            sort,
            order,
            cursorValues as Record<string, unknown>
          )
      })
    );
  });
};

const registerSubmissionGetRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.get(toServerRoutePath(operation.pathTemplate), async (request) => {
    const params = parseOperationParams<{ id: string }>(operation, request);
    if (services.stateRepository) {
      const submission = await services.stateRepository.getSubmissionDirect(params.id);
      if (!submission) {
        throw new DomainError("SUBMISSION_NOT_FOUND", `Submission ${params.id} not found`, 404);
      }
      return validateOperationResponse(operation, submission);
    }
    return validateOperationResponse(
      operation,
      await services.read((engine) => engine.getSubmission(params.id))
    );
  });
};

export const registerSubmissionRoutes = (app: FastifyInstance, services: AppServices): void => {
  registerSubmissionListRoute(app, services, submissionListOperation);
  registerSubmissionGetRoute(app, services, submissionGetOperation);
};
