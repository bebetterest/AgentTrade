import Link from "next/link";
import { cookies, headers } from "next/headers";
import type { SupportedLocale } from "@agentrade/i18n";
import { fetchActivities, fetchAgent, fetchLedger } from "../../../lib/api";
import { formatDateTime, shortAddress } from "../../../lib/dashboard-format";
import { renderSafeMarkdown } from "../../../lib/markdown";
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
        loadFailed: "Agent 详情加载失败",
        loadUnavailable: "详情服务暂时不可用。",
        back: "返回看板",
        notFound: "Agent 不存在",
        publisherRep: "发布者信誉",
        workerRep: "执行者信誉",
        supervisorRep: "监督者信誉",
        balance: "当前余额",
        updatedAt: "账本更新时间",
        bio: "简介",
        stats: "统计",
        published: "已发布",
        accepted: "已接单",
        completed: "已完成",
        terminated: "已终止",
        rejected: "被拒提交",
        votes: "监督投票",
        timeline: "事件时间线",
        noActivity: "暂无事件"
      }
    : {
        loadFailed: "Agent Detail Load Failed",
        loadUnavailable: "The detail service is temporarily unavailable.",
        back: "Back to dashboard",
        notFound: "Agent Not Found",
        publisherRep: "Publisher Rep",
        workerRep: "Worker Rep",
        supervisorRep: "Supervisor Rep",
        balance: "Balance",
        updatedAt: "Ledger Updated",
        bio: "Bio",
        stats: "Stats",
        published: "Tasks Published",
        accepted: "Tasks Accepted",
        completed: "Tasks Completed",
        terminated: "Tasks Terminated",
        rejected: "Submissions Rejected",
        votes: "Supervision Votes",
        timeline: "Activity Timeline",
        noActivity: "No activity yet"
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
      <main className="page">
        <section className="card">
          <h1>{t.loadFailed}</h1>
          <p className="sub">{t.loadUnavailable}</p>
          <Link href="/?tab=users">{t.back}</Link>
        </section>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="page">
        <section className="card">
          <h1>{t.notFound}</h1>
          <Link href="/?tab=users">{t.back}</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page detail-page">
      <section className="card">
        <div className="card-actions">
          <span className="muted">{shortAddress(profile.address)}</span>
          <Link href="/?tab=users">{t.back}</Link>
        </div>
        <h1>{profile.name || shortAddress(profile.address)}</h1>
        <div className="detail-grid">
          <div className="detail-card">
            <h2>{requestPreferences.locale === "zh" ? "余额与信誉" : "Balance & Reputation"}</h2>
            <div className="metric-line"><span>{t.balance}</span><strong>{ledger?.available ?? 0} AGC</strong></div>
            <div className="metric-line">
              <span>{t.updatedAt}</span>
              <strong>{ledger ? formatDateTime(ledger.updatedAt, requestPreferences.locale, requestPreferences.timeZone) : "-"}</strong>
            </div>
            <div className="metric-line"><span>{t.publisherRep}</span><strong>{profile.reputation.publisher}</strong></div>
            <div className="metric-line"><span>{t.workerRep}</span><strong>{profile.reputation.worker}</strong></div>
            <div className="metric-line"><span>{t.supervisorRep}</span><strong>{profile.reputation.supervisor}</strong></div>
          </div>
          <div className="detail-card">
            <h2>{t.stats}</h2>
            <ul className="detail-list compact-list">
              <li>{t.published}: {profile.stats.tasksPublished}</li>
              <li>{t.accepted}: {profile.stats.tasksAccepted}</li>
              <li>{t.completed}: {profile.stats.tasksCompleted}</li>
              <li>{t.terminated}: {profile.stats.tasksTerminated}</li>
              <li>{t.rejected}: {profile.stats.submissionsRejected}</li>
              <li>{t.votes}: {profile.stats.supervisionVotes}</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="card markdown">
        <h2>{t.bio}</h2>
        {renderSafeMarkdown(profile.bio || "-")}
      </section>

      <section className="card">
        <h2>{t.timeline}</h2>
        {activities.items.length > 0 ? (
          <ul className="detail-list">
            {activities.items.map((item) => (
              <li key={item.id} className="detail-list-row">
                <span>{item.type}</span>
                <strong>{formatDateTime(item.createdAt, requestPreferences.locale, requestPreferences.timeZone)}</strong>
              </li>
            ))}
          </ul>
        ) : (
          <p className="sub">{t.noActivity}</p>
        )}
      </section>
    </main>
  );
}
