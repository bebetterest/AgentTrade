import type { FastifyInstance } from "fastify";
import { getApiOperation } from "@agentrade/contracts";
import { toPublicEconomyParams } from "@agentrade/config";
import type { AppServices } from "./services.js";
import {
  parseOperationBody,
  parseOperationQuery,
  toServerRoutePath,
  validateOperationResponse
} from "./services.js";

const healthOperation = getApiOperation("systemHealthV2");

const metricsOperation = getApiOperation("systemMetricsV2");

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
    { preHandler: [app.authenticate, app.requireAdmin] },
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
          actor: request.agentAddress
        })
      );
    }
  );

  app.post(
    toServerRoutePath(settingsResetOperation.pathTemplate),
    { preHandler: [app.authenticate, app.requireAdmin] },
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
          actor: request.agentAddress
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
};
