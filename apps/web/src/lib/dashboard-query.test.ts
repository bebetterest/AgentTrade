import { describe, expect, it } from "vitest";
import { DisputeStatus, TaskStatus } from "@agentrade/types";
import { parseDashboardQuery, sanitizeQueryPatch } from "./dashboard-query";
import { getDashboardSectionNavigationTarget, getDashboardTabNavigationTarget } from "../components/dashboard/shared";

const fromObject = (input: Record<string, string>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    search.set(key, value);
  }
  return search;
};

describe("parseDashboardQuery", () => {
  it("parses valid values", () => {
    const query = parseDashboardQuery(
      fromObject({
        section: "activity",
        tab: "users",
        q: "  alpha  ",
        taskStatus: TaskStatus.OPEN,
        taskSort: "reward",
        taskOrder: "asc",
        agentSort: "score",
        agentOrder: "asc",
        disputeStatus: DisputeStatus.OPEN,
        disputeSort: "created",
        disputeOrder: "asc",
        activeOnly: "false",
        trendWindow: "30d",
        taskDetail: " task-a ",
        agentDetail: " 0xabc ",
        cycleDetail: " cycle-9 ",
        disputeDetail: " dispute-1 "
      })
    );

    expect(query).toEqual({
      section: "streams",
      tab: "users",
      q: "alpha",
      taskStatus: TaskStatus.OPEN,
      taskSort: "reward",
      taskOrder: "asc",
      agentSort: "score",
      agentOrder: "asc",
      disputeStatus: DisputeStatus.OPEN,
      disputeSort: "created",
      disputeOrder: "asc",
      activeOnly: false,
      trendWindow: "30d",
      taskDetailId: "task-a",
      agentDetailAddress: "0xabc",
      cycleDetailId: "cycle-9",
      disputeDetailId: "dispute-1"
    });
  });

  it("falls back for invalid values", () => {
    const query = parseDashboardQuery(
      fromObject({
        section: "bad",
        tab: "invalid",
        q: "   ",
        taskStatus: "bad",
        taskSort: "bad",
        taskOrder: "bad",
        agentSort: "bad",
        agentOrder: "bad",
        disputeStatus: "bad",
        disputeSort: "bad",
        disputeOrder: "bad",
        activeOnly: "bad",
        trendWindow: "bad",
        taskDetail: "",
        agentDetail: "",
        cycleDetail: "",
        disputeDetail: ""
      })
    );

    expect(query).toEqual({
      section: "streams",
      tab: "tasks",
      q: "",
      taskStatus: null,
      taskSort: "latest",
      taskOrder: "desc",
      agentSort: "latest",
      agentOrder: "desc",
      disputeStatus: null,
      disputeSort: "latest",
      disputeOrder: "desc",
      activeOnly: true,
      trendWindow: "7d",
      taskDetailId: null,
      agentDetailAddress: null,
      cycleDetailId: null,
      disputeDetailId: null
    });
  });

  it("uses section when stream context is absent", () => {
    const query = parseDashboardQuery(fromObject({ section: "metrics" }));
    expect(query.section).toBe("metrics");
  });

  it("forces streams section when detail query is present", () => {
    const query = parseDashboardQuery(fromObject({ section: "overview", taskDetail: "task-1" }));
    expect(query.section).toBe("streams");
  });

  it("accepts the cycles tab", () => {
    const query = parseDashboardQuery(fromObject({ tab: "cycles" }));
    expect(query.tab).toBe("cycles");
  });

  it("accepts the disputes tab", () => {
    const query = parseDashboardQuery(fromObject({ tab: "disputes" }));
    expect(query.tab).toBe("disputes");
  });

  it("limits search query length", () => {
    const long = "x".repeat(120);
    const query = parseDashboardQuery(fromObject({ q: long }));
    expect(query.q).toHaveLength(80);
  });
});

describe("sanitizeQueryPatch", () => {
  it("normalizes mutable fields", () => {
    expect(
      sanitizeQueryPatch({
        section: "metrics",
        q: "  hello world  ",
        taskDetail: "   task-1 ",
        agentDetail: "\n\t0xabc   ",
        cycleDetail: "\ncycle-9 ",
        disputeDetail: "\ndispute-1 "
      })
    ).toEqual({
      section: "metrics",
      q: "hello world",
      taskDetail: "task-1",
      agentDetail: "0xabc",
      cycleDetail: "cycle-9",
      disputeDetail: "dispute-1"
    });
  });

  it("converts blank fields to null", () => {
    expect(
      sanitizeQueryPatch({
        section: "bad",
        q: "   ",
        taskDetail: "",
        agentDetail: "\t",
        cycleDetail: " ",
        disputeDetail: "\n"
      })
    ).toEqual({
      section: null,
      q: null,
      taskDetail: null,
      agentDetail: null,
      cycleDetail: null,
      disputeDetail: null
    });
  });
});

describe("getDashboardTabNavigationTarget", () => {
  it("moves across tabs with arrow keys and wraps", () => {
    expect(getDashboardTabNavigationTarget("tasks", "ArrowRight")).toBe("users");
    expect(getDashboardTabNavigationTarget("tasks", "ArrowLeft")).toBe("disputes");
    expect(getDashboardTabNavigationTarget("disputes", "ArrowRight")).toBe("tasks");
  });

  it("supports Home and End keys", () => {
    expect(getDashboardTabNavigationTarget("cycles", "Home")).toBe("tasks");
    expect(getDashboardTabNavigationTarget("tasks", "End")).toBe("disputes");
  });

  it("ignores unrelated keys", () => {
    expect(getDashboardTabNavigationTarget("users", "Enter")).toBeNull();
  });
});

describe("getDashboardSectionNavigationTarget", () => {
  it("moves across sections with arrow keys and wraps", () => {
    expect(getDashboardSectionNavigationTarget("overview", "ArrowRight")).toBe("streams");
    expect(getDashboardSectionNavigationTarget("overview", "ArrowLeft")).toBe("metrics");
    expect(getDashboardSectionNavigationTarget("metrics", "ArrowRight")).toBe("overview");
  });

  it("supports Home and End keys", () => {
    expect(getDashboardSectionNavigationTarget("activity", "Home")).toBe("overview");
    expect(getDashboardSectionNavigationTarget("overview", "End")).toBe("metrics");
  });

  it("ignores unrelated keys", () => {
    expect(getDashboardSectionNavigationTarget("metrics", "Enter")).toBeNull();
  });
});
