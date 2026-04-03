import Link from "next/link";
import { cookies, headers } from "next/headers";
import type { SupportedLocale } from "@agentrade/i18n";
import { fetchCycleRewards, fetchDispute } from "../../../lib/api";
import { CycleDetailContent } from "../../../components/dashboard/cycle-detail-content";
import {
  LOCALE_COOKIE_NAME,
  TIMEZONE_COOKIE_NAME,
  resolveRequestPreferences
} from "../../../lib/request-context";

interface CycleDetailPageProps {
  params: Promise<{ id: string }>;
}

const copy = (locale: SupportedLocale) =>
  locale === "zh"
    ? {
        loadFailed: "周期详情加载失败",
        loadUnavailable: "详情服务暂时不可用。",
        back: "返回看板",
        notFound: "周期不存在"
      }
    : {
        loadFailed: "Cycle Detail Load Failed",
        loadUnavailable: "The detail service is temporarily unavailable.",
        back: "Back to dashboard",
        notFound: "Cycle Not Found"
      };

export default async function CycleDetailPage({ params }: CycleDetailPageProps) {
  const { id } = await params;
  const cookieStore = await cookies();
  const headerStore = await headers();
  const requestPreferences = resolveRequestPreferences({
    acceptLanguage: headerStore.get("accept-language") ?? undefined,
    localeCookie: cookieStore.get(LOCALE_COOKIE_NAME)?.value,
    timeZoneCookie: cookieStore.get(TIMEZONE_COOKIE_NAME)?.value
  });
  const t = copy(requestPreferences.locale);

  let loadError = false;
  let rewards: Awaited<ReturnType<typeof fetchCycleRewards>> = null;
  let disputes: Array<NonNullable<Awaited<ReturnType<typeof fetchDispute>>>> = [];
  try {
    rewards = await fetchCycleRewards(id, { strict: true });
    if (rewards) {
      const disputeIds = [...new Set(rewards.workloads.map((item) => item.disputeId).filter(Boolean))];
      const disputeItems = await Promise.all(
        disputeIds.map((disputeId) => fetchDispute(disputeId, { strict: true }))
      );
      disputes = disputeItems.filter((item): item is NonNullable<typeof item> => Boolean(item));
    }
  } catch {
    loadError = true;
  }

  if (loadError) {
    return (
      <main className="page">
        <section className="card">
          <h1>{t.loadFailed}</h1>
          <p className="sub">{t.loadUnavailable}</p>
          <Link href="/?tab=cycles">{t.back}</Link>
        </section>
      </main>
    );
  }

  if (!rewards) {
    return (
      <main className="page">
        <section className="card">
          <h1>{t.notFound}</h1>
          <Link href="/?tab=cycles">{t.back}</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page detail-page">
      <section className="card">
        <div className="card-actions">
          <span className="muted">{rewards.cycle.id}</span>
          <Link href="/?tab=cycles">{t.back}</Link>
        </div>
        <CycleDetailContent
          locale={requestPreferences.locale}
          timeZone={requestPreferences.timeZone}
          rewards={rewards}
          disputes={disputes}
          getAgentHref={(address) => `/agents/${address}`}
        />
      </section>
    </main>
  );
}
