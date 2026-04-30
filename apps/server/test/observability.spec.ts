import { describe, expect, it } from "vitest";
import { ServerAuditCategory, ServerAuditOutcome } from "@agentrade/types";
import {
  InMemoryServerLogStore,
  sanitizeAuditDetails
} from "../src/observability/server-logs.js";
import { ServiceMetricsCollector } from "../src/observability/metrics.js";

describe("server log observability helpers", () => {
  it("redacts normalized sensitive audit detail keys recursively", () => {
    expect(
      sanitizeAuditDetails({
        "x-admin-service-key": "secret-admin-key",
        walletPrivateKey: "0xabc",
        nested: {
          challengeMessage: "sign me",
          authToken: "token-value",
          safe: "ok"
        }
      })
    ).toEqual({
      "x-admin-service-key": "[REDACTED]",
      walletPrivateKey: "[REDACTED]",
      nested: {
        challengeMessage: "[REDACTED]",
        authToken: "[REDACTED]",
        safe: "ok"
      }
    });
  });

  it("cleans up in-memory request and audit logs by retention window", () => {
    const store = new InMemoryServerLogStore();
    store.appendRequestLog({
      requestId: "req-old",
      method: "GET",
      path: "/v2/tasks",
      routeId: "/v2/tasks",
      statusCode: 200,
      durationMs: 1.25,
      clientIp: "203.0.113.1",
      createdAt: new Date("2026-01-01T00:00:00.000Z")
    });
    store.appendRequestLog({
      requestId: "req-new",
      method: "GET",
      path: "/v2/tasks",
      routeId: "/v2/tasks",
      statusCode: 200,
      durationMs: 2.5,
      clientIp: "203.0.113.2",
      createdAt: new Date("2026-03-01T00:00:00.000Z")
    });
    store.appendAuditLog({
      category: ServerAuditCategory.SECURITY,
      action: "auth.bearer.rejected",
      outcome: ServerAuditOutcome.REJECTED,
      message: "old audit",
      createdAt: new Date("2025-01-01T00:00:00.000Z")
    });
    store.appendAuditLog({
      category: ServerAuditCategory.AUTH,
      action: "auth.verify",
      outcome: ServerAuditOutcome.SUCCESS,
      message: "new audit",
      createdAt: new Date("2026-03-01T00:00:00.000Z")
    });

    const cleanup = store.cleanup(new Date("2026-03-15T00:00:00.000Z"), {
      requestLogRetentionDays: 30,
      auditLogRetentionDays: 180
    });

    expect(cleanup).toEqual({
      deletedRequestLogs: 1,
      deletedAuditLogs: 1
    });
    expect(store.queryRequestLogs({ limit: 20 }).items.map((item) => item.requestId)).toEqual([
      "req-new"
    ]);
    expect(store.queryAuditLogs({ limit: 20 }).items.map((item) => item.action)).toEqual([
      "auth.verify"
    ]);
  });

  it("applies time range filters by actual timestamps and matches methods case-insensitively", () => {
    const store = new InMemoryServerLogStore();
    store.appendRequestLog({
      requestId: "req-1",
      method: "get",
      path: "/v2/tasks",
      routeId: "/v2/tasks",
      statusCode: 200,
      durationMs: 1,
      clientIp: "203.0.113.1",
      createdAt: new Date("2026-03-01T00:30:00.000Z")
    });
    store.appendRequestLog({
      requestId: "req-2",
      method: "POST",
      path: "/v2/tasks",
      routeId: "/v2/tasks",
      statusCode: 201,
      durationMs: 2,
      clientIp: "203.0.113.2",
      createdAt: new Date("2026-03-01T01:30:00.000Z")
    });

    const filtered = store.queryRequestLogs({
      limit: 20,
      from: "2026-03-01T08:00:00+08:00",
      to: "2026-03-01T09:00:00+08:00",
      method: "get"
    });

    expect(filtered.items.map((item) => item.requestId)).toEqual(["req-1"]);
    expect(filtered.items[0]!.method).toBe("GET");
  });

  it("keeps latency metrics bounded with a fixed-size rolling sample", () => {
    const metrics = new ServiceMetricsCollector();
    for (let index = 0; index < 5000; index += 1) {
      metrics.recordRequest({ statusCode: 200, durationMs: index });
    }

    const snapshot = metrics.snapshot();
    expect(snapshot.latencies.requests.count).toBe(4096);
    expect(snapshot.latencies.requests.maxMs).toBe(4999);
  });

  it("keeps exact worker counters when persisted totals exceed safe integers", () => {
    const metrics = new ServiceMetricsCollector();
    const persistedSuccess = BigInt(Number.MAX_SAFE_INTEGER) + 2n;

    metrics.recordWorkerJob("success");
    const snapshot = metrics.snapshot({
      workerJobSuccessTotal: Number.MAX_SAFE_INTEGER,
      workerJobSuccessTotalExact: persistedSuccess.toString()
    });

    expect(snapshot.counters.workerJobSuccessTotal).toBe(Number.MAX_SAFE_INTEGER);
    expect(snapshot.counters.workerJobSuccessTotalExact).toBe((persistedSuccess + 1n).toString());
    expect(snapshot.counters.workerJobErrorTotalExact).toBe("0");
    expect(snapshot.counters.workerJobLockMissTotalExact).toBe("0");
  });
});
