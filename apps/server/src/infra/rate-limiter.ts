import { Redis } from "ioredis";
import type { AppConfig } from "@agentrade/config";
import {
  ServerAuditCategory,
  ServerAuditOutcome,
  ServerAuditSeverity
} from "@agentrade/types";
import type { FastifyBaseLogger } from "fastify";
import { InMemoryRateLimiter, RedisRateLimiter, type RateLimiter } from "../core/rate-limit.js";
import type { AuditLogCreateInput } from "../observability/server-logs.js";

export const createRateLimiter = async (
  config: AppConfig,
  logger: FastifyBaseLogger,
  recordAudit?: (input: AuditLogCreateInput) => Promise<unknown>
): Promise<RateLimiter> => {
  if (!config.enableRedisRateLimit) {
    logger.info("redis rate limit disabled; using in-memory limiter");
    await recordAudit?.({
      category: ServerAuditCategory.RUNTIME,
      action: "runtime.rate-limiter",
      severity: ServerAuditSeverity.INFO,
      outcome: ServerAuditOutcome.SUCCESS,
      message: "redis rate limit disabled; using in-memory limiter",
      details: {
        backend: "memory",
        redisEnabled: false
      }
    });
    return new InMemoryRateLimiter(config.rateLimitPerMinute, config.rateLimitBurst);
  }

  try {
    const redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
    await redis.connect();
    logger.info("redis rate limiter connected");
    await recordAudit?.({
      category: ServerAuditCategory.RUNTIME,
      action: "runtime.rate-limiter",
      severity: ServerAuditSeverity.INFO,
      outcome: ServerAuditOutcome.SUCCESS,
      message: "redis rate limiter connected",
      details: {
        backend: "redis",
        redisEnabled: true
      }
    });
    return new RedisRateLimiter(redis, config.rateLimitPerMinute, config.rateLimitBurst);
  } catch (error) {
    logger.warn({ error }, "redis unavailable; fallback to in-memory rate limiter");
    await recordAudit?.({
      category: ServerAuditCategory.RUNTIME,
      action: "runtime.rate-limiter",
      severity: ServerAuditSeverity.WARN,
      outcome: ServerAuditOutcome.FAILURE,
      message: "redis unavailable; fallback to in-memory rate limiter",
      details: {
        backend: "memory",
        redisEnabled: true
      }
    });
    return new InMemoryRateLimiter(config.rateLimitPerMinute, config.rateLimitBurst);
  }
};
