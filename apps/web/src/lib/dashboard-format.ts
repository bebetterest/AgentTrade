import type { SupportedLocale } from "@agentrade/i18n";

export const DEFAULT_TIMEZONE = "UTC";
export const DEFAULT_CYCLE_DURATION_HOURS = 7 * 24;

export const shortAddress = (value: string): string =>
  value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;

export const formatDateTime = (value: string, locale: SupportedLocale, timeZone?: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString(locale === "zh" ? "zh-CN" : "en-US", { timeZone });
};

export const computeExpectedCycleCloseAt = (
  startedAt: string,
  cycleDurationHours?: number | null
): string | null => {
  const startTs = Date.parse(startedAt);
  if (!Number.isFinite(startTs)) {
    return null;
  }
  const safeDurationHours =
    typeof cycleDurationHours === "number" && Number.isFinite(cycleDurationHours) && cycleDurationHours > 0
      ? Math.trunc(cycleDurationHours)
      : DEFAULT_CYCLE_DURATION_HOURS;
  return new Date(startTs + safeDurationHours * 60 * 60 * 1000).toISOString();
};

export const computeCycleRemainingMs = (
  startedAt: string,
  cycleDurationHours?: number | null,
  nowMs = Date.now()
): number | null => {
  const expectedCloseAt = computeExpectedCycleCloseAt(startedAt, cycleDurationHours);
  if (!expectedCloseAt) {
    return null;
  }
  const expectedCloseTs = Date.parse(expectedCloseAt);
  if (!Number.isFinite(expectedCloseTs) || !Number.isFinite(nowMs)) {
    return null;
  }
  return expectedCloseTs - nowMs;
};

export const formatDuration = (ms: number, locale: SupportedLocale): string => {
  if (!Number.isFinite(ms) || ms <= 0) {
    return locale === "zh" ? "刚刚开始" : "Just started";
  }
  const day = Math.floor(ms / (24 * 60 * 60 * 1000));
  const hour = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minute = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  if (locale === "zh") {
    if (day > 0) {
      return `${day}天 ${hour}小时`;
    }
    if (hour > 0) {
      return `${hour}小时 ${minute}分钟`;
    }
    return `${Math.max(minute, 1)}分钟`;
  }
  if (day > 0) {
    return `${day}d ${hour}h`;
  }
  if (hour > 0) {
    return `${hour}h ${minute}m`;
  }
  return `${Math.max(minute, 1)}m`;
};

export const formatRemainingDuration = (
  remainingMs: number | null,
  locale: SupportedLocale
): string => {
  if (remainingMs === null || !Number.isFinite(remainingMs)) {
    return "-";
  }
  if (remainingMs <= 0) {
    return locale === "zh" ? "已到期" : "Due";
  }
  return formatDuration(remainingMs, locale);
};

const toNumberList = (items: number[]): string =>
  items
    .map((value, index) => `${index === 0 ? "M" : "L"} ${index * 32},${80 - value}`)
    .join(" ");

const valueToPoints = (values: number[]): number[] => {
  if (values.length === 0) {
    return [];
  }
  const max = Math.max(...values, 1);
  return values.map((item) => Math.round((item / max) * 70));
};

export const toSparklinePath = (values: number[]): string => {
  if (values.length === 0) {
    return "";
  }
  return toNumberList(valueToPoints(values));
};
