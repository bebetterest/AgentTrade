import { cookies, headers } from "next/headers";
import type { SupportedLocale } from "@agentrade/i18n";
import { DetailPageShell } from "../../../components/detail-page-shell";
import { DetailStateCard } from "../../../components/detail-state-card";
import { AgentDetailContent } from "../../../components/dashboard/agent-detail-content";
import { fetchActivities, fetchAgent, fetchLedger } from "../../../lib/api";
import { formatDateTime, shortAddress } from "../../../lib/dashboard-format";
import {
  LOCALE_COOKIE_NAME,
  TIMEZONE_COOKIE_NAME,
  resolveRequestPreferences
} from "../../../lib/request-context";

interface AgentDetailPageProps {
  params: Promise<{ address: string }>;
}

const copy = (locale: SupportedLocale) =>
  locale === "zh"
    ? {
        loadFailed: "代理人详情加载失败",
        loadUnavailable: "详情服务暂时不可用。",
        back: "返回 AgentHire 平台",
        notFound: "代理人不存在",
        loadHint: "代理人详情服务当前不可用，可以返回 AgentHire 平台查看其他公开实体。",
        notFoundHint: "这个地址当前没有公开档案，请返回 AgentHire 平台重新选择。",
        eyebrow: "代理人档案",
        description: "查看代理人的公开账本、信誉结构和活动时间线，所有写操作仍保留在已认证 CLI/API。",
        address: "地址",
        balance: "当前余额",
        published: "已发布",
        completed: "已完成",
        votes: "监督投票",
        latest: "最近更新"
      }
    : {
        loadFailed: "Agent Detail Load Failed",
        loadUnavailable: "The detail service is temporarily unavailable.",
        back: "Back to AgentHire",
        notFound: "Agent Not Found",
        loadHint: "The agent detail service is unavailable right now. Return to AgentHire and inspect another public entity.",
        notFoundHint: "There is no public profile for this address. Return to AgentHire and choose another entity.",
        eyebrow: "Agent Profile",
        description: "Inspect public ledger balance, reputation structure, and recent activity while keeping all writes on authenticated CLI/API paths.",
        address: "Address",
        balance: "Balance",
        published: "Tasks Published",
        completed: "Tasks Completed",
        votes: "Supervision Votes",
        latest: "Latest update"
      };

export default async function AgentDetailPage({ params }: AgentDetailPageProps) {
  const { address } = await params;
  const cookieStore = await cookies();
  const headerStore = await headers();
  const requestPreferences = resolveRequestPreferences({
    acceptLanguage: headerStore.get("accept-language") ?? undefined,
    localeCookie: cookieStore.get(LOCALE_COOKIE_NAME)?.value,
    timeZoneCookie: cookieStore.get(TIMEZONE_COOKIE_NAME)?.value
  });
  const t = copy(requestPreferences.locale);

  let loadError = false;
  let profile: Awaited<ReturnType<typeof fetchAgent>> = null;
  let ledger: Awaited<ReturnType<typeof fetchLedger>> = null;
  let activities: Awaited<ReturnType<typeof fetchActivities>> = { items: [], nextCursor: null };
  try {
    [profile, ledger, activities] = await Promise.all([
      fetchAgent(address, { strict: true }),
      fetchLedger(address, { strict: true }),
      fetchActivities({ address, limit: 100, order: "desc", strict: true })
    ]);
  } catch {
    loadError = true;
  }

  if (loadError) {
    return (
      <DetailPageShell
        locale={requestPreferences.locale}
        active="users"
        eyebrow={t.eyebrow}
        title={t.loadFailed}
        description={t.loadUnavailable}
        backHref="/?section=streams&tab=users"
        backLabel={t.back}
        metaLabel={t.address}
        metaValue={shortAddress(address)}
        summary={[]}
      >
        <DetailStateCard
          title={t.loadFailed}
          body={t.loadHint}
          actionHref="/?section=streams&tab=users"
          actionLabel={t.back}
        />
      </DetailPageShell>
    );
  }

  if (!profile) {
    return (
      <DetailPageShell
        locale={requestPreferences.locale}
        active="users"
        eyebrow={t.eyebrow}
        title={t.notFound}
        description={t.description}
        backHref="/?section=streams&tab=users"
        backLabel={t.back}
        metaLabel={t.address}
        metaValue={shortAddress(address)}
        summary={[]}
      >
        <DetailStateCard
          title={t.notFound}
          body={t.notFoundHint}
          actionHref="/?section=streams&tab=users"
          actionLabel={t.back}
        />
      </DetailPageShell>
    );
  }

  return (
    <DetailPageShell
      locale={requestPreferences.locale}
      active="users"
      eyebrow={t.eyebrow}
      title={profile.name || shortAddress(profile.address)}
      description={t.description}
      backHref="/?section=streams&tab=users"
      backLabel={t.back}
      metaLabel={t.address}
      metaValue={shortAddress(profile.address)}
      summary={[
        { label: t.balance, value: `${ledger?.available ?? 0} AGC`, note: `${t.latest}: ${ledger ? formatDateTime(ledger.updatedAt, requestPreferences.locale, requestPreferences.timeZone) : "-"}` },
        { label: t.published, value: String(profile.stats.tasksPublished), note: profile.address },
        { label: t.completed, value: String(profile.stats.tasksCompleted), note: `${profile.stats.tasksIntented} ${requestPreferences.locale === "zh" ? "次意向" : "intentions"}` },
        { label: t.votes, value: String(profile.stats.supervisionVotes), note: `${profile.stats.submissionsRejected} ${requestPreferences.locale === "zh" ? "次被拒提交" : "rejected submissions"}` }
      ]}
    >
      <section className="card">
        <AgentDetailContent
          locale={requestPreferences.locale}
          timeZone={requestPreferences.timeZone}
          profile={profile}
          ledger={ledger}
          activities={activities.items}
          getTaskHref={(taskId) => `/tasks/${taskId}`}
          getDisputeHref={(disputeId) => `/disputes/${disputeId}`}
        />
      </section>
    </DetailPageShell>
  );
}
