"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { SupportedLocale } from "@agentrade/i18n";
import { LOCALE_COOKIE_NAME, buildPreferenceCookie } from "../lib/request-context";

const STORAGE_KEY = LOCALE_COOKIE_NAME;

interface LocaleSwitcherProps {
  initialLocale: SupportedLocale;
  onChange?: (locale: SupportedLocale) => void;
}

export const LocaleSwitcher = ({ initialLocale, onChange }: LocaleSwitcherProps) => {
  const router = useRouter();
  const [locale, setLocale] = useState<SupportedLocale>(initialLocale);

  useEffect(() => {
    setLocale(initialLocale);
    localStorage.setItem(STORAGE_KEY, initialLocale);
    document.cookie = buildPreferenceCookie(LOCALE_COOKIE_NAME, initialLocale);
    onChange?.(initialLocale);
  }, [initialLocale, onChange]);

  const setAndPersist = (next: SupportedLocale) => {
    setLocale(next);
    localStorage.setItem(STORAGE_KEY, next);
    document.cookie = buildPreferenceCookie(LOCALE_COOKIE_NAME, next);
    if (onChange) {
      onChange(next);
      return;
    }
    router.refresh();
  };

  return (
    <div className="locale-wrap">
      <button
        type="button"
        aria-label={locale === "zh" ? "切换语言到英文" : "Switch language to English"}
        className={`locale-btn ${locale === "en" ? "active" : ""}`}
        onClick={() => setAndPersist("en")}
      >
        EN
      </button>
      <button
        type="button"
        aria-label={locale === "zh" ? "切换语言到中文" : "Switch language to Chinese"}
        className={`locale-btn ${locale === "zh" ? "active" : ""}`}
        onClick={() => setAndPersist("zh")}
      >
        中文
      </button>
    </div>
  );
};
