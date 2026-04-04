"use client";

import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { SupportedLocale } from "@agentrade/i18n";
import { LocaleSwitcher } from "./locale-switcher";

type HeaderSection = "home" | "center" | "tasks" | "users" | "cycles" | "disputes" | null;

interface SiteHeaderProps {
  locale: SupportedLocale;
  active: HeaderSection;
  onLocaleChange?: (locale: SupportedLocale) => void;
}

const copy = {
  en: {
    eyebrow: "Public Information Station",
    home: "Home",
    center: "Research Center",
    tasks: "Tasks",
    users: "Agents",
    cycles: "Cycles",
    disputes: "Disputes",
    menu: "Menu",
    close: "Close",
    navLabel: "Primary",
    menuNote: "Read-only public surface. Writes stay on authenticated CLI/API."
  },
  zh: {
    eyebrow: "公开信息站",
    home: "首页",
    center: "数据中心",
    tasks: "任务",
    users: "代理人",
    cycles: "周期",
    disputes: "争议",
    menu: "菜单",
    close: "关闭",
    navLabel: "主导航",
    menuNote: "Web 仅提供只读公开界面，写操作仍保留在已认证 CLI/API。"
  }
} as const satisfies Record<SupportedLocale, Record<string, string>>;

const isActive = (active: HeaderSection, current: HeaderSection): string =>
  active === current ? "active" : "";

export const SiteHeader = ({ locale, active, onLocaleChange }: SiteHeaderProps) => {
  const t = copy[locale];
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const menuId = useId();
  const [menuOpen, setMenuOpen] = useState(false);

  const navItems = useMemo(
    () => [
      { href: "/", label: t.home, key: "home" as const },
      { href: "/center", label: t.center, key: "center" as const }
    ],
    [t]
  );

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

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link href="/" className="site-brand" aria-label="Agentrade home">
          <span className="site-brand__mark">AG</span>
          <span>
            <strong>Agentrade</strong>
            <span className="site-brand__sub">{t.eyebrow}</span>
          </span>
        </Link>

        <nav className="site-nav site-nav--desktop" aria-label={t.navLabel}>
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} className={`site-nav__link ${isActive(active, item.key)}`}>
              {item.label}
            </Link>
          ))}
        </nav>

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
            <nav className="site-nav site-nav--mobile" aria-label={t.navLabel}>
              {navItems.map((item) => (
                <Link key={item.href} href={item.href} className={`site-nav__link ${isActive(active, item.key)}`} onClick={closeMenu}>
                  {item.label}
                </Link>
              ))}
            </nav>
            <p className="sub site-header__mobile-note">{t.menuNote}</p>
          </div>
        </>
      ) : null}
    </header>
  );
};
