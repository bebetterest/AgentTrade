import type { FastifyReply, FastifyRequest } from "fastify";
import type { Redis } from "ioredis";

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface RateLimiter {
  check(ip: string, nowMs: number): boolean | Promise<boolean>;
  close?(): Promise<void>;
}

export class InMemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, Bucket>();
  private readonly refillPerSecond: number;
  private readonly capacity: number;

  constructor(private readonly requestsPerMinute: number, private readonly burst: number) {
    this.refillPerSecond = requestsPerMinute / 60;
    this.capacity = requestsPerMinute + burst;
  }

  check(ip: string, nowMs: number): boolean {
    const bucket = this.buckets.get(ip) ?? { tokens: this.capacity, updatedAt: nowMs };
    const elapsedSeconds = Math.max(0, (nowMs - bucket.updatedAt) / 1_000);
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedSeconds * this.refillPerSecond);
    bucket.updatedAt = nowMs;
    if (bucket.tokens < 1) {
      this.buckets.set(ip, bucket);
      return false;
    }
    bucket.tokens -= 1;
    this.buckets.set(ip, bucket);
    return true;
  }
}

export class RedisRateLimiter implements RateLimiter {
  private readonly capacity: number;
  private readonly keyPrefix = "agentrade:ratelimit";

  constructor(
    private readonly redis: Redis,
    private readonly requestsPerMinute: number,
    private readonly burst: number
  ) {
    this.capacity = requestsPerMinute + burst;
  }

  async check(ip: string, nowMs: number): Promise<boolean> {
    const minuteWindow = Math.floor(nowMs / 60_000);
    const key = `${this.keyPrefix}:${minuteWindow}:${ip}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, 90);
    }
    return count <= this.capacity;
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}

export const applyRateLimit = (
  limiter: RateLimiter
): ((request: FastifyRequest, reply: FastifyReply) => Promise<void>) => {
  return async (request, reply): Promise<void> => {
    const ip = request.ip;
    const allowed = await limiter.check(ip, Date.now());
    if (!allowed) {
      await reply.code(429).send({
        error: "RATE_LIMITED",
        message: "too many requests from this IP"
      });
      return;
    }
  };
};
