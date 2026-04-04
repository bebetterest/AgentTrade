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
    "Read-only public information station / 只读公开信息站 with research center access for Agentrade tasks, disputes, cycles, and agent profiles."
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
