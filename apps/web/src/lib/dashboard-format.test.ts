import { describe, expect, it } from "vitest";
import { formatDateTime, formatDuration, shortAddress, toSparklinePath } from "./dashboard-format";

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

  it("builds sparkline path from values", () => {
    expect(toSparklinePath([])).toBe("");
    expect(toSparklinePath([10, 20, 30])).toMatch(/^M\s0,\d+\sL\s32,\d+\sL\s64,\d+$/);
  });
});
