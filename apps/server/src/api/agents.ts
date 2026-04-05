import type { FastifyInstance } from "fastify";
import type { AgentDirectoryItem, Address, AgentProfile } from "@agentrade/types";
import { getApiOperation, type ApiOperationDefinition } from "@agentrade/contracts";
import type { AppServices } from "./services.js";
import {
  isAddress,
  paginateItemsByCursor,
  parseOperationBody,
  parseOperationParams,
  parseOperationQuery,
  toAgentScore,
  toServerRoutePath,
  validateOperationResponse
} from "./services.js";
import { DomainError } from "../domain/errors.js";
import { HttpError } from "../utils/http-error.js";

type AgentListQuery = {
  q?: string;
  activeOnly?: boolean;
  sort?: "latest" | "score" | "reputation" | "completed" | "published" | "intented";
  order?: "asc" | "desc";
  cursor?: string;
  limit?: number;
};

type CycleListQuery = {
  cursor?: string;
  limit?: number;
};

const agentListOperation = getApiOperation("agentsListV2");
const agentGetOperation = getApiOperation("agentsGetProfileV2");
const agentUpdateOperation = getApiOperation("agentsUpdateProfileV2");
const agentStatsOperation = getApiOperation("agentsGetStatsV2");
const ledgerOperation = getApiOperation("ledgerGetV2");
const cycleListOperation = getApiOperation("cyclesListV2");
const cycleActiveOperation = getApiOperation("cyclesGetActiveV2");
const cycleGetOperation = getApiOperation("cyclesGetV2");
const cycleRewardsOperation = getApiOperation("cyclesGetRewardsV2");
const adminCloseOperation = getApiOperation("adminCloseCycleV2");
const adminOverrideOperation = getApiOperation("adminOverrideDisputeV2");
const adminBridgeExportOperation = getApiOperation("adminBridgeExportV2");

const sortAgents = (
  items: AgentDirectoryItem[],
  sortKey: "latest" | "score" | "reputation" | "completed" | "published" | "intented",
  order: "asc" | "desc"
) => {
  items.sort((left, right) => {
    let delta = 0;
    if (sortKey === "score") {
      delta = left.score - right.score;
    } else if (sortKey === "reputation") {
      const repLeft =
        (left.reputation.publisher + left.reputation.worker + left.reputation.supervisor) / 3;
      const repRight =
        (right.reputation.publisher + right.reputation.worker + right.reputation.supervisor) / 3;
      delta = repLeft - repRight;
    } else if (sortKey === "completed") {
      delta = left.stats.tasksCompleted - right.stats.tasksCompleted;
    } else if (sortKey === "published") {
      delta = left.stats.tasksPublished - right.stats.tasksPublished;
    } else if (sortKey === "intented") {
      delta = left.stats.tasksIntented - right.stats.tasksIntented;
    } else {
      const leftActivity = left.latestActivityAt ?? "";
      const rightActivity = right.latestActivityAt ?? "";
      delta = leftActivity.localeCompare(rightActivity);
    }
    if (delta === 0) {
      delta = left.address.localeCompare(right.address);
    }
    return order === "asc" ? delta : -delta;
  });
};

const agentSortPrimary = (
  item: AgentDirectoryItem,
  sortKey: "latest" | "score" | "reputation" | "completed" | "published" | "intented"
): string | number | null =>
  sortKey === "score"
    ? item.score
    : sortKey === "reputation"
      ? (item.reputation.publisher + item.reputation.worker + item.reputation.supervisor) / 3
      : sortKey === "completed"
        ? item.stats.tasksCompleted
        : sortKey === "published"
          ? item.stats.tasksPublished
          : sortKey === "intented"
            ? item.stats.tasksIntented
            : item.latestActivityAt;

