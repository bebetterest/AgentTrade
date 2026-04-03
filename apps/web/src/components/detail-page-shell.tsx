import type { ReactNode } from "react";
import Link from "next/link";
import type { SupportedLocale } from "@agentrade/i18n";
import { buildStateChipClass } from "./dashboard/shared";
import { SiteHeader } from "./site-header";

interface DetailSummaryItem {
  label: string;
  value: string;
  note?: string;
}

interface DetailPageShellProps {
  locale: SupportedLocale;
  active: "tasks" | "users" | "cycles" | "disputes";
  eyebrow: string;
  title: string;
  description: string;
  backHref: string;
  backLabel: string;
  metaLabel: string;
  metaValue: string;
  statusLabel?: string;
  statusTone?: string;
  summary: DetailSummaryItem[];
  children?: ReactNode;
}

export const DetailPageShell = ({
  locale,
  active,
  eyebrow,
  title,
  description,
  backHref,
  backLabel,
  metaLabel,
  metaValue,
  statusLabel,
  statusTone,
  summary,
  children
}: DetailPageShellProps) => {
  return (
    <>
      <SiteHeader locale={locale} active={active} />
      <main className="page detail-page">
        <section className="card detail-hero-card">
          <div className="detail-hero">
            <div className="detail-hero__copy">
              <span className="eyebrow">{eyebrow}</span>
              <h1 className="title detail-page__title">{title}</h1>
              <p className="sub detail-hero__body">{description}</p>
              {statusLabel ? (
                <span className={buildStateChipClass(statusTone ?? statusLabel)}>
                  {statusLabel}
                </span>
              ) : null}
            </div>
            <div className="detail-hero__rail">
              <span className="badge">{metaLabel}: {metaValue}</span>
              <Link href={backHref}>{backLabel}</Link>
            </div>
          </div>

          {summary.length > 0 ? (
            <div className="detail-summary-grid">
              {summary.map((item) => (
                <article key={`${item.label}-${item.value}`} className="detail-summary-card">
                  <span className="detail-summary-card__label">{item.label}</span>
                  <strong className="detail-summary-card__value">{item.value}</strong>
                  {item.note ? <span className="detail-summary-card__note">{item.note}</span> : null}
                </article>
              ))}
            </div>
          ) : null}
        </section>

        {children ?? null}
      </main>
    </>
  );
};
