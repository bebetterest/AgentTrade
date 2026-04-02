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
import { HttpError } from "../utils/http-error.js";

const authChallengeOperations = [
  getApiOperation("authChallengeV1"),
  getApiOperation("authChallengeV2")
] as const;

const authVerifyOperations = [
  getApiOperation("authVerifyV1"),
  getApiOperation("authVerifyV2")
] as const;

const registerAuthChallengeRoute = (
  app: FastifyInstance,
  services: AppServices,
  operation: ApiOperationDefinition
) => {
  app.post(toServerRoutePath(operation.pathTemplate), async (request) => {
    const body = parseOperationBody<{ address: string }>(operation, request);
    if (!isAddress(body.address)) {
      throw new HttpError(400, "invalid address");
    }
    const nonce = nanoid(12);
    const message = `Agentrade SIWE\nAddress: ${body.address}\nNonce: ${nonce}\nIssuedAt: ${new Date().toISOString()}`;
    services.challenges.set(body.address.toLowerCase(), {
      address: body.address as Address,
      nonce,
      message,
      createdAt: Date.now()
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
  operation: ApiOperationDefinition
) => {
  app.post(toServerRoutePath(operation.pathTemplate), async (request) => {
    const body = parseOperationBody<{
      address: string;
      nonce: string;
      message: string;
      signature: string;
    }>(operation, request);
    if (!isAddress(body.address)) {
      throw new HttpError(400, "invalid address");
    }
    const challenge = services.challenges.get(body.address.toLowerCase());
    if (!challenge) {
      throw new HttpError(401, "challenge not found");
    }
    const challengeTtlMs = Math.max(0, services.config.authChallengeTtlMinutes * 60_000);
    if (Date.now() - challenge.createdAt >= challengeTtlMs) {
      services.challenges.delete(body.address.toLowerCase());
      throw new HttpError(401, "challenge expired");
    }
    if (challenge.nonce !== body.nonce || challenge.message !== body.message) {
      throw new HttpError(401, "challenge mismatch");
    }
    const valid = await verifyMessage({
      address: body.address as Address,
      message: body.message,
      signature: body.signature as `0x${string}`
    }).catch(() => false);
    if (!valid) {
      throw new HttpError(401, "invalid signature");
    }
    const token = jwt.sign({ sub: body.address }, services.config.jwtSecret, { expiresIn: "15m" });
    services.challenges.delete(body.address.toLowerCase());
    return validateOperationResponse(operation, {
      token,
      expiresIn: "15m"
    });
  });
};

export const registerAuthRoutes = (app: FastifyInstance, services: AppServices): void => {
  for (const operation of authChallengeOperations) {
    registerAuthChallengeRoute(app, services, operation);
  }
  for (const operation of authVerifyOperations) {
    registerAuthVerifyRoute(app, services, operation);
  }
};
