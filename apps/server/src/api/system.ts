import type { FastifyInstance } from "fastify";
import { getApiOperation } from "@agentrade/contracts";
import { toPublicEconomyParams } from "@agentrade/config";
import {
  ServerAuditCategory,
  ServerAuditOutcome
} from "@agentrade/types";
import type { AppServices } from "./services.js";
import {
  parseOperationBody,
  parseOperationQuery,
  toServerRoutePath,
  validateOperationResponse
} from "./services.js";
import { extractRequestNetworkContext } from "../observability/server-logs.js";

const healthOperation = getApiOperation("systemHealthV2");

const metricsOperation = getApiOperation("systemMetricsV2");
const requestLogsOperation = getApiOperation("systemRequestLogsListV2");
const auditLogsOperation = getApiOperation("systemAuditLogsListV2");

const economyOperation = getApiOperation("economyGetParamsV2");
const settingsGetOperation = getApiOperation("systemSettingsGetV2");
const settingsUpdateOperation = getApiOperation("systemSettingsUpdateV2");
const settingsResetOperation = getApiOperation("systemSettingsResetV2");
const settingsHistoryOperation = getApiOperation("systemSettingsHistoryV2");

export const registerSystemRoutes = (app: FastifyInstance, services: AppServices): void => {
  app.get(toServerRoutePath(healthOperation.pathTemplate), async () =>
    validateOperationResponse(healthOperation, { ok: true, service: "agentrade-server" })
  );

  app.get(
    toServerRoutePath(metricsOperation.pathTemplate),
    { preHandler: [app.authenticate] },
    async () => validateOperationResponse(metricsOperation, services.metrics.snapshot())
  );

  app.get(toServerRoutePath(economyOperation.pathTemplate), async () =>
    validateOperationResponse(economyOperation, toPublicEconomyParams(services.config))
  );

  app.get(
    toServerRoutePath(settingsGetOperation.pathTemplate),
    { preHandler: [app.authenticate] },
    async () => validateOperationResponse(settingsGetOperation, await services.readRuntimeSettings())
  );

  app.patch(
    toServerRoutePath(settingsUpdateOperation.pathTemplate),
    { preHandler: [app.authenticate, app.requireActiveAgent, app.requireAdmin] },
    async (request) => {
      const body = parseOperationBody<{
        applyTo: "current" | "next";
        patch: Record<string, number>;
        reason?: string;
      }>(settingsUpdateOperation, request);
      return validateOperationResponse(
        settingsUpdateOperation,
        await services.updateRuntimeSettings({
          applyTo: body.applyTo,
          patch: body.patch,
          reason: body.reason,
          actor: request.agentAddress,
          auditContext: {
            category: ServerAuditCategory.ADMIN,
            action: "system.settings.update",
            requestId: request.id,
            clientIp: extractRequestNetworkContext(request).clientIp,
            actorAddress: request.agentAddress as `0x${string}`,
            method: request.method,
            routeId: request.routeOptions?.url ?? "unmatched",
            targetType: "runtime-settings",
            targetId: "singleton"
          }
        })
      );
    }
  );

  app.post(
    toServerRoutePath(settingsResetOperation.pathTemplate),
    { preHandler: [app.authenticate, app.requireActiveAgent, app.requireAdmin] },
    async (request) => {
      const body = parseOperationBody<{ applyTo: "current" | "next"; reason?: string }>(
        settingsResetOperation,
        request
      );
      return validateOperationResponse(
        settingsResetOperation,
        await services.resetRuntimeSettings({
          applyTo: body.applyTo,
          reason: body.reason,
          actor: request.agentAddress,
          auditContext: {
            category: ServerAuditCategory.ADMIN,
            action: "system.settings.reset",
            requestId: request.id,
            clientIp: extractRequestNetworkContext(request).clientIp,
            actorAddress: request.agentAddress as `0x${string}`,
            method: request.method,
            routeId: request.routeOptions?.url ?? "unmatched",
            targetType: "runtime-settings",
            targetId: "singleton"
          }
        })
      );
    }
  );

  app.get(
    toServerRoutePath(settingsHistoryOperation.pathTemplate),
    { preHandler: [app.authenticate] },
    async (request) => {
      const query = parseOperationQuery<{ cursor?: string; limit?: number }>(
        settingsHistoryOperation,
        request
      );
      return validateOperationResponse(
        settingsHistoryOperation,
        await services.listRuntimeRuleHistory({
          cursor: query.cursor,
          limit: query.limit ?? 20
        })
      );
    }
  );

  app.get(
    toServerRoutePath(requestLogsOperation.pathTemplate),
    { preHandler: [app.authenticate, app.requireAdmin] },
    async (request) => {
      const query = parseOperationQuery<{
        cursor?: string;
        limit?: number;
        from?: string;
        to?: string;
        requestId?: string;
        actor?: string;
        ip?: string;
        method?: string;
        routeId?: string;
        status?: number;
      }>(requestLogsOperation, request);
      return validateOperationResponse(
        requestLogsOperation,
        await services.listRequestLogs({
          cursor: query.cursor,
          limit: query.limit ?? 20,
          from: query.from,
          to: query.to,
          requestId: query.requestId,
          actor: query.actor as `0x${string}` | undefined,
          ip: query.ip,
          method: query.method,
          routeId: query.routeId,
          status: query.status
        })
      );
    }
  );

  app.get(
    toServerRoutePath(auditLogsOperation.pathTemplate),
    { preHandler: [app.authenticate, app.requireAdmin] },
    async (request) => {
      const query = parseOperationQuery<{
        cursor?: string;
        limit?: number;
        from?: string;
        to?: string;
        requestId?: string;
        actor?: string;
        ip?: string;
        category?: ServerAuditCategory;
        action?: string;
        outcome?: ServerAuditOutcome;
      }>(auditLogsOperation, request);
      return validateOperationResponse(
        auditLogsOperation,
        await services.listAuditLogs({
          cursor: query.cursor,
          limit: query.limit ?? 20,
          from: query.from,
          to: query.to,
          requestId: query.requestId,
          actor: query.actor as `0x${string}` | undefined,
          ip: query.ip,
          category: query.category,
          action: query.action,
          outcome: query.outcome
        })
      );
    }
  );
};
