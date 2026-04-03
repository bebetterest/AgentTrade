import { describe, expect, it } from "vitest";
import { InMemoryRateLimiter, applyRateLimit, type RateLimiter } from "../src/core/rate-limit.js";

describe("InMemoryRateLimiter", () => {
  it("respects capacity and blocks once tokens are exhausted", () => {
    const limiter = new InMemoryRateLimiter(60, 0); // capacity = 60
    const now = Date.UTC(2026, 2, 30, 0, 0, 0);

    for (let i = 0; i < 60; i += 1) {
      expect(limiter.check("127.0.0.1", now)).toBe(true);
    }
    expect(limiter.check("127.0.0.1", now)).toBe(false);
  });

  it("uses burst capacity and then refills over time", () => {
    const limiter = new InMemoryRateLimiter(60, 10); // capacity = 70, refill 1/sec
    const start = Date.UTC(2026, 2, 30, 0, 0, 0);

    for (let i = 0; i < 70; i += 1) {
      expect(limiter.check("127.0.0.1", start)).toBe(true);
    }
    expect(limiter.check("127.0.0.1", start)).toBe(false);

    // 3 seconds later, 3 tokens are refilled.
    expect(limiter.check("127.0.0.1", start + 3_000)).toBe(true);
    expect(limiter.check("127.0.0.1", start + 3_000)).toBe(true);
    expect(limiter.check("127.0.0.1", start + 3_000)).toBe(true);
    expect(limiter.check("127.0.0.1", start + 3_000)).toBe(false);
  });
});

describe("applyRateLimit hook", () => {
  it("returns 429 payload when limiter rejects request", async () => {
    const limiter: RateLimiter = {
      check: () => false
    };
    const handler = applyRateLimit(limiter);

    let status = 0;
    let body: unknown;
    const reply = {
      code(nextCode: number) {
        status = nextCode;
        return {
          send(payload: unknown) {
            body = payload;
            return Promise.resolve();
          }
        };
      }
    };

    await handler({ ip: "127.0.0.1", id: "request-1" } as never, reply as never);
    expect(status).toBe(429);
    expect(body).toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "too many requests from this IP",
        details: {
          source: "rate-limit"
        },
        requestId: "request-1",
        retryable: true
      }
    });
  });
});
