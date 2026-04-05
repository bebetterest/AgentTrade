import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskStatus } from "@agentrade/types";
import {
  fetchActivities,
  fetchAgent,
  fetchCycleRewards,
  fetchCycles,
  fetchDashboardSummary,
  fetchDispute,
  fetchEconomyParams,
  fetchHealthStatus,
  fetchLedger,
  fetchTask,
  fetchTaskIntentions,
  fetchTasks
} from "./api";

const ADDRESS_A = "0x1111111111111111111111111111111111111111";

const makeResponse = (status: number, payload: unknown): Response => {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
};

describe("api helpers", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("builds summary query with timezone", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      makeResponse(200, {
        timezone: "Asia/Shanghai",
        generatedAt: "2026-03-31T00:00:00.000Z",
        activeCycleId: "cycle-1",
        today: { tasksPublished: 1, tasksIntented: 1, tasksCompleted: 1, disputesOpened: 0 },
        currentCycle: { tasksPublished: 1, tasksIntented: 1, tasksCompleted: 1, disputesOpened: 0 },
        totals: { tasks: 1, disputes: 0, agents: 1 }
      })
    );

    const result = await fetchDashboardSummary("Asia/Shanghai", { strict: true });

    expect(result?.timezone).toBe("Asia/Shanghai");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/dashboard/summary?tz=Asia%2FShanghai");
  });

  it("returns null for non-strict task fetch failures", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(makeResponse(404, { error: "not found" }));

    const result = await fetchTask("task-not-found");

    expect(result).toBeNull();
  });

  it("throws for strict task fetch failures", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(makeResponse(500, { error: "boom" }));

    await expect(fetchTask("task-a", { strict: true })).rejects.toThrow("Failed request");
  });

  it("returns null for strict task fetch 404", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(makeResponse(404, { error: "not found" }));

    const result = await fetchTask("task-a", { strict: true });

    expect(result).toBeNull();
  });

  it("returns empty intentions page for strict intentions fetch 404", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(makeResponse(404, { error: "not found" }));

    const result = await fetchTaskIntentions({ taskId: "task-a", strict: true });

    expect(result).toEqual({ items: [], nextCursor: null });
  });

  it("throws for strict intentions fetch non-404 failures", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(makeResponse(500, { error: "boom" }));

    await expect(fetchTaskIntentions({ taskId: "task-a", strict: true })).rejects.toThrow("Failed request");
  });

  it("throws for strict agent fetch non-404 failures", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(makeResponse(503, { error: "service unavailable" }));

    await expect(fetchAgent(ADDRESS_A, { strict: true })).rejects.toThrow("Failed request");
  });

  it("falls back to empty page on non-strict task list failure", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValueOnce(new Error("network"));

    const result = await fetchTasks({ status: TaskStatus.OPEN });

    expect(result).toEqual({ items: [], nextCursor: null });
  });

  it("serializes activities query options", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(makeResponse(200, { items: [], nextCursor: null }));

    await fetchActivities({ taskId: "task-1", order: "desc", limit: 50, strict: true });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/activities?");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("taskId=task-1");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("order=desc");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("limit=50");
  });

  it("serializes cycles list query options", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(makeResponse(200, { items: [], nextCursor: null }));

    await fetchCycles({ cursor: "20", limit: 10, strict: true });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/cycles?");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("cursor=20");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("limit=10");
  });

  it("returns cycle rewards with distributions", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      makeResponse(200, {
        cycle: {
          id: "cycle-9",
          status: "OPEN",
          mintedAmount: 1000,
          taxPool: 20,
          penaltyPool: 10,
          startedAt: "2026-03-31T00:00:00.000Z",
          closedAt: null
        },
        rewardPool: 1030,
        distributions: [{ agent: ADDRESS_A, amount: 1030 }],
        workloads: []
      })
    );

    const result = await fetchCycleRewards("cycle-9", { strict: true });

    expect(result?.rewardPool).toBe(1030);
    expect(result?.distributions).toEqual([{ agent: ADDRESS_A, amount: 1030 }]);
  });

  it("returns null for strict dispute fetch 404", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(makeResponse(404, { error: "not found" }));

    const result = await fetchDispute("dispute-missing", { strict: true });

    expect(result).toBeNull();
  });

  it("fetches ledger by address", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      makeResponse(200, {
        address: ADDRESS_A,
        available: 42,
        updatedAt: "2026-03-31T00:00:00.000Z"
      })
    );

    const result = await fetchLedger(ADDRESS_A, { strict: true });

    expect(result?.available).toBe(42);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`/ledger/${ADDRESS_A}`);
  });

  it("fetches health status", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      makeResponse(200, {
        ok: true,
        service: "agentrade-server"
      })
    );

    const result = await fetchHealthStatus({ strict: true });

    expect(result?.ok).toBe(true);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/system/health");
  });

  it("fetches public economy params", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      makeResponse(200, {
        appName: "Agentrade",
        enablePersistence: true,
        enableRedisRateLimit: false,
        authChallengeTtlMinutes: 10,
        rateLimitPerMinute: 60,
        rateLimitBurst: 120,
        taskTitleMaxLength: 120,
        taskDescriptionMaxLength: 4000,
        taskAcceptanceCriteriaMaxLength: 2000,
        taskSubmissionPayloadMaxLength: 5000,
        disputeReasonMaxLength: 2000,
        taskSlotsMax: 5,
        taskRewardPerSlotMax: 500,
        taskDeadlineMaxHours: 72,
        taxRateBps: 500,
        taxMin: 1,
        rewardMin: 1,
        mintPerCycle: 1000,
        terminationPenaltyBps: 2000,
        submissionTimeoutHours: 24,
        resubmitCooldownMinutes: 10,
        disputeQuorum: 3,
        disputeApprovalBps: 6000,
        reputationWeightPublisherBps: 3000,
        reputationWeightWorkerBps: 5000,
        reputationWeightSupervisorBps: 2000,
        bridgeChain: "base-sepolia",
        bridgeMode: "OFFCHAIN_EXPORT_ONLY"
      })
    );

    const result = await fetchEconomyParams({ strict: true });

    expect(result?.mintPerCycle).toBe(1000);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/economy/params");
  });
});
