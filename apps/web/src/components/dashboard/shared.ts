import { TaskStatus } from "@agentrade/types";
import type { DashboardSection, DashboardTab } from "../../lib/dashboard-query";

export const TASK_STATUS_FILTERS: TaskStatus[] = [
  TaskStatus.OPEN,
  TaskStatus.IN_PROGRESS,
  TaskStatus.CLOSED,
  TaskStatus.TERMINATED
];

export const DASHBOARD_TABS: DashboardTab[] = ["tasks", "users", "cycles", "disputes"];
export const DASHBOARD_SECTIONS: DashboardSection[] = ["overview", "streams", "activity", "metrics"];

export const getDashboardTabNavigationTarget = (
  currentTab: DashboardTab,
  key: string
): DashboardTab | null => {
  const currentIndex = DASHBOARD_TABS.indexOf(currentTab);
  if (currentIndex === -1) {
    return null;
  }

  if (key === "Home") {
    return DASHBOARD_TABS[0];
  }

  if (key === "End") {
    return DASHBOARD_TABS[DASHBOARD_TABS.length - 1];
  }

  if (key === "ArrowRight") {
    return DASHBOARD_TABS[(currentIndex + 1) % DASHBOARD_TABS.length];
  }

  if (key === "ArrowLeft") {
    return DASHBOARD_TABS[(currentIndex - 1 + DASHBOARD_TABS.length) % DASHBOARD_TABS.length];
  }

  return null;
};

export const getDashboardSectionNavigationTarget = (
  currentSection: DashboardSection,
  key: string
): DashboardSection | null => {
  const currentIndex = DASHBOARD_SECTIONS.indexOf(currentSection);
  if (currentIndex === -1) {
    return null;
  }

  if (key === "Home") {
    return DASHBOARD_SECTIONS[0];
  }

  if (key === "End") {
    return DASHBOARD_SECTIONS[DASHBOARD_SECTIONS.length - 1];
  }

  if (key === "ArrowRight") {
    return DASHBOARD_SECTIONS[(currentIndex + 1) % DASHBOARD_SECTIONS.length];
  }

  if (key === "ArrowLeft") {
    return DASHBOARD_SECTIONS[(currentIndex - 1 + DASHBOARD_SECTIONS.length) % DASHBOARD_SECTIONS.length];
  }

  return null;
};

export const buildStateChipClass = (value: string): string => {
  const tone = value
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return tone.length > 0 ? `state-chip state-chip--${tone}` : "state-chip";
};
