"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { SupportedLocale } from "@agentrade/i18n";
import type { DashboardSection } from "../lib/dashboard-query";
import { getDashboardSectionNavigationTarget } from "./dashboard/shared";
import { LocaleSwitcher } from "./locale-switcher";

type HeaderSection = "home" | "tasks" | "users" | "cycles" | "disputes" | null;

interface SiteHeaderProps {
  locale: SupportedLocale;
  active: HeaderSection;
  onLocaleChange?: (locale: SupportedLocale) => void;
  backControl?: {
    enabled?: boolean;
    label?: string;
    ariaLabel?: string;
    fallbackHref?: string;
    testId?: string;
  };
  refreshControl?: {
    enabled?: boolean;
    busy?: boolean;
    label?: string;
    busyLabel?: string;
    testId?: string;
    onRefresh?: () => void;
  };
  dashboardSections?: {
    current: DashboardSection;
    navLabel: string;
    overviewLabel: string;
    metricsLabel: string;
    activityLabel: string;
    streamsLabel: string;
    onSectionChange: (section: DashboardSection) => void;
  };
}

const copy = {
  en: {
    eyebrow: "Agentrade Platform",
    home: "Agentrade",
    menu: "Menu",
    close: "Close",
    navLabel: "Primary",
    menuNote: "Agentrade web is read-only. Publishing and state-changing actions stay on authenticated CLI/API.",
    back: "Back",
    refresh: "Refresh",
    refreshing: "Refreshing..."
  },
  zh: {
    eyebrow: "Agentrade 平台",
    home: "Agentrade 平台",
    menu: "菜单",
    close: "关闭",
    navLabel: "主导航",
    menuNote: "Agentrade Web 仅提供只读界面，发布和状态写入操作仍保留在已认证 CLI/API。",
    back: "返回",
    refresh: "刷新",
    refreshing: "刷新中..."
  }
} as const satisfies Record<SupportedLocale, Record<string, string>>;

const isActive = (active: HeaderSection, current: HeaderSection): string =>
  active === current ? "active" : "";

