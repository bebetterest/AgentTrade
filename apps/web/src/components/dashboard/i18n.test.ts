import { describe, expect, it } from "vitest";
import { CycleStatus, DisputeStatus, TaskStatus } from "@agentrade/types";
import { getAgentStateLabel, getCycleStatusLabel, getDisputeStatusLabel, getTaskStatusLabel } from "./i18n";

describe("dashboard i18n helpers", () => {
  it("returns reader-friendly English status labels", () => {
    expect(getTaskStatusLabel("en", TaskStatus.OPEN)).toBe("Open");
    expect(getTaskStatusLabel("en", TaskStatus.IN_PROGRESS)).toBe("In progress");
    expect(getTaskStatusLabel("en", TaskStatus.CLOSED)).toBe("Closed");
    expect(getTaskStatusLabel("en", TaskStatus.TERMINATED)).toBe("Terminated");

    expect(getCycleStatusLabel("en", CycleStatus.OPEN)).toBe("Open");
    expect(getCycleStatusLabel("en", CycleStatus.CLOSED)).toBe("Closed");

    expect(getAgentStateLabel("en", "ACTIVE")).toBe("Active");
    expect(getAgentStateLabel("en", "IDLE")).toBe("Idle");

    expect(getDisputeStatusLabel("en", DisputeStatus.OPEN)).toBe("Open");
    expect(getDisputeStatusLabel("en", DisputeStatus.RESOLVED_COMPLETED)).toBe("Completed");
    expect(getDisputeStatusLabel("en", DisputeStatus.RESOLVED_NOT_COMPLETED)).toBe("Not completed");
  });

  it("returns mirrored Chinese status labels", () => {
    expect(getTaskStatusLabel("zh", TaskStatus.OPEN)).toBe("开放中");
    expect(getTaskStatusLabel("zh", TaskStatus.IN_PROGRESS)).toBe("进行中");
    expect(getTaskStatusLabel("zh", TaskStatus.CLOSED)).toBe("已关闭");
    expect(getTaskStatusLabel("zh", TaskStatus.TERMINATED)).toBe("已终止");

    expect(getCycleStatusLabel("zh", CycleStatus.OPEN)).toBe("开放中");
    expect(getCycleStatusLabel("zh", CycleStatus.CLOSED)).toBe("已关闭");

    expect(getAgentStateLabel("zh", "ACTIVE")).toBe("活跃");
    expect(getAgentStateLabel("zh", "IDLE")).toBe("空闲");

    expect(getDisputeStatusLabel("zh", DisputeStatus.OPEN)).toBe("开放中");
    expect(getDisputeStatusLabel("zh", DisputeStatus.RESOLVED_COMPLETED)).toBe("已判定完成");
    expect(getDisputeStatusLabel("zh", DisputeStatus.RESOLVED_NOT_COMPLETED)).toBe("已判定未完成");
  });
});
