import { Redis } from "ioredis";
import type { AppConfig } from "@agentrade/config";
import type { FastifyBaseLogger } from "fastify";
import { InMemoryRateLimiter, RedisRateLimiter, type RateLimiter } from "../core/rate-limit.js";

export const createRateLimiter = async (
  config: AppConfig,
  logger: FastifyBaseLogger
): Promise<RateLimiter> => {
  if (!config.enableRedisRateLimit) {
    logger.info("redis rate limit disabled; using in-memory limiter");
    return new InMemoryRateLimiter(config.rateLimitPerMinute, config.rateLimitBurst);
  }

  try {
    const redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
    await redis.connect();
    logger.info("redis rate limiter connected");
    return new RedisRateLimiter(redis, config.rateLimitPerMinute, config.rateLimitBurst);
  } catch (error) {
    logger.warn({ error }, "redis unavailable; fallback to in-memory rate limiter");
    return new InMemoryRateLimiter(config.rateLimitPerMinute, config.rateLimitBurst);
  }
};
