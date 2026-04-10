import { cookies, headers } from "next/headers";
import type { SupportedLocale } from "@agentrade/i18n";
import { getCycleStatusLabel } from "../../../components/dashboard/i18n";
import { DetailPageShell } from "../../../components/detail-page-shell";
import { DetailStateCard } from "../../../components/detail-state-card";
import { fetchCycleRewards, fetchDispute, fetchEconomyParams } from "../../../lib/api";
import { CycleDetailContent } from "../../../components/dashboard/cycle-detail-content";
import {
  computeCycleRemainingMs,
  computeExpectedCycleCloseAt,
  formatDateTime,
  formatRemainingDuration
} from "../../../lib/dashboard-format";
import { getLoadErrorKind, withRateLimitMessage } from "../../../lib/load-error";
import { logWebLoadError } from "../../../lib/logging";
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
        back: "返回 Agentrade 平台",
        notFound: "周期不存在",
        loadHint: "周期详情服务当前不可用，可以返回 Agentrade 平台查看其他周期。",
        notFoundHint: "这个周期 ID 当前没有公开记录，请返回 Agentrade 平台重新选择。",
        eyebrow: "周期结算档案",
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
        back: "Back to Agentrade",
        notFound: "Cycle Not Found",
        loadHint: "The cycle detail service is unavailable right now. Return to Agentrade and inspect another cycle.",
        notFoundHint: "There is no public record for this cycle id. Return to Agentrade and choose another cycle.",
        eyebrow: "Cycle Settlement File",
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
  let loadErrorKind: ReturnType<typeof getLoadErrorKind> | null = null;
  let rewards: Awaited<ReturnType<typeof fetchCycleRewards>> = null;
  let economy: Awaited<ReturnType<typeof fetchEconomyParams>> = null;
  let disputes: Array<NonNullable<Awaited<ReturnType<typeof fetchDispute>>>> = [];
  try {
    const [rewardsResult, economyResult] = await Promise.all([
      fetchCycleRewards(id, { strict: true }),
      fetchEconomyParams()
    ]);
    rewards = rewardsResult;
    economy = economyResult;
    if (rewards) {
      const disputeIds = [
        ...new Set(
          rewards.workloads
            .map((item) => item.disputeId)
            .filter((item): item is string => Boolean(item))
        )
      ];
      const disputeResults = await Promise.allSettled(
        disputeIds.map((disputeId) => fetchDispute(disputeId, { strict: true }))
      );
      disputes = disputeResults.flatMap((result, index) => {
        if (result.status === "fulfilled") {
          return result.value ? [result.value] : [];
        }
        logWebLoadError("cycle-detail:dispute", result.reason, {
          cycleId: id,
          disputeId: disputeIds[index] ?? null
        });
        return [];
      });
    }
  } catch (error) {
    logWebLoadError("cycle-detail:rewards", error, { cycleId: id });
    loadError = true;
    loadErrorKind = getLoadErrorKind(error);
  }

  const expectedCloseAt = rewards
    ? computeExpectedCycleCloseAt(rewards.cycle.startedAt, economy?.cycleDurationHours)
    : null;
  const remainingLabel = rewards
    ? formatRemainingDuration(
      computeCycleRemainingMs(rewards.cycle.startedAt, economy?.cycleDurationHours),
      requestPreferences.locale
    )
    : "-";

  if (loadError) {
    const loadHint = withRateLimitMessage(requestPreferences.locale, t.loadHint, loadErrorKind);
    return (
      <DetailPageShell
        locale={requestPreferences.locale}
        active="cycles"
        eyebrow={t.eyebrow}
        title={t.loadFailed}
        backHref="/?section=streams&tab=cycles"
        backLabel={t.back}
        metaLabel={t.cycleId}
        metaValue={id}
        summary={[]}
      >
        <DetailStateCard
          title={t.loadFailed}
          body={loadHint}
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
      backHref="/?section=streams&tab=cycles"
      backLabel={t.back}
      metaLabel={t.cycleId}
      metaValue={rewards.cycle.id}
      statusLabel={getCycleStatusLabel(requestPreferences.locale, rewards.cycle.status)}
      statusTone={rewards.cycle.status}
      summary={[
        {
          label: t.mint,
          value: `${rewards.cycle.mintedAmount} AGC`,
          note: `${t.startedAt}: ${formatDateTime(rewards.cycle.startedAt, requestPreferences.locale, requestPreferences.timeZone)}`
        },
        {
          label: t.rewardPool,
          value: `${rewards.rewardPool} AGC`,
          note:
            requestPreferences.locale === "zh"
              ? `税池 ${rewards.cycle.taxPool} AGC / 罚没池 ${rewards.cycle.penaltyPool} AGC`
              : `Tax ${rewards.cycle.taxPool} AGC / Penalty ${rewards.cycle.penaltyPool} AGC`
        },
        {
          label: t.disputes,
          value: String(disputes.length),
          note: `${requestPreferences.locale === "zh" ? "已关联到当前周期" : "linked to this cycle"}`
        },
        {
          label: t.workloads,
          value: String(rewards.workloads.length),
          note:
            rewards.cycle.closedAt
              ? `${requestPreferences.locale === "zh" ? "关闭于" : "Closed"} ${formatDateTime(rewards.cycle.closedAt, requestPreferences.locale, requestPreferences.timeZone)}`
              : `${
                requestPreferences.locale === "zh" ? "预计关闭于" : "Expected close"
              } ${formatDateTime(expectedCloseAt ?? "", requestPreferences.locale, requestPreferences.timeZone)} · ${
                requestPreferences.locale === "zh" ? "剩余时间" : "Remaining"
              } ${remainingLabel}`
        }
      ]}
    >
      <section className="card">
        <CycleDetailContent
          locale={requestPreferences.locale}
          timeZone={requestPreferences.timeZone}
          rewards={rewards}
          disputes={disputes}
          cycleDurationHours={economy?.cycleDurationHours}
          showHeading={false}
        />
      </section>
    </DetailPageShell>
  );
}
