import type { SupportedLocale } from "@agentrade/i18n";
import { DEFAULT_TIMEZONE } from "./dashboard-format";

export const LOCALE_COOKIE_NAME = "agentrade.locale";
export const TIMEZONE_COOKIE_NAME = "agentrade.timezone";

interface RequestPreferenceInput {
  acceptLanguage?: string;
  localeCookie?: string;
  timeZoneCookie?: string;
}

export interface RequestPreferences {
  locale: SupportedLocale;
  timeZone: string;
}

const normalizeLocaleToken = (value: string | undefined): SupportedLocale | null => {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "zh" || normalized.startsWith("zh-")) {
    return "zh";
  }
  if (normalized === "en" || normalized.startsWith("en-")) {
    return "en";
  }
  return null;
};

const parseAcceptLanguage = (headerValue: string | undefined): SupportedLocale | null => {
  if (!headerValue) {
    return null;
  }

  const tokens = headerValue
    .split(",")
    .map((entry, index) => {
      const [languageTag, ...params] = entry.trim().split(";");
      if (!languageTag) {
        return null;
      }
      let quality = 1;
      for (const param of params) {
        const trimmed = param.trim();
        const match = /^q=([0-9]+(?:\.[0-9]+)?)$/i.exec(trimmed);
        if (!match) {
          continue;
        }
        const parsed = Number(match[1]);
        if (Number.isFinite(parsed)) {
          quality = parsed;
        }
      }
      return { languageTag, quality, index };
    })
    .filter((item): item is { languageTag: string; quality: number; index: number } => item !== null)
    .sort((left, right) => {
      if (right.quality !== left.quality) {
        return right.quality - left.quality;
      }
      return left.index - right.index;
    });

  for (const token of tokens) {
    const locale = normalizeLocaleToken(token.languageTag);
    if (locale) {
      return locale;
    }
  }
  return null;
};

const resolveWebLocale = (
  localeCookie: string | undefined,
  acceptLanguage: string | undefined
): SupportedLocale => {
  const cookieLocale = normalizeLocaleToken(localeCookie);
  if (cookieLocale) {
    return cookieLocale;
  }
  return parseAcceptLanguage(acceptLanguage) ?? "en";
};

const isValidTimeZone = (value: string | undefined): value is string => {
  if (!value || value.trim().length === 0) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

export const buildPreferenceCookie = (name: string, value: string): string =>
  `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax`;

export const resolveRequestPreferences = ({
  acceptLanguage,
  localeCookie,
  timeZoneCookie
}: RequestPreferenceInput): RequestPreferences => ({
  locale: resolveWebLocale(localeCookie, acceptLanguage),
  timeZone: isValidTimeZone(timeZoneCookie) ? timeZoneCookie : DEFAULT_TIMEZONE
});
