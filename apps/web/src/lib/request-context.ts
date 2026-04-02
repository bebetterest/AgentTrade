import { resolveLocale, type SupportedLocale } from "@agentrade/i18n";
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
  locale: resolveLocale(acceptLanguage, localeCookie),
  timeZone: isValidTimeZone(timeZoneCookie) ? timeZoneCookie : DEFAULT_TIMEZONE
});
