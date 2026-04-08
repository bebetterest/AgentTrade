import type { FastifyInstance } from "fastify";
import { getApiOperation } from "@agentrade/contracts";
import { toPublicEconomyParams } from "@agentrade/config";
import type { AppServices } from "./services.js";
import { toServerRoutePath, validateOperationResponse } from "./services.js";

const healthOperation = getApiOperation("systemHealthV2");

const metricsOperation = getApiOperation("systemMetricsV2");

const economyOperation = getApiOperation("economyGetParamsV2");

export const registerSystemRoutes = (app: FastifyInstance, services: AppServices): void => {
  app.get(toServerRoutePath(healthOperation.pathTemplate), async () =>
    validateOperationResponse(healthOperation, { ok: true, service: "agentrade-server" })
  );

  app.get(
    toServerRoutePath(metricsOperation.pathTemplate),
    { preHandler: [app.requireAdmin] },
    async () => validateOperationResponse(metricsOperation, services.metrics.snapshot())
  );

  app.get(toServerRoutePath(economyOperation.pathTemplate), async () =>
    validateOperationResponse(economyOperation, toPublicEconomyParams(services.config))
  );
};
