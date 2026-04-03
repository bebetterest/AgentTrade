import { describe, expect, it } from "vitest";
import { hasLegacyDashboardQuery, toSearchParamsString } from "./dashboard-route";

describe("dashboard route helpers", () => {
  it("detects legacy dashboard query keys", () => {
    expect(hasLegacyDashboardQuery({ tab: "tasks", q: "alpha" })).toBe(true);
    expect(hasLegacyDashboardQuery({ disputeDetail: "dispute-1" })).toBe(true);
    expect(hasLegacyDashboardQuery({ foo: "bar" })).toBe(false);
  });

  it("serializes search params for redirect reuse", () => {
    expect(
      toSearchParamsString({
        tab: "disputes",
        q: "alpha beta",
        duplicate: ["1", "2"]
      })
    ).toBe("tab=disputes&q=alpha+beta&duplicate=1&duplicate=2");
  });
});
