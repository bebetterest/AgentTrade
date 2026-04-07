import { describe, expect, it } from "vitest";
import { ApiRequestError } from "./api";
import { getLoadErrorKind, withRateLimitMessage } from "./load-error";

describe("load-error helpers", () => {
  it("marks 429 api errors as rate_limit", () => {
    const error = new ApiRequestError("/v2/tasks", 429, "Too Many Requests");
    expect(getLoadErrorKind(error)).toBe("rate_limit");
  });

  it("keeps non-429 errors as unknown", () => {
    const error = new ApiRequestError("/v2/tasks", 500, "Internal Server Error");
    expect(getLoadErrorKind(error)).toBe("unknown");
  });

  it("returns localized rate-limit message when kind is rate_limit", () => {
    expect(withRateLimitMessage("zh", "fallback", "rate_limit")).toContain("限流 429");
    expect(withRateLimitMessage("en", "fallback", "rate_limit")).toContain("HTTP 429");
  });

  it("keeps fallback copy for unknown errors", () => {
    expect(withRateLimitMessage("zh", "通用失败", "unknown")).toBe("通用失败");
    expect(withRateLimitMessage("en", "generic failure", null)).toBe("generic failure");
  });
});
