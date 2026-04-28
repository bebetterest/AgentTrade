import type { FastifyInstance } from "fastify";
import {
  type ActivityEvent,
  ActivityEventType,
  DisputeStatus,
  VoteChoice,
  type Address,
  type DashboardTrendPoint,
  type Dispute
} from "@agentrade/types";
import { getApiOperation, type ApiOperationDefinition } from "@agentrade/contracts";
import type { AppServices } from "./services.js";
import {
  countMetrics,
  isAddress,
  isValidTimezone,
  paginateItemsByCursor,
  parseOperationBody,
  parseOperationParams,
  parseOperationQuery,
  toDayKey,
  toServerRoutePath,
  toWriteAuditContext,
  validateDisputeReasonLength,
  validateOperationResponse
} from "./services.js";
import { DomainError } from "../domain/errors.js";
import { HttpError } from "../utils/http-error.js";

type DisputeListQuery = {
  taskId?: string;
  opener?: string;
  status?: Dispute["status"];
  q?: string;
  sort?: "latest" | "created";
  order?: "asc" | "desc";
  cursor?: string;
  limit?: number;
};

type ActivityListQuery = {
  taskId?: string;
  disputeId?: string;
  address?: string;
  type?: ActivityEventType;
  order?: "asc" | "desc";
  cursor?: string;
  limit?: number;
};

const disputeListOperation = getApiOperation("disputesListV2");
const disputeGetOperation = getApiOperation("disputesGetV2");
const disputeOpenOperation = getApiOperation("disputesOpenV2");
const disputeRespondOperation = getApiOperation("disputesRespondV2");
const disputeVoteOperation = getApiOperation("disputesVoteV2");
const activityListOperation = getApiOperation("activitiesListV2");
const dashboardSummaryOperation = getApiOperation("dashboardSummaryV2");
const dashboardTrendOperation = getApiOperation("dashboardTrendsV2");

const sortDisputes = (items: Dispute[], sortKey: "latest" | "created", order: "asc" | "desc") => {
  items.sort((left, right) => {
    let delta =
      sortKey === "created"
        ? left.createdAt.localeCompare(right.createdAt)
        : left.updatedAt.localeCompare(right.updatedAt);
    if (delta === 0) {
      delta = left.id.localeCompare(right.id);
    }
    return order === "asc" ? delta : -delta;
  });
};

const disputeCursorPrimary = (item: Dispute, sortKey: "latest" | "created"): string =>
  sortKey === "created" ? item.createdAt : item.updatedAt;

const compareDisputeAfterCursor = (
  item: Dispute,
  sortKey: "latest" | "created",
  order: "asc" | "desc",
  cursorValues: Record<string, unknown>
): number => {
  const cursorId = cursorValues.id;
  const cursorPrimary = cursorValues.primary;
  if (typeof cursorId !== "string" || cursorId.length === 0) {
    throw new DomainError("INVALID_CURSOR", "cursor id must be a non-empty string", 400);
  }
  if (typeof cursorPrimary !== "string" || cursorPrimary.length === 0) {
    throw new DomainError("INVALID_CURSOR", "cursor primary must be a non-empty ISO datetime string", 400);
  }
  let delta = disputeCursorPrimary(item, sortKey).localeCompare(cursorPrimary);
  if (delta === 0) {
    delta = item.id.localeCompare(cursorId);
  }
  return order === "asc" ? delta : -delta;
};

const compareActivityAfterCursor = (
  item: ActivityEvent,
  order: "asc" | "desc",
  cursorValues: Record<string, unknown>
): number => {
  const cursorId = cursorValues.id;
  const cursorPrimary = cursorValues.primary;
  if (typeof cursorId !== "string" || cursorId.length === 0) {
    throw new DomainError("INVALID_CURSOR", "cursor id must be a non-empty string", 400);
  }
  if (typeof cursorPrimary !== "string" || cursorPrimary.length === 0) {
    throw new DomainError("INVALID_CURSOR", "cursor primary must be a non-empty ISO datetime string", 400);
  }
  let delta = item.createdAt.localeCompare(cursorPrimary);
  if (delta === 0) {
    delta = item.id.localeCompare(cursorId);
  }
  return order === "asc" ? delta : -delta;
};

const registerDisputeListRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.get(toServerRoutePath(operation.pathTemplate), async (request) => {
    const query = parseOperationQuery<DisputeListQuery>(operation, request);
    if (query.opener && !isAddress(query.opener)) {
      throw new HttpError(400, "invalid opener address");
    }

    const sort = query.sort ?? "latest";
    const order = query.order ?? "desc";
    const limit = query.limit ?? 20;

    if (services.stateRepository) {
      return validateOperationResponse(
        operation,
        await services.stateRepository.queryDisputesDirect({
          taskId: query.taskId,
          opener: query.opener as Address | undefined,
          status: query.status as DisputeStatus | undefined,
          q: query.q,
          sort,
          order,
          cursor: query.cursor,
          limit,
          paged: true
        })
      );
    }

    let items = await services.readDisputes();
    if (query.taskId) {
      items = items.filter((item) => item.taskId === query.taskId);
    }
    if (query.opener) {
      const openerLower = query.opener.toLowerCase();
      items = items.filter((item) => item.opener.toLowerCase() === openerLower);
    }
    if (query.status) {
      items = items.filter((item) => item.status === query.status);
    }
    if (query.q) {
      const q = query.q.toLowerCase();
      items = items.filter(
        (item) =>
          item.id.toLowerCase().includes(q) ||
          item.taskId.toLowerCase().includes(q) ||
          item.submissionId.toLowerCase().includes(q) ||
          item.opener.toLowerCase().includes(q) ||
          item.reasonMd.toLowerCase().includes(q) ||
          item.counterpartyReasonMd?.toLowerCase().includes(q)
      );
    }

    sortDisputes(items, sort, order);
    return validateOperationResponse(
      operation,
      paginateItemsByCursor(items, {
        cursor: query.cursor,
        limit,
        resource: "disputes",
        sort,
        order,
        toCursorValues: (item) => ({
          primary: disputeCursorPrimary(item, sort),
          id: item.id
        }),
        compareAfterCursor: (item, cursorValues) =>
          compareDisputeAfterCursor(
            item,
            sort,
            order,
            cursorValues as Record<string, unknown>
          )
      })
    );
  });
};

const registerDisputeGetRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.get(toServerRoutePath(operation.pathTemplate), async (request) => {
    const params = parseOperationParams<{ id: string }>(operation, request);
    if (services.stateRepository) {
      const dispute = await services.stateRepository.getDisputeDirect(params.id);
      if (!dispute) {
        throw new DomainError("DISPUTE_NOT_FOUND", `Dispute ${params.id} does not exist`, 404);
      }
      if (dispute.status === DisputeStatus.OPEN) {
        return validateOperationResponse(operation, dispute);
      }
      const resolution = await services.stateRepository.getDisputeResolutionDirect(params.id);
      return validateOperationResponse(
        operation,
        resolution ? { ...dispute, resolution } : dispute
      );
    }
    return validateOperationResponse(
      operation,
      await services.read((engine) => {
        const dispute = engine.getDispute(params.id);
        if (dispute.status === DisputeStatus.OPEN) {
          return dispute;
        }
        const resolution = engine.getDisputeResolution(params.id);
        return resolution ? { ...dispute, resolution } : dispute;
      })
    );
  });
};

const registerDisputeOpenRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.post(toServerRoutePath(operation.pathTemplate), { preHandler: [app.authenticate] }, async (request) => {
    const body = parseOperationBody<{
      taskId: string;
      submissionId: string;
      reasonMd: string;
    }>(operation, request);
    validateDisputeReasonLength(body.reasonMd, services.config);

    const opener = request.agentAddress as Address;
    const writeMeta = services.writeMeta({
      request,
      operation: "disputes.open",
      actor: opener,
      targetType: "dispute",
      details: {
        taskId: body.taskId,
        submissionId: body.submissionId
      }
    });
    if (services.stateRepository) {
      return validateOperationResponse(
        operation,
        await services.mutateDirect(() =>
          services.stateRepository!.openDisputeDirect({
            ...body,
            opener,
            disputeReasonMaxLength: services.config.disputeReasonMaxLength,
            auditContext: toWriteAuditContext(writeMeta)
          }),
          writeMeta
        )
      );
    }
    return validateOperationResponse(
      operation,
      await services.mutate(
        (engine) => engine.openDispute({ ...body, opener }),
        ["disputes"],
        writeMeta
      )
    );
  });
};

const registerDisputeVoteRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.post(toServerRoutePath(operation.pathTemplate), { preHandler: [app.authenticate] }, async (request, reply) => {
    const params = parseOperationParams<{ id: string }>(operation, request);
    const body = parseOperationBody<{ vote: VoteChoice }>(operation, request);
    const agent = request.agentAddress as Address;
    const writeMeta = services.writeMeta({
      request,
      operation: "disputes.vote",
      actor: agent,
      targetType: "dispute",
      targetId: params.id,
      details: {
        disputeId: params.id,
        vote: body.vote
      }
    });
    try {
      if (services.stateRepository) {
        return validateOperationResponse(
          operation,
          await services.mutateDirect(() =>
            services.stateRepository!.voteDisputeDirect({
              disputeId: params.id,
              agent,
              vote: body.vote,
              config: services.config,
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
            engine.voteDispute({
              disputeId: params.id,
              agent,
              vote: body.vote
            }),
          ["profiles", "votes", "cycleWorkloads"],
          writeMeta
        )
      );
    } catch (error) {
      if (error instanceof DomainError && error.code === "DUPLICATE_SUPERVISION_PARTICIPATION") {
        reply.code(409);
      }
      throw error;
    }
  });
};

const registerDisputeRespondRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.post(toServerRoutePath(operation.pathTemplate), { preHandler: [app.authenticate] }, async (request) => {
    const params = parseOperationParams<{ id: string }>(operation, request);
    const body = parseOperationBody<{ reasonMd: string }>(operation, request);
    validateDisputeReasonLength(body.reasonMd, services.config);
    const responder = request.agentAddress as Address;
    const writeMeta = services.writeMeta({
      request,
      operation: "disputes.respond",
      actor: responder,
      targetType: "dispute",
      targetId: params.id,
      details: {
        disputeId: params.id
      }
    });

    if (services.stateRepository) {
      return validateOperationResponse(
        operation,
        await services.mutateDirect(() =>
          services.stateRepository!.respondDisputeDirect({
            disputeId: params.id,
            responder,
            reasonMd: body.reasonMd,
            disputeReasonMaxLength: services.config.disputeReasonMaxLength,
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
          engine.respondDispute({
            disputeId: params.id,
            responder,
            reasonMd: body.reasonMd
          }),
        ["disputes"],
        writeMeta
      )
    );
  });
};

const registerActivityListRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.get(toServerRoutePath(operation.pathTemplate), async (request) => {
    const query = parseOperationQuery<ActivityListQuery>(operation, request);
    if (query.address && !isAddress(query.address)) {
      throw new HttpError(400, "invalid address");
    }

    const order = query.order ?? "desc";
    const limit = query.limit ?? 20;

    if (services.stateRepository) {
      return validateOperationResponse(
        operation,
        await services.stateRepository.queryActivitiesDirect({
          taskId: query.taskId,
          disputeId: query.disputeId,
          address: query.address as Address | undefined,
          type: query.type,
          sort: "created",
          order,
          cursor: query.cursor,
          limit,
          paged: true
        })
      );
    }

    let items = await services.readActivities();
    if (query.taskId) {
      items = items.filter((item) => item.taskId === query.taskId);
    }
    if (query.disputeId) {
      items = items.filter((item) => item.disputeId === query.disputeId);
    }
    if (query.address) {
      const address = query.address.toLowerCase();
      items = items.filter((item) => item.actor.toLowerCase() === address);
    }
    if (query.type) {
      items = items.filter((item) => item.type === query.type);
    }
    items.sort((left, right) => {
      let delta = left.createdAt.localeCompare(right.createdAt);
      if (delta === 0) {
        delta = left.id.localeCompare(right.id);
      }
      return order === "asc" ? delta : -delta;
    });

    return validateOperationResponse(
      operation,
      paginateItemsByCursor(items, {
        cursor: query.cursor,
        limit,
        resource: "activities",
        sort: "created",
        order,
        toCursorValues: (item) => ({
          primary: item.createdAt,
          id: item.id
        }),
        compareAfterCursor: (item, cursorValues) =>
          compareActivityAfterCursor(item, order, cursorValues as Record<string, unknown>)
      })
    );
  });
};

const registerDashboardSummaryRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.get(toServerRoutePath(operation.pathTemplate), async (request) => {
    const query = parseOperationQuery<{ tz: string }>(operation, request);
    if (!isValidTimezone(query.tz)) {
      throw new HttpError(400, "invalid timezone");
    }

    if (services.stateRepository) {
      return validateOperationResponse(
        operation,
        await services.stateRepository.getDashboardSummaryDirect(query.tz)
      );
    }

    const [activities, activeCycle, tasks, disputes, agents] = await Promise.all([
      services.readActivities(),
      services.readActiveCycle(),
      services.readTasks(),
      services.readDisputes(),
      services.readAgents()
    ]);
    const now = new Date();
    const todayKey = toDayKey(now, query.tz);
    const todayEvents = activities.filter((item) => toDayKey(item.createdAt, query.tz) === todayKey);
    const cycleEvents = activities.filter((item) => item.cycleId === activeCycle.id);

    return validateOperationResponse(operation, {
      timezone: query.tz,
      generatedAt: now.toISOString(),
      activeCycleId: activeCycle.id,
      today: countMetrics(todayEvents),
      currentCycle: countMetrics(cycleEvents),
      totals: {
        tasks: tasks.length,
        disputes: disputes.length,
        agents: agents.length
      }
    });
  });
};

const registerDashboardTrendRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.get(toServerRoutePath(operation.pathTemplate), async (request) => {
    const query = parseOperationQuery<{ tz: string; window: "7d" | "30d" }>(operation, request);
    if (!isValidTimezone(query.tz)) {
      throw new HttpError(400, "invalid timezone");
    }

    if (services.stateRepository) {
      return validateOperationResponse(
        operation,
        await services.stateRepository.getDashboardTrendsDirect(query.tz, query.window)
      );
    }

    const events = await services.readActivities();
    const windowSize = query.window === "30d" ? 30 : 7;
    const now = new Date();
    const dayKeys: string[] = [];
    for (let step = 0; dayKeys.length < windowSize && step < windowSize * 3; step += 1) {
      const key = toDayKey(new Date(now.getTime() - step * 86_400_000), query.tz);
      if (!dayKeys.includes(key)) {
        dayKeys.unshift(key);
      }
    }

    const pointMap = new Map<string, DashboardTrendPoint>();
    for (const key of dayKeys) {
      pointMap.set(key, {
        bucketStart: `${key}T00:00:00.000Z`,
        label: key,
        tasksPublished: 0,
        tasksIntented: 0,
        tasksCompleted: 0,
        disputesOpened: 0
      });
    }

    for (const event of events) {
      const key = toDayKey(event.createdAt, query.tz);
      const point = pointMap.get(key);
      if (!point) {
        continue;
      }
      if (event.type === ActivityEventType.TASK_PUBLISHED) {
        point.tasksPublished += 1;
      } else if (event.type === ActivityEventType.TASK_INTENDED) {
        point.tasksIntented += 1;
      } else if (event.type === ActivityEventType.TASK_COMPLETED) {
        point.tasksCompleted += 1;
      } else if (event.type === ActivityEventType.DISPUTE_OPENED) {
        point.disputesOpened += 1;
      }
    }

    return validateOperationResponse(operation, {
      timezone: query.tz,
      generatedAt: now.toISOString(),
      window: query.window,
      points: dayKeys.map((key) => pointMap.get(key)!)
    });
  });
};

export const registerDisputeRoutes = (app: FastifyInstance, services: AppServices): void => {
  registerDisputeListRoute(app, services, disputeListOperation);
  registerDisputeGetRoute(app, services, disputeGetOperation);
  registerDisputeOpenRoute(app, services, disputeOpenOperation);
  registerDisputeRespondRoute(app, services, disputeRespondOperation);
  registerDisputeVoteRoute(app, services, disputeVoteOperation);
  registerActivityListRoute(app, services, activityListOperation);
  registerDashboardSummaryRoute(app, services, dashboardSummaryOperation);
  registerDashboardTrendRoute(app, services, dashboardTrendOperation);
};
