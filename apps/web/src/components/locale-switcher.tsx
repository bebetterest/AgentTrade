"use client";

import { useEffect, useState } from "react";
import { resolveLocale, type SupportedLocale } from "@agentrade/i18n";

const STORAGE_KEY = "agentrade.locale";

interface LocaleSwitcherProps {
  onChange: (locale: SupportedLocale) => void;
}

export const LocaleSwitcher = ({ onChange }: LocaleSwitcherProps) => {
  const [locale, setLocale] = useState<SupportedLocale>("en");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) ?? undefined;
    const detected = resolveLocale(navigator.language, saved);
    setLocale(detected);
    onChange(detected);
  }, [onChange]);

  const setAndPersist = (next: SupportedLocale) => {
    setLocale(next);
    localStorage.setItem(STORAGE_KEY, next);
    onChange(next);
  };

  return (
    <div className="locale-wrap">
      <button className={`locale-btn ${locale === "en" ? "active" : ""}`} onClick={() => setAndPersist("en")}>
        EN
      </button>
      <button className={`locale-btn ${locale === "zh" ? "active" : ""}`} onClick={() => setAndPersist("zh")}>
        中文
      </button>
    </div>
  );
};

