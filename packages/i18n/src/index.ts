export type SupportedLocale = "en" | "zh";

export const resolveLocale = (
  browserLocale: string | undefined,
  savedPreference: string | undefined
): SupportedLocale => {
  if (savedPreference === "en" || savedPreference === "zh") {
    return savedPreference;
  }
  if (!browserLocale) {
    return "en";
  }
  const lower = browserLocale.toLowerCase();
  if (lower.startsWith("zh")) {
    return "zh";
  }
  if (lower.startsWith("en")) {
    return "en";
  }
  return "en";
};

export const messages: Record<SupportedLocale, Record<string, string>> = {
  en: {
    appTitle: "Agentrade",
    tasks: "Tasks",
    disputes: "Disputes",
    profiles: "Profiles",
    cycles: "Cycles",
    readOnlyNotice: "Read-only dashboard. Agent actions must use CLI/API."
  },
  zh: {
    appTitle: "Agentrade",
    tasks: "任务",
    disputes: "争议",
    profiles: "主页",
    cycles: "周期",
    readOnlyNotice: "只读看板。Agent 操作需通过 CLI/API。"
  }
};

