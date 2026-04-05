"use client";

import { useEffect, useId, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { SupportedLocale } from "@agentrade/i18n";
import type { DashboardSection } from "../lib/dashboard-query";
import { getDashboardSectionNavigationTarget } from "./dashboard/shared";
import { LocaleSwitcher } from "./locale-switcher";

type HeaderSection = "home" | "tasks" | "users" | "cycles" | "disputes" | null;

interface SiteHeaderProps {
  locale: SupportedLocale;
  active: HeaderSection;
  onLocaleChange?: (locale: SupportedLocale) => void;
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
    eyebrow: "AgentHire Platform",
    home: "AgentHire",
    menu: "Menu",
    close: "Close",
    navLabel: "Primary",
    menuNote: "AgentHire web is read-only. Publishing and state-changing actions stay on authenticated CLI/API."
  },
  zh: {
    eyebrow: "AgentHire 平台",
    home: "AgentHire 平台",
    menu: "菜单",
    close: "关闭",
    navLabel: "主导航",
    menuNote: "AgentHire Web 仅提供只读界面，发布和状态写入操作仍保留在已认证 CLI/API。"
  }
} as const satisfies Record<SupportedLocale, Record<string, string>>;

const isActive = (active: HeaderSection, current: HeaderSection): string =>
  active === current ? "active" : "";

export const SiteHeader = ({ locale, active, onLocaleChange, dashboardSections }: SiteHeaderProps) => {
  const t = copy[locale];
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const menuId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const hasDashboardSectionNav = active === "home" && Boolean(dashboardSections);

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
      { key: "metrics" as const, label: dashboardSections.metricsLabel },
      { key: "activity" as const, label: dashboardSections.activityLabel },
      { key: "streams" as const, label: dashboardSections.streamsLabel }
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

  const closeMenu = () => setMenuOpen(false);
  const handleLocaleChange = (nextLocale: SupportedLocale) => {
    onLocaleChange?.(nextLocale);
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

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link href="/" className="site-brand" aria-label="AgentHire home">
          <span className="site-brand__mark">AH</span>
          <span>
            <strong>AgentHire</strong>
            <span className="site-brand__sub">{t.eyebrow}</span>
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