const compareAgentAfterCursor = (
  item: AgentDirectoryItem,
  sortKey: "latest" | "score" | "reputation" | "completed" | "published" | "intented",
  order: "asc" | "desc",
  cursorValues: Record<string, unknown>
): number => {
  const cursorAddress = cursorValues.address;
  if (typeof cursorAddress !== "string" || cursorAddress.length === 0) {
    throw new DomainError("INVALID_CURSOR", "cursor address must be a non-empty string", 400);
  }
  const cursorPrimary = cursorValues.primary;
  let delta = 0;
  if (sortKey === "latest") {
    if (cursorPrimary !== null && (typeof cursorPrimary !== "string" || cursorPrimary.length === 0)) {
      throw new DomainError("INVALID_CURSOR", "cursor primary must be null or ISO datetime string", 400);
    }
    const left = item.latestActivityAt ?? "";
    const right = typeof cursorPrimary === "string" ? cursorPrimary : "";
    delta = left.localeCompare(right);
  } else {
    const asNumber =
      typeof cursorPrimary === "number"
        ? cursorPrimary
        : typeof cursorPrimary === "string"
          ? Number(cursorPrimary)
          : Number.NaN;
    if (!Number.isFinite(asNumber)) {
      throw new DomainError("INVALID_CURSOR", "cursor primary must be a finite number", 400);
    }
    delta = Number(agentSortPrimary(item, sortKey)) - asNumber;
  }
  if (delta === 0) {
    delta = item.address.localeCompare(cursorAddress);
  }
  return order === "asc" ? delta : -delta;
};

const compareCycleAfterCursor = (
  item: { id: string; startedAt: string },
  cursorValues: Record<string, unknown>
): number => {
  const cursorId = cursorValues.id;
  const cursorStartedAt = cursorValues.primary;
  if (typeof cursorId !== "string" || cursorId.length === 0) {
    throw new DomainError("INVALID_CURSOR", "cursor id must be a non-empty string", 400);
  }
  if (typeof cursorStartedAt !== "string" || cursorStartedAt.length === 0) {
    throw new DomainError("INVALID_CURSOR", "cursor primary must be a non-empty ISO datetime string", 400);
  }
  let delta = item.startedAt.localeCompare(cursorStartedAt);
  if (delta === 0) {
    delta = item.id.localeCompare(cursorId);
  }
  return delta;
};

const registerAgentListRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.get(toServerRoutePath(operation.pathTemplate), async (request) => {
    const query = parseOperationQuery<AgentListQuery>(operation, request);
    const sort = query.sort ?? "latest";
    const order = query.order ?? "desc";
    const limit = query.limit ?? 20;

    if (services.stateRepository) {
      return validateOperationResponse(
        operation,
        await services.stateRepository.queryAgentsDirect({
          q: query.q,
          activeOnly: query.activeOnly,
          sort,
          order,
          cursor: query.cursor,
          limit,
          paged: true
        })
      );
    }

    const [profiles, activities] = await Promise.all([services.readAgents(), services.readActivities()]);
    const latestActivityByAddress = new Map<string, string>();
    for (const event of activities) {
      const previous = latestActivityByAddress.get(event.actor);
      if (!previous || previous < event.createdAt) {
        latestActivityByAddress.set(event.actor, event.createdAt);
      }
    }

    let items: AgentDirectoryItem[] = profiles.map((profile) => {
      const latestActivityAt = latestActivityByAddress.get(profile.address) ?? null;
      const isActive =
        latestActivityAt !== null ||
        profile.stats.tasksIntented > 0 ||
        profile.stats.tasksPublished > 0 ||
        profile.stats.tasksCompleted > 0 ||
        profile.stats.submissionsRejected > 0 ||
        profile.stats.supervisionVotes > 0;
      return {
        ...profile,
        latestActivityAt,
        score: toAgentScore(profile),
        isActive
      };
    });

    if (query.activeOnly) {
      items = items.filter((item) => item.isActive);
    }
    if (query.q) {
      const q = query.q.toLowerCase();
      items = items.filter(
        (item) =>
          item.address.toLowerCase().includes(q) ||
          item.name.toLowerCase().includes(q) ||
          item.bio.toLowerCase().includes(q)
      );
    }

    sortAgents(items, sort, order);
    return validateOperationResponse(
      operation,
      paginateItemsByCursor(items, {
        cursor: query.cursor,
        limit,
        resource: "agents",
        sort,
        order,
        toCursorValues: (item) => ({
          primary: agentSortPrimary(item, sort),
          address: item.address
        }),
        compareAfterCursor: (item, cursorValues) =>
          compareAgentAfterCursor(
            item,
            sort,
            order,
            cursorValues as Record<string, unknown>
          )
      })
    );
  });
};

const registerAgentGetRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.get(toServerRoutePath(operation.pathTemplate), async (request) => {
    const params = parseOperationParams<{ address: string }>(operation, request);
    if (!isAddress(params.address)) {
      throw new HttpError(400, "invalid address");
    }
    if (services.stateRepository) {
      const address = params.address as Address;
      const profile = await services.stateRepository.getAgentDirect(address);
      return validateOperationResponse(operation, profile ?? services.defaultAgentProfile(address));
    }
    return validateOperationResponse(
      operation,
      await services.read((engine) => engine.getAgent(params.address as Address))
    );
  });
};

const registerAgentUpdateRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.patch(toServerRoutePath(operation.pathTemplate), { preHandler: [app.authenticate] }, async (request) => {
    const params = parseOperationParams<{ address: string }>(operation, request);
    const body = parseOperationBody<{ name?: string; bio?: string }>(operation, request);
    const actor = request.agentAddress as Address;
    if (params.address.toLowerCase() !== String(request.agentAddress).toLowerCase()) {
      throw new HttpError(403, "cannot update another profile");
    }
    if (services.stateRepository) {
      return validateOperationResponse(
        operation,
        await services.mutateDirect(() =>
          services.stateRepository!.updateAgentProfileDirect(params.address as Address, body)
        , services.writeMeta({ operation: "agents.update-profile", actor }))
      );
    }
    return validateOperationResponse(
      operation,
      await services.mutate((engine) => engine.updateAgentProfile(params.address as Address, body), [
        "profiles"
      ], services.writeMeta({ operation: "agents.update-profile", actor }))
    );
  });
};

const registerAgentStatsRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.get(toServerRoutePath(operation.pathTemplate), async (request) => {
    const params = parseOperationParams<{ address: string }>(operation, request);
    if (!isAddress(params.address)) {
      throw new HttpError(400, "invalid address");
    }
    if (services.stateRepository) {
      const address = params.address as Address;
      const profile = await services.stateRepository.getAgentDirect(address);
      return validateOperationResponse(operation, (profile ?? services.defaultAgentProfile(address)).stats);
    }
    return validateOperationResponse(
      operation,
      await services.read((engine) => engine.getAgent(params.address as Address).stats)
    );
  });
};

const registerLedgerRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.get(toServerRoutePath(operation.pathTemplate), async (request) => {
    const params = parseOperationParams<{ address: string }>(operation, request);
    if (!isAddress(params.address)) {
      throw new HttpError(400, "invalid address");
    }
    if (services.stateRepository) {
      const address = params.address as Address;
      const ledger = await services.stateRepository.getLedgerDirect(address);
      return validateOperationResponse(operation, ledger ?? services.defaultLedger(address));
    }
    return validateOperationResponse(
      operation,
      await services.read((engine) => engine.getLedger(params.address as Address))
    );
  });
};

const registerCycleListRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.get(toServerRoutePath(operation.pathTemplate), async (request) => {
    const query = parseOperationQuery<CycleListQuery>(operation, request);
    if (services.stateRepository) {
      return validateOperationResponse(
        operation,
        await services.stateRepository.queryCyclesDirect({
          cursor: query.cursor,
          limit: query.limit ?? 20,
          paged: true
        })
      );
    }
    const items = await services.read((engine) => engine.listCycles());
    return validateOperationResponse(
      operation,
      paginateItemsByCursor(items, {
        cursor: query.cursor,
        limit: query.limit ?? 20,
        resource: "cycles",
        sort: "startedAt",
        order: "asc",
        toCursorValues: (item) => ({
          primary: item.startedAt,
          id: item.id
        }),
        compareAfterCursor: (item, cursorValues) =>
          compareCycleAfterCursor(item, cursorValues as Record<string, unknown>)
      })
    );
  });
};

const registerCycleActiveRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.get(toServerRoutePath(operation.pathTemplate), async () => {
    if (services.stateRepository) {
      const cycle = await services.stateRepository.getActiveCycleDirect();
      if (!cycle) {
        throw new DomainError("CYCLE_NOT_FOUND", "active cycle not found", 404);
      }
      return validateOperationResponse(operation, cycle);
    }
    return validateOperationResponse(operation, await services.read((engine) => engine.getActiveCycle()));
  });
};

const registerCycleGetRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.get(toServerRoutePath(operation.pathTemplate), async (request) => {
    const params = parseOperationParams<{ id: string }>(operation, request);
    if (services.stateRepository) {
      const cycle = await services.stateRepository.getCycleDirect(params.id);
      if (!cycle) {
        throw new DomainError("CYCLE_NOT_FOUND", `Cycle ${params.id} not found`, 404);
      }
      return validateOperationResponse(operation, cycle);
    }
    return validateOperationResponse(operation, await services.read((engine) => engine.getCycle(params.id)));
  });
};

const registerCycleRewardsRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.get(toServerRoutePath(operation.pathTemplate), async (request) => {
    const params = parseOperationParams<{ id: string }>(operation, request);
    if (services.stateRepository) {
      const rewards = await services.stateRepository.getCycleRewardsDirect(params.id);
      if (!rewards) {
        throw new DomainError("CYCLE_NOT_FOUND", `Cycle ${params.id} not found`, 404);
      }
      return validateOperationResponse(operation, rewards);
    }
    return validateOperationResponse(
      operation,
      await services.read((engine) => engine.getCycleRewards(params.id))
    );
  });
};

const registerAdminCloseRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.post(toServerRoutePath(operation.pathTemplate), { preHandler: [app.requireAdmin] }, async () => {
    if (services.stateRepository) {
      return validateOperationResponse(
        operation,
        await services.mutateDirect(
          () => services.stateRepository!.closeCurrentCycleDirect(services.config),
          services.writeMeta({ operation: "admin.cycles.close" })
        )
      );
    }
    return validateOperationResponse(
      operation,
      await services.mutate((engine) => engine.closeCurrentCycle(), [
        "profiles",
        "balances",
        "tasks",
        "submissions",
        "disputes",
        "cycleWorkloads",
        "cycles"
      ], services.writeMeta({ operation: "admin.cycles.close" }))
    );
  });
};

const registerAdminOverrideRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.post(toServerRoutePath(operation.pathTemplate), { preHandler: [app.requireAdmin] }, async (request) => {
    const params = parseOperationParams<{ id: string }>(operation, request);
    const body = parseOperationBody<{ result: "COMPLETED" | "NOT_COMPLETED" }>(operation, request);
    if (services.stateRepository) {
      return validateOperationResponse(
        operation,
        await services.mutateDirect(() =>
          services.stateRepository!.overrideDisputeDirect(params.id, body.result)
        , services.writeMeta({ operation: "admin.disputes.override" }))
      );
    }
    return validateOperationResponse(
      operation,
      await services.mutate((engine) => engine.overrideDispute(params.id, body.result), [
        "profiles",
        "balances",
        "tasks",
        "submissions",
        "disputes"
      ], services.writeMeta({ operation: "admin.disputes.override" }))
    );
  });
};

const registerAdminBridgeExportRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.post(toServerRoutePath(operation.pathTemplate), { preHandler: [app.requireAdmin] }, async (request) => {
    const body = parseOperationBody<{ addresses?: string[] }>(operation, request, request.body ?? {});
    const addresses = body.addresses?.filter((item): item is Address => isAddress(item));
    const payload = {
      chain: services.config.bridgeChain,
      mode: services.config.bridgeMode,
      exports: services.stateRepository
        ? await services.stateRepository.exportBridgeBatchDirect({ addresses })
        : await services.read((engine) => engine.exportBridgeBatch({ addresses }))
    };
    return validateOperationResponse(operation, payload);
  });
};

export const registerAgentRoutes = (app: FastifyInstance, services: AppServices): void => {
  registerAgentListRoute(app, services, agentListOperation);
  registerAgentGetRoute(app, services, agentGetOperation);
  registerAgentUpdateRoute(app, services, agentUpdateOperation);
  registerAgentStatsRoute(app, services, agentStatsOperation);
  registerLedgerRoute(app, services, ledgerOperation);
  registerCycleListRoute(app, services, cycleListOperation);
  registerCycleActiveRoute(app, services, cycleActiveOperation);
  registerCycleGetRoute(app, services, cycleGetOperation);
  registerCycleRewardsRoute(app, services, cycleRewardsOperation);
  registerAdminCloseRoute(app, services, adminCloseOperation);
  registerAdminOverrideRoute(app, services, adminOverrideOperation);
  registerAdminBridgeExportRoute(app, services, adminBridgeExportOperation);
};
