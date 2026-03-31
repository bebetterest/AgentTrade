import { describe, expect, it } from "vitest";
import { TaskStatus } from "@agentrade/types";
import { parseDashboardQuery, sanitizeQueryPatch } from "./dashboard-query";

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
        tab: "users",
        q: "  alpha  ",
        taskStatus: TaskStatus.OPEN,
        taskSort: "reward",
        taskOrder: "asc",
        agentSort: "score",
        agentOrder: "asc",
        activeOnly: "false",
        trendWindow: "30d",
        taskDetail: " task-a ",
        agentDetail: " 0xabc "
      })
    );

    expect(query).toEqual({
      tab: "users",
      q: "alpha",
      taskStatus: TaskStatus.OPEN,
      taskSort: "reward",
      taskOrder: "asc",
      agentSort: "score",
      agentOrder: "asc",
      activeOnly: false,
      trendWindow: "30d",
      taskDetailId: "task-a",
      agentDetailAddress: "0xabc"
    });
  });

  it("falls back for invalid values", () => {
    const query = parseDashboardQuery(
      fromObject({
        tab: "invalid",
        q: "   ",
        taskStatus: "bad",
        taskSort: "bad",
        taskOrder: "bad",
        agentSort: "bad",
        agentOrder: "bad",
        activeOnly: "bad",
        trendWindow: "bad",
        taskDetail: "",
        agentDetail: ""
      })
    );

    expect(query).toEqual({
      tab: "tasks",
      q: "",
      taskStatus: null,
      taskSort: "latest",
      taskOrder: "desc",
      agentSort: "latest",
      agentOrder: "desc",
      activeOnly: true,
      trendWindow: "7d",
      taskDetailId: null,
      agentDetailAddress: null
    });
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
        q: "  hello world  ",
        taskDetail: "   task-1 ",
        agentDetail: "\n\t0xabc   "
      })
    ).toEqual({
      q: "hello world",
      taskDetail: "task-1",
      agentDetail: "0xabc"
    });
  });

  it("converts blank fields to null", () => {
    expect(
      sanitizeQueryPatch({
        q: "   ",
        taskDetail: "",
        agentDetail: "\t"
      })
    ).toEqual({
      q: null,
      taskDetail: null,
      agentDetail: null
    });
  });
});
