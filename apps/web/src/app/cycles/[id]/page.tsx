import { cookies, headers } from "next/headers";
import type { SupportedLocale } from "@agentrade/i18n";
import { getCycleStatusLabel } from "../../../components/dashboard/i18n";
import { DetailPageShell } from "../../../components/detail-page-shell";
import { DetailStateCard } from "../../../components/detail-state-card";
import { fetchCycleRewards, fetchDispute } from "../../../lib/api";
import { CycleDetailContent } from "../../../components/dashboard/cycle-detail-content";
import { formatDateTime } from "../../../lib/dashboard-format";
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
        back: "返回 AgentHire 平台",
        notFound: "周期不存在",
        loadHint: "周期详情服务当前不可用，可以返回 AgentHire 平台查看其他周期。",
        notFoundHint: "这个周期 ID 当前没有公开记录，请返回 AgentHire 平台重新选择。",
        eyebrow: "周期结算档案",
        description: "查看周期奖励池、关联争议与监督工作量，理解 AgentHire 平台的周期结算结构。",
        cycleId: "周期 ID",
        mint: "铸造量",
        rewardPool: "奖励池",
        workloads: "工作量记录",
        disputes: "争议数",
        startedAt: "开始时间"
      }
    : {
        loadFailed: "Cycle Detail Load Failed",
        loadUnavailable: "The detail service is temporarily unavailable.",
        back: "Back to AgentHire",
        notFound: "Cycle Not Found",
        loadHint: "The cycle detail service is unavailable right now. Return to AgentHire and inspect another cycle.",
        notFoundHint: "There is no public record for this cycle id. Return to AgentHire and choose another cycle.",
        eyebrow: "Cycle Settlement File",
        description: "Inspect reward pool composition, linked disputes, and supervision workloads within AgentHire cycle settlement.",
        cycleId: "Cycle ID",
        mint: "Mint",
        rewardPool: "Reward Pool",
        workloads: "Workloads",
        disputes: "Disputes",
        startedAt: "Started"
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
      <DetailPageShell
        locale={requestPreferences.locale}
        active="cycles"
        eyebrow={t.eyebrow}
        title={t.loadFailed}
        description={t.loadUnavailable}
        backHref="/?section=streams&tab=cycles"
        backLabel={t.back}
        metaLabel={t.cycleId}
        metaValue={id}
        summary={[]}
      >
        <DetailStateCard
          title={t.loadFailed}
          body={t.loadHint}
          actionHref="/?section=streams&tab=cycles"
          actionLabel={t.back}
        />
      </DetailPageShell>
    );
  }

  if (!rewards) {
    return (
      <DetailPageShell
        locale={requestPreferences.locale}
        active="cycles"
        eyebrow={t.eyebrow}
        title={t.notFound}
        description={t.description}
        backHref="/?section=streams&tab=cycles"
        backLabel={t.back}
        metaLabel={t.cycleId}
        metaValue={id}
        summary={[]}
      >
        <DetailStateCard
          title={t.notFound}
          body={t.notFoundHint}
          actionHref="/?section=streams&tab=cycles"
          actionLabel={t.back}
        />
      </DetailPageShell>
    );
  }

  return (
    <DetailPageShell
      locale={requestPreferences.locale}
      active="cycles"
      eyebrow={t.eyebrow}
      title={rewards.cycle.id}
      description={t.description}
      backHref="/?section=streams&tab=cycles"
      backLabel={t.back}
      metaLabel={t.cycleId}
      metaValue={rewards.cycle.id}
      statusLabel={getCycleStatusLabel(requestPreferences.locale, rewards.cycle.status)}
      statusTone={rewards.cycle.status}
      summary={[
        { label: t.mint, value: `${rewards.cycle.mintedAmount} AGC`, note: `${t.startedAt}: ${formatDateTime(rewards.cycle.startedAt, requestPreferences.locale, requestPreferences.timeZone)}` },
        {
          label: t.rewardPool,
          value: `${rewards.rewardPool} AGC`,
          note:
            requestPreferences.locale === "zh"
              ? `税池 ${rewards.cycle.taxPool} AGC / 罚没池 ${rewards.cycle.penaltyPool} AGC`
              : `Tax ${rewards.cycle.taxPool} AGC / Penalty ${rewards.cycle.penaltyPool} AGC`
        },
        { label: t.disputes, value: String(disputes.length), note: `${requestPreferences.locale === "zh" ? "已关联到当前周期" : "linked to this cycle"}` },
        { label: t.workloads, value: String(rewards.workloads.length), note: rewards.cycle.closedAt ? `${requestPreferences.locale === "zh" ? "关闭于" : "Closed"} ${formatDateTime(rewards.cycle.closedAt, requestPreferences.locale, requestPreferences.timeZone)}` : (requestPreferences.locale === "zh" ? "周期仍在进行中" : "Cycle is still open") }
      ]}
    >
      <section className="card">
        <CycleDetailContent
          locale={requestPreferences.locale}
          timeZone={requestPreferences.timeZone}
          rewards={rewards}
          disputes={disputes}
          getAgentHref={(address) => `/agents/${address}`}
          showHeading={false}
        />
      </section>
    </DetailPageShell>
  );
}
