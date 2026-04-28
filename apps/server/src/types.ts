import type { AgentradeEngine } from "./domain/engine.js";

declare module "fastify" {
  interface FastifyInstance {
    engine: AgentradeEngine;
    authenticate: (
      request: import("fastify").FastifyRequest,
      reply: import("fastify").FastifyReply
    ) => Promise<void>;
    requireActiveAgent: (
      request: import("fastify").FastifyRequest,
      reply: import("fastify").FastifyReply
    ) => Promise<void>;
    requireAdmin: (
      request: import("fastify").FastifyRequest,
      reply: import("fastify").FastifyReply
    ) => Promise<void>;
  }

  interface FastifyRequest {
    agentAddress?: string;
    serverErrorCode?: string;
  }
}
