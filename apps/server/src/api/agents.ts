import type { FastifyInstance } from "fastify";
import type { AgentDirectoryItem, Address, AgentProfile, Cycle } from "@agentrade/types";
import { getApiOperation, type ApiOperationDefinition } from "@agentrade/contracts";
import type { AppServices } from "./services.js";
import {
  hasExplicitPagination,
  isAddress,
  paginateItems,
  parseCursorOffset,
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
  sort?: "latest" | "score" | "reputation" | "completed" | "published" | "accepted";
  order?: "asc" | "desc";
  cursor?: string;
  limit?: number;
};

type CycleListQuery = {
  cursor?: string;
  limit?: number;
};

const agentListOperations = [getApiOperation("agentsListV1"), getApiOperation("agentsListV2")] as const;
const agentGetOperations = [
  getApiOperation("agentsGetProfileV1"),
  getApiOperation("agentsGetProfileV2")
] as const;
const agentUpdateOperations = [
  getApiOperation("agentsUpdateProfileV1"),
  getApiOperation("agentsUpdateProfileV2")
] as const;
const agentStatsOperations = [
  getApiOperation("agentsGetStatsV1"),
  getApiOperation("agentsGetStatsV2")
] as const;
const ledgerOperations = [getApiOperation("ledgerGetV1"), getApiOperation("ledgerGetV2")] as const;
const cycleListOperations = [getApiOperation("cyclesListV1"), getApiOperation("cyclesListV2")] as const;
const cycleActiveOperations = [
  getApiOperation("cyclesGetActiveV1"),
  getApiOperation("cyclesGetActiveV2")
] as const;
const cycleGetOperations = [getApiOperation("cyclesGetV1"), getApiOperation("cyclesGetV2")] as const;
const cycleRewardsOperations = [
  getApiOperation("cyclesGetRewardsV1"),
  getApiOperation("cyclesGetRewardsV2")
] as const;
const adminCloseOperations = [
  getApiOperation("adminCloseCycleV1"),
  getApiOperation("adminCloseCycleV2")
] as const;
const adminOverrideOperations = [
  getApiOperation("adminOverrideDisputeV1"),
  getApiOperation("adminOverrideDisputeV2")
] as const;
const adminBridgeExportOperations = [
  getApiOperation("adminBridgeExportV1"),
  getApiOperation("adminBridgeExportV2")
] as const;

const sortAgents = (
  items: AgentDirectoryItem[],
  sortKey: "latest" | "score" | "reputation" | "completed" | "published" | "accepted",
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
    } else if (sortKey === "accepted") {
      delta = left.stats.tasksAccepted - right.stats.tasksAccepted;
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
    const paged = operation.version === "v2" || hasExplicitPagination(request.query);

    if (services.stateRepository) {
      return validateOperationResponse(
        operation,
        await services.stateRepository.queryAgentsDirect({
          q: query.q,
          activeOnly: query.activeOnly,
          sort,
          order,
          offset: parseCursorOffset(query.cursor),
          limit,
          paged
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
        profile.stats.tasksAccepted > 0 ||
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
    const payload = paged ? paginateItems(items, query.cursor, limit) : { items, nextCursor: null };
    return validateOperationResponse(operation, payload);
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
    if (params.address.toLowerCase() !== String(request.agentAddress).toLowerCase()) {
      throw new HttpError(403, "cannot update another profile");
    }
    if (services.stateRepository) {
      return validateOperationResponse(
        operation,
        await services.mutateDirect(() =>
          services.stateRepository!.updateAgentProfileDirect(params.address as Address, body)
        )
      );
    }
    return validateOperationResponse(
      operation,
      await services.mutate((engine) => engine.updateAgentProfile(params.address as Address, body), [
        "profiles"
      ])
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

const paginateCycles = (
  items: Cycle[],
  query: CycleListQuery,
  operation: ApiOperationDefinition,
  requestQuery: unknown
) => {
  if (operation.version === "v2") {
    return paginateItems(items, query.cursor, query.limit ?? 20);
  }
  if (hasExplicitPagination(requestQuery)) {
    return paginateItems(items, query.cursor, query.limit ?? 20);
  }
  return { items, nextCursor: null };
};

const registerCycleListRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.get(toServerRoutePath(operation.pathTemplate), async (request) => {
    const query = parseOperationQuery<CycleListQuery>(operation, request);
    const items = services.stateRepository
      ? await services.stateRepository.listCyclesDirect()
      : await services.read((engine) => engine.listCycles());
    return validateOperationResponse(operation, paginateCycles(items, query, operation, request.query));
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
        await services.mutateDirect(() => services.stateRepository!.closeCurrentCycleDirect(services.config))
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
      ])
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
        )
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
      ])
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
  for (const operation of agentListOperations) {
    registerAgentListRoute(app, services, operation);
  }
  for (const operation of agentGetOperations) {
    registerAgentGetRoute(app, services, operation);
  }
  for (const operation of agentUpdateOperations) {
    registerAgentUpdateRoute(app, services, operation);
  }
  for (const operation of agentStatsOperations) {
    registerAgentStatsRoute(app, services, operation);
  }
  for (const operation of ledgerOperations) {
    registerLedgerRoute(app, services, operation);
  }
  for (const operation of cycleListOperations) {
    registerCycleListRoute(app, services, operation);
  }
  for (const operation of cycleActiveOperations) {
    registerCycleActiveRoute(app, services, operation);
  }
  for (const operation of cycleGetOperations) {
    registerCycleGetRoute(app, services, operation);
  }
  for (const operation of cycleRewardsOperations) {
    registerCycleRewardsRoute(app, services, operation);
  }
  for (const operation of adminCloseOperations) {
    registerAdminCloseRoute(app, services, operation);
  }
  for (const operation of adminOverrideOperations) {
    registerAdminOverrideRoute(app, services, operation);
  }
  for (const operation of adminBridgeExportOperations) {
    registerAdminBridgeExportRoute(app, services, operation);
  }
};
