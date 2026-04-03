import type { FastifyInstance } from "fastify";
import { getApiOperation } from "@agentrade/contracts";
import type { AppServices } from "./services.js";
import { toServerRoutePath, validateOperationResponse } from "./services.js";

const healthOperation = getApiOperation("systemHealthV2");

const economyOperation = getApiOperation("economyGetParamsV2");

export const registerSystemRoutes = (app: FastifyInstance, services: AppServices): void => {
  app.get(toServerRoutePath(healthOperation.pathTemplate), async () =>
    validateOperationResponse(healthOperation, { ok: true, service: "agentrade-server" })
  );

  app.get(toServerRoutePath(economyOperation.pathTemplate), async () =>
    validateOperationResponse(economyOperation, {
      appName: services.config.appName,
      enablePersistence: services.config.enablePersistence,
      enableRedisRateLimit: services.config.enableRedisRateLimit,
      authChallengeTtlMinutes: services.config.authChallengeTtlMinutes,
      rateLimitPerMinute: services.config.rateLimitPerMinute,
      rateLimitBurst: services.config.rateLimitBurst,
      taskTitleMaxLength: services.config.taskTitleMaxLength,
      taskDescriptionMaxLength: services.config.taskDescriptionMaxLength,
      taskAcceptanceCriteriaMaxLength: services.config.taskAcceptanceCriteriaMaxLength,
      taskSubmissionPayloadMaxLength: services.config.taskSubmissionPayloadMaxLength,
      disputeReasonMaxLength: services.config.disputeReasonMaxLength,
      taskSlotsMax: services.config.taskSlotsMax,
      taskRewardPerSlotMax: services.config.taskRewardPerSlotMax,
      taskDeadlineMaxHours: services.config.taskDeadlineMaxHours,
      taxRateBps: services.config.taxRateBps,
      taxMin: services.config.taxMin,
      rewardMin: services.config.rewardMin,
      mintPerCycle: services.config.mintPerCycle,
      terminationPenaltyBps: services.config.terminationPenaltyBps,
      submissionTimeoutHours: services.config.submissionTimeoutHours,
      resubmitCooldownMinutes: services.config.resubmitCooldownMinutes,
      disputeQuorum: services.config.disputeQuorum,
      disputeApprovalBps: services.config.disputeApprovalBps,
      reputationWeightPublisherBps: services.config.reputationWeightPublisherBps,
      reputationWeightWorkerBps: services.config.reputationWeightWorkerBps,
      reputationWeightSupervisorBps: services.config.reputationWeightSupervisorBps,
      bridgeChain: services.config.bridgeChain,
      bridgeMode: services.config.bridgeMode
    })
  );
};
