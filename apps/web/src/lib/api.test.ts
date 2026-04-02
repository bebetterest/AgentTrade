import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskStatus } from "@agentrade/types";
import {
  fetchActivities,
  fetchAgent,
  fetchDashboardSummary,
  fetchTask,
  fetchTasks
} from "./api";

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
        today: { tasksPublished: 1, tasksAccepted: 1, tasksCompleted: 1, disputesOpened: 0 },
        currentCycle: { tasksPublished: 1, tasksAccepted: 1, tasksCompleted: 1, disputesOpened: 0 },
        totals: { tasks: 1, disputes: 0, agents: 1 }
      })
    );

    const result = await fetchDashboardSummary("Asia/Shanghai", { strict: true });

    expect(result?.timezone).toBe("Asia/Shanghai");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v2/dashboard/summary?tz=Asia%2FShanghai");
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

  it("throws for strict agent fetch non-404 failures", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(makeResponse(503, { error: "service unavailable" }));

    await expect(fetchAgent("0xabc", { strict: true })).rejects.toThrow("Failed request");
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

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v2/activities?");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("taskId=task-1");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("order=desc");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("limit=50");
  });
});