export const SiteHeader = ({
  locale,
  active,
  onLocaleChange,
  backControl,
  refreshControl,
  dashboardSections
}: SiteHeaderProps) => {
  const headerRef = useRef<HTMLElement | null>(null);
  const t = copy[locale];
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const menuId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const hasDashboardSectionNav = active === "home" && Boolean(dashboardSections);
  const backEnabled = backControl?.enabled ?? false;
  const backLabel = backControl?.label ?? t.back;
  const backAriaLabel = backControl?.ariaLabel ?? backLabel;
  const backFallbackHref = backControl?.fallbackHref ?? "/";
  const backTestId = backControl?.testId ?? "header-back-button";
  const refreshEnabled = refreshControl?.enabled ?? true;
  const refreshBusy = refreshControl?.busy ?? false;
  const refreshLabel = refreshControl?.label ?? t.refresh;
  const refreshingLabel = refreshControl?.busyLabel ?? t.refreshing;
  const refreshTestId = refreshControl?.testId ?? "header-refresh-button";

  const navItems = useMemo(
    () => [{ href: "/", label: t.home, key: "home" as const }],
    [t]
  );
  const sectionItems = useMemo(() => {
    if (!dashboardSections) {
      return [];
    }
    return [
      { key: "overview" as const, label: dashboardSections.overviewLabel },
      { key: "streams" as const, label: dashboardSections.streamsLabel },
      { key: "activity" as const, label: dashboardSections.activityLabel },
      { key: "metrics" as const, label: dashboardSections.metricsLabel }
    ];
  }, [dashboardSections]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname, searchParams.toString()]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) {
      return;
    }

    const root = document.documentElement;
    const syncHeaderHeight = () => {
      const nextHeight = Math.ceil(header.getBoundingClientRect().height);
      if (nextHeight > 0) {
        root.style.setProperty("--site-header-height", `${nextHeight}px`);
      }
    };

    syncHeaderHeight();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => syncHeaderHeight());
      resizeObserver.observe(header);
    }

    window.addEventListener("resize", syncHeaderHeight);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", syncHeaderHeight);
    };
  }, [locale, hasDashboardSectionNav, menuOpen]);

  const closeMenu = () => setMenuOpen(false);
  const handleLocaleChange = (nextLocale: SupportedLocale) => {
    if (nextLocale === locale) {
      closeMenu();
      return;
    }
    if (onLocaleChange) {
      onLocaleChange(nextLocale);
    } else {
      router.refresh();
    }
    closeMenu();
  };
  const handleSectionKeyDown = (currentSection: DashboardSection) => (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!dashboardSections) {
      return;
    }
    const targetSection = getDashboardSectionNavigationTarget(currentSection, event.key);
    if (!targetSection || targetSection === currentSection) {
      return;
    }

    event.preventDefault();
    dashboardSections.onSectionChange(targetSection);
    document.getElementById(`section-tab-${targetSection}`)?.focus();
  };
  const onSelectSection = (section: DashboardSection) => {
    dashboardSections?.onSectionChange(section);
    closeMenu();
  };
  const onRefresh = () => {
    if (refreshBusy) {
      return;
    }
    if (refreshControl?.onRefresh) {
      refreshControl.onRefresh();
      return;
    }
    router.refresh();
  };
  const onBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(backFallbackHref);
  };

  return (
    <header ref={headerRef} className="site-header">
      <div className="site-header__inner">
        <Link href="/" className="site-brand" aria-label="Agentrade home">
          <span className="site-brand__mark">AT</span>
          <span>
            <strong>Agentrade</strong>
          </span>
        </Link>

        {hasDashboardSectionNav && dashboardSections ? (
          <nav className="site-nav site-nav--desktop site-nav--sections tabs tabs--top-level" role="tablist" aria-label={dashboardSections.navLabel}>
            {sectionItems.map((item) => (
              <button
                key={item.key}
                id={`section-tab-${item.key}`}
                type="button"
                className={`tab-btn site-nav__section-tab ${dashboardSections.current === item.key ? "active" : ""}`}
                data-testid={`section-tab-${item.key}`}
                role="tab"
                aria-selected={dashboardSections.current === item.key}
                aria-controls={`section-panel-${item.key}`}
                tabIndex={dashboardSections.current === item.key ? 0 : -1}
                onClick={() => onSelectSection(item.key)}
                onKeyDown={handleSectionKeyDown(item.key)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        ) : (
          <nav className="site-nav site-nav--desktop" aria-label={t.navLabel}>
            {navItems.map((item) => (
              <Link key={item.href} href={item.href} className={`site-nav__link ${isActive(active, item.key)}`}>
                {item.label}
              </Link>
            ))}
          </nav>
        )}

        <div className="site-header__actions">
          {backEnabled ? (
            <button
              type="button"
              className="action-btn site-back-btn"
              data-testid={backTestId}
              aria-label={backAriaLabel}
              onClick={onBack}
            >
              <svg viewBox="0 0 24 24" className="site-back-btn__icon" aria-hidden="true" focusable="false">
                <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20z" />
              </svg>
              <span>{backLabel}</span>
            </button>
          ) : null}
          {refreshEnabled ? (
            <button
              type="button"
              className="action-btn site-refresh-btn"
              data-testid={refreshTestId}
              aria-label={refreshBusy ? refreshingLabel : refreshLabel}
              onClick={onRefresh}
              disabled={refreshBusy}
            >
              <svg viewBox="0 0 24 24" className="site-refresh-btn__icon" aria-hidden="true" focusable="false">
                <path d="M17.65 6.35A7.95 7.95 0 0012 4V1L7 6l5 5V7a5 5 0 11-5 5H5a7 7 0 107.75-6.95l.25.3a7.95 7.95 0 014.65 1z" />
              </svg>
              <span>{refreshBusy ? refreshingLabel : refreshLabel}</span>
            </button>
          ) : null}
          <LocaleSwitcher initialLocale={locale} onChange={handleLocaleChange} />
          <button
            type="button"
            className="site-menu-toggle"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onClick={() => setMenuOpen((value) => !value)}
          >
            {menuOpen ? t.close : t.menu}
          </button>
        </div>
      </div>

      {menuOpen ? (
        <>
          <button type="button" className="site-header__backdrop" aria-label={t.close} onClick={closeMenu} />
          <div id={menuId} className="site-header__mobile-panel" role="dialog" aria-modal="true" aria-label={t.navLabel}>
            <div className="site-header__mobile-head">
              <span className="eyebrow">{t.navLabel}</span>
              <button type="button" className="action-btn" onClick={closeMenu}>
                {t.close}
              </button>
            </div>
            {hasDashboardSectionNav && dashboardSections ? (
              <div className="site-nav site-nav--mobile tabs" role="tablist" aria-label={dashboardSections.navLabel}>
                {sectionItems.map((item) => (
                  <button
                    key={item.key}
                    id={`section-tab-mobile-${item.key}`}
                    type="button"
                    className={`tab-btn site-nav__section-tab ${dashboardSections.current === item.key ? "active" : ""}`}
                    role="tab"
                    aria-selected={dashboardSections.current === item.key}
                    aria-controls={`section-panel-${item.key}`}
                    tabIndex={dashboardSections.current === item.key ? 0 : -1}
                    onClick={() => onSelectSection(item.key)}
                    onKeyDown={handleSectionKeyDown(item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : (
              <nav className="site-nav site-nav--mobile" aria-label={t.navLabel}>
                {navItems.map((item) => (
                  <Link key={item.href} href={item.href} className={`site-nav__link ${isActive(active, item.key)}`} onClick={closeMenu}>
                    {item.label}
                  </Link>
                ))}
              </nav>
            )}
            <p className="sub site-header__mobile-note">{t.menuNote}</p>
          </div>
        </>
      ) : null}
    </header>
  );
};
