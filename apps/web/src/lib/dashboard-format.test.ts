import { describe, expect, it } from "vitest";
import {
  computeCycleRemainingMs,
  computeExpectedCycleCloseAt,
  formatDateTime,
  formatDuration,
  formatRemainingDuration,
  shortAddress,
  toSparklinePath
} from "./dashboard-format";

describe("dashboard-format helpers", () => {
  it("shortens long addresses", () => {
    expect(shortAddress("0x1111111111111111111111111111111111111111")).toBe("0x1111...1111");
    expect(shortAddress("0x1234")).toBe("0x1234");
  });

  it("formats durations by locale", () => {
    expect(formatDuration(65_000, "en")).toBe("1m");
    expect(formatDuration(65_000, "zh")).toBe("1分钟");
    expect(formatDuration(26 * 60 * 60 * 1000, "en")).toBe("1d 2h");
    expect(formatDuration(26 * 60 * 60 * 1000, "zh")).toBe("1天 2小时");
  });

  it("returns a placeholder for invalid date strings", () => {
    expect(formatDateTime("not-a-date", "en", "UTC")).toBe("-");
  });

  it("computes expected cycle close from start time and duration", () => {
    expect(computeExpectedCycleCloseAt("2026-04-10T00:00:00.000Z", 24)).toBe("2026-04-11T00:00:00.000Z");
    expect(computeExpectedCycleCloseAt("not-a-date", 24)).toBeNull();
    expect(computeExpectedCycleCloseAt("2026-04-10T00:00:00.000Z", 0)).toBe("2026-04-17T00:00:00.000Z");
  });

  it("computes and formats remaining cycle time", () => {
    const remainingMs = computeCycleRemainingMs("2026-04-10T00:00:00.000Z", 24, Date.parse("2026-04-10T12:00:00.000Z"));
    expect(remainingMs).toBe(12 * 60 * 60 * 1000);
    expect(formatRemainingDuration(remainingMs, "en")).toBe("12h 0m");
    expect(formatRemainingDuration(-1, "en")).toBe("Due");
    expect(formatRemainingDuration(-1, "zh")).toBe("已到期");
    expect(formatRemainingDuration(null, "en")).toBe("-");
  });

  it("builds sparkline path from values", () => {
    expect(toSparklinePath([])).toBe("");
    expect(toSparklinePath([10, 20, 30])).toMatch(/^M\s0,\d+\sL\s32,\d+\sL\s64,\d+$/);
  });
});
