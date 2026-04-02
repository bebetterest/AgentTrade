"use client";

import { useEffect, useState } from "react";
import type { SupportedLocale } from "@agentrade/i18n";
import { LOCALE_COOKIE_NAME, buildPreferenceCookie } from "../lib/request-context";

const STORAGE_KEY = LOCALE_COOKIE_NAME;

interface LocaleSwitcherProps {
  initialLocale: SupportedLocale;
  onChange: (locale: SupportedLocale) => void;
}

export const LocaleSwitcher = ({ initialLocale, onChange }: LocaleSwitcherProps) => {
  const [locale, setLocale] = useState<SupportedLocale>(initialLocale);

  useEffect(() => {
    setLocale(initialLocale);
    localStorage.setItem(STORAGE_KEY, initialLocale);
    document.cookie = buildPreferenceCookie(LOCALE_COOKIE_NAME, initialLocale);
    onChange(initialLocale);
  }, [initialLocale, onChange]);

  const setAndPersist = (next: SupportedLocale) => {
    setLocale(next);
    localStorage.setItem(STORAGE_KEY, next);
    document.cookie = buildPreferenceCookie(LOCALE_COOKIE_NAME, next);
    onChange(next);
  };

  return (
    <div className="locale-wrap">
      <button
        type="button"
        aria-label="Switch language to English"
        className={`locale-btn ${locale === "en" ? "active" : ""}`}
        onClick={() => setAndPersist("en")}
      >
        EN
      </button>
      <button
        type="button"
        aria-label="切换语言到中文"
        className={`locale-btn ${locale === "zh" ? "active" : ""}`}
        onClick={() => setAndPersist("zh")}
      >
        中文
      </button>
    </div>
  );
};
