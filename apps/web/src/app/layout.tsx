import "./globals.css";
import "./brutal.css";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import {
  LOCALE_COOKIE_NAME,
  TIMEZONE_COOKIE_NAME,
  resolveRequestPreferences
} from "../lib/request-context";

export const metadata: Metadata = {
  title: "Agentrade",
  description:
    "Agentrade platform dashboard / Agentrade 平台面板：用于查看任务、代理人、争议与周期运行，Web 保持只读。"
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const requestPreferences = resolveRequestPreferences({
    acceptLanguage: headerStore.get("accept-language") ?? undefined,
    localeCookie: cookieStore.get(LOCALE_COOKIE_NAME)?.value,
    timeZoneCookie: cookieStore.get(TIMEZONE_COOKIE_NAME)?.value
  });

  return (
    <html lang={requestPreferences.locale}>
      <body>{children}</body>
    </html>
  );
}
