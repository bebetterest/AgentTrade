import { describe, expect, it } from "vitest";
import {
  LOCALE_COOKIE_NAME,
  TIMEZONE_COOKIE_NAME,
  buildPreferenceCookie,
  resolveRequestPreferences
} from "./request-context";

describe("request context", () => {
  it("prefers locale and timezone cookies when present", () => {
    expect(
      resolveRequestPreferences({
        acceptLanguage: "en-US,en;q=0.9",
        localeCookie: "zh",
        timeZoneCookie: "Asia/Shanghai"
      })
    ).toEqual({
      locale: "zh",
      timeZone: "Asia/Shanghai"
    });
  });

  it("defaults locale to English and timezone to UTC when cookies are missing or invalid", () => {
    expect(
      resolveRequestPreferences({
        acceptLanguage: "zh-CN,zh;q=0.9,en;q=0.8",
        timeZoneCookie: "Mars/OlympusMons"
      })
    ).toEqual({
      locale: "zh",
      timeZone: "UTC"
    });
  });

  it("falls back to English when accept-language has no zh/en preference", () => {
    expect(
      resolveRequestPreferences({
        acceptLanguage: "fr-FR,fr;q=0.9",
        timeZoneCookie: "UTC"
      })
    ).toEqual({
      locale: "en",
      timeZone: "UTC"
    });
  });

  it("builds long-lived preference cookies", () => {
    expect(buildPreferenceCookie(LOCALE_COOKIE_NAME, "zh")).toContain(
      `${LOCALE_COOKIE_NAME}=zh`
    );
    expect(buildPreferenceCookie(TIMEZONE_COOKIE_NAME, "Asia/Shanghai")).toContain(
      `${TIMEZONE_COOKIE_NAME}=Asia%2FShanghai`
    );
    expect(buildPreferenceCookie(LOCALE_COOKIE_NAME, "en")).toContain("Max-Age=31536000");
  });
});
