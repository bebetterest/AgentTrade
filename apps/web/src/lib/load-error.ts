import type { SupportedLocale } from "@agentrade/i18n";
import { isApiRequestError } from "./api";

export type LoadErrorKind = "rate_limit" | "unknown";

export const getLoadErrorKind = (error: unknown): LoadErrorKind => {
  if (isApiRequestError(error) && error.status === 429) {
    return "rate_limit";
  }
  return "unknown";
};

export const pickLoadErrorKind = (
  reasons: unknown[]
): LoadErrorKind => (reasons.some((reason) => getLoadErrorKind(reason) === "rate_limit") ? "rate_limit" : "unknown");

export const withRateLimitMessage = (
  locale: SupportedLocale,
  fallback: string,
  errorKind: LoadErrorKind | null
): string => {
  if (errorKind !== "rate_limit") {
    return fallback;
  }
  return locale === "zh"
    ? "请求过于频繁（限流 429），请稍后重试。"
    : "Rate limited (HTTP 429). Please wait a moment and retry.";
};
