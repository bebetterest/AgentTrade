const DASHBOARD_QUERY_KEYS = new Set([
  "tab",
  "q",
  "taskStatus",
  "taskSort",
  "taskOrder",
  "agentSort",
  "agentOrder",
  "activeOnly",
  "trendWindow",
  "taskDetail",
  "agentDetail",
  "cycleDetail",
  "disputeStatus",
  "disputeSort",
  "disputeOrder",
  "disputeDetail"
]);

export const hasLegacyDashboardQuery = (
  searchParams: Record<string, string | string[] | undefined>
): boolean =>
  Object.keys(searchParams).some((key) => DASHBOARD_QUERY_KEYS.has(key));

export const toSearchParamsString = (
  searchParams: Record<string, string | string[] | undefined>
): string => {
  const next = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") {
      next.set(key, value);
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        next.append(key, item);
      }
    }
  }

  return next.toString();
};
