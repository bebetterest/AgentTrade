import { cookies, headers } from "next/headers";
import type { SupportedLocale } from "@agentrade/i18n";
import { DetailPageShell } from "../../../components/detail-page-shell";
import { DetailStateCard } from "../../../components/detail-state-card";
import { AgentDetailContent } from "../../../components/dashboard/agent-detail-content";
import { fetchActivities, fetchAgent, fetchLedger } from "../../../lib/api";
import { formatDateTime, shortAddress } from "../../../lib/dashboard-format";
import { getLoadErrorKind, withRateLimitMessage } from "../../../lib/load-error";
import { logWebLoadError } from "../../../lib/logging";
import {
  LOCALE_COOKIE_NAME,
  TIMEZONE_COOKIE_NAME,
  resolveRequestPreferences
} from "../../../lib/request-context";

interface AgentDetailPageProps {
  params: Promise<{ address: string }>;
}

const DETAIL_LIST_PAGE_SIZE = 20;

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
  let loadErrorKind: ReturnType<typeof getLoadErrorKind> | null = null;
  let profile: Awaited<ReturnType<typeof fetchAgent>> = null;
  let ledger: Awaited<ReturnType<typeof fetchLedger>> = null;
  let activities: Awaited<ReturnType<typeof fetchActivities>> = { items: [], nextCursor: null };
  try {
    profile = await fetchAgent(address, { strict: true });
    if (profile) {
      const [ledgerRes, activitiesRes] = await Promise.allSettled([
        fetchLedger(address, { strict: true }),
        fetchActivities({ address, limit: DETAIL_LIST_PAGE_SIZE, order: "desc", strict: true })
      ]);

      if (ledgerRes.status === "fulfilled") {
        ledger = ledgerRes.value;
      } else {
        logWebLoadError("agent-detail:ledger", ledgerRes.reason, { address });
      }

      if (activitiesRes.status === "fulfilled") {
        activities = activitiesRes.value;
      } else {
        logWebLoadError("agent-detail:activities", activitiesRes.reason, { address });
      }
    }
  } catch (error) {
    logWebLoadError("agent-detail:profile", error, { address });
    loadError = true;
    loadErrorKind = getLoadErrorKind(error);
  }

  if (loadError) {
    const loadHint = withRateLimitMessage(requestPreferences.locale, t.loadHint, loadErrorKind);
    return (
      <DetailPageShell
        locale={requestPreferences.locale}
        active="users"
        eyebrow={t.eyebrow}
        title={t.loadFailed}
        backHref="/?section=streams&tab=users"
        backLabel={t.back}
        metaLabel={t.address}
        metaValue={shortAddress(address)}
        summary={[]}
      >
        <DetailStateCard
          title={t.loadFailed}
          body={loadHint}
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
      backHref="/?section=streams&tab=users"
      backLabel={t.back}
      metaLabel={t.address}
      metaValue={shortAddress(profile.address)}
      summary={[
        {
          label: t.balance,
          value: `${ledger?.available ?? 0} AGC`,
          note: `${t.latest}: ${ledger ? formatDateTime(ledger.updatedAt, requestPreferences.locale, requestPreferences.timeZone) : "-"}`
        },
        {
          label: requestPreferences.locale === "zh" ? "信誉结构" : "Reputation Mix",
          value: `${profile.reputation.publisher}/${profile.reputation.worker}/${profile.reputation.supervisor}`,
          note: requestPreferences.locale === "zh" ? "发布/执行/监督" : "Publisher / Worker / Supervisor"
        },
        {
          label: requestPreferences.locale === "zh" ? "任务产出" : "Delivery",
          value: `${profile.stats.tasksPublished}/${profile.stats.tasksCompleted}`,
          note: `${profile.stats.tasksIntented} ${requestPreferences.locale === "zh" ? "次意向" : "intentions"}`
        },
        {
          label: requestPreferences.locale === "zh" ? "监督活跃" : "Supervision",
          value: String(profile.stats.supervisionVotes),
          note: `${profile.stats.submissionsRejected} ${requestPreferences.locale === "zh" ? "次被拒提交" : "rejected submissions"}`
        }
      ]}
    >
      <section className="card">
        <AgentDetailContent
          locale={requestPreferences.locale}
          timeZone={requestPreferences.timeZone}
          profile={profile}
          ledger={ledger}
          activities={activities.items}
          initialActivitiesCursor={activities.nextCursor}
        />
      </section>
    </DetailPageShell>
  );
}
