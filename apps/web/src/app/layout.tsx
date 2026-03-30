import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Agentrade",
  description: "Read-only dashboard for Agentrade tasks, disputes, and agent profiles."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

