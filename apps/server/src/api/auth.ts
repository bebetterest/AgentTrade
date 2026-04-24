import jwt from "jsonwebtoken";
import { nanoid } from "nanoid";
import { verifyMessage } from "viem";
import type { FastifyInstance } from "fastify";
import { getApiOperation, type ApiOperationDefinition } from "@agentrade/contracts";
import type { Address } from "@agentrade/types";
import type { AppServices } from "./services.js";
import {
  isAddress,
  parseOperationBody,
  toServerRoutePath,
  validateOperationResponse
} from "./services.js";
import { DomainError } from "../domain/errors.js";
import { HttpError } from "../utils/http-error.js";

const authChallengeOperation = getApiOperation("authChallengeV2");

const authVerifyOperation = getApiOperation("authVerifyV2");

interface ChallengeMaintenance {
  ttlMs: number;
  maybeSweep(nowMs: number, force?: boolean): void;
  ensureCapacity(addressKey: string, nowMs: number): void;
}

const createChallengeMaintenance = (services: AppServices): ChallengeMaintenance => {
  const ttlMs = Math.max(0, services.config.authChallengeTtlMinutes * 60_000);
  const sweepIntervalMs = Math.max(0, services.config.authChallengeSweepIntervalMs);
  const maxEntries = services.config.authChallengeMaxEntries;
  let nextSweepAt = 0;

  const sweepExpired = (nowMs: number): void => {
    if (services.challenges.size === 0) {
      return;
    }
    if (ttlMs === 0) {
      services.challenges.clear();
      return;
    }
    for (const [key, challenge] of services.challenges) {
      if (nowMs - challenge.createdAt >= ttlMs) {
        services.challenges.delete(key);
      }
    }
  };

  const maybeSweep = (nowMs: number, force = false): void => {
    if (!force && nowMs < nextSweepAt) {
      return;
    }
    sweepExpired(nowMs);
    nextSweepAt = nowMs + sweepIntervalMs;
  };

  const ensureCapacity = (addressKey: string, nowMs: number): void => {
    if (services.challenges.has(addressKey)) {
      return;
    }
    if (services.challenges.size < maxEntries) {
      return;
    }
    maybeSweep(nowMs, true);
    if (services.challenges.size >= maxEntries) {
      throw new HttpError(429, "too many pending auth challenges");
    }
  };

  return {
    ttlMs,
    maybeSweep,
    ensureCapacity
  };
};

const registerAuthChallengeRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition,
  maintenance: ChallengeMaintenance
) => {
  app.post(toServerRoutePath(operation.pathTemplate), async (request) => {
    const body = parseOperationBody<{ address: string }>(operation, request);
    if (!isAddress(body.address)) {
      throw new HttpError(400, "invalid address");
    }
    const addressKey = body.address.toLowerCase();
    const nowMs = Date.now();
    maintenance.maybeSweep(nowMs);
    maintenance.ensureCapacity(addressKey, nowMs);

    const nonce = nanoid(12);
    const message = `Agentrade SIWE\nAddress: ${body.address}\nNonce: ${nonce}\nIssuedAt: ${new Date(nowMs).toISOString()}`;
    services.challenges.set(addressKey, {
      address: body.address as Address,
      nonce,
      message,
      createdAt: nowMs
    });
    return validateOperationResponse(operation, {
      nonce,
      message
    });
  });
};

const registerAuthVerifyRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition,
  maintenance: ChallengeMaintenance
) => {
  app.post(toServerRoutePath(operation.pathTemplate), async (request) => {
    const body = parseOperationBody<{
      address: string;
      nonce: string;
      message: string;
      signature: string;
    }>(operation, request);
    if (!isAddress(body.address)) {
      throw new DomainError("INVALID_ADDRESS", "invalid address", 400);
    }
    const addressKey = body.address.toLowerCase();
    const nowMs = Date.now();
    const challenge = services.challenges.get(addressKey);
    if (!challenge) {
      throw new DomainError("CHALLENGE_NOT_FOUND", "challenge not found", 401);
    }
    if (nowMs - challenge.createdAt >= maintenance.ttlMs) {
      services.challenges.delete(addressKey);
      throw new DomainError("CHALLENGE_EXPIRED", "challenge expired", 401);
    }
    if (challenge.nonce !== body.nonce || challenge.message !== body.message) {
      throw new DomainError("CHALLENGE_MISMATCH", "challenge mismatch", 401);
    }
    const valid = await verifyMessage({
      address: body.address as Address,
      message: body.message,
      signature: body.signature as `0x${string}`
    }).catch(() => false);
    if (!valid) {
      throw new DomainError("INVALID_SIGNATURE", "invalid signature", 401);
    }
    const token = jwt.sign({ sub: body.address }, services.config.jwtSecret, { expiresIn: "15m" });
    services.challenges.delete(addressKey);
    return validateOperationResponse(operation, {
      token,
      expiresIn: "15m"
    });
  });
};

export const registerAuthRoutes = (app: FastifyInstance, services: AppServices): void => {
  const maintenance = createChallengeMaintenance(services);
  registerAuthChallengeRoute(app, services, authChallengeOperation, maintenance);
  registerAuthVerifyRoute(app, services, authVerifyOperation, maintenance);
};
