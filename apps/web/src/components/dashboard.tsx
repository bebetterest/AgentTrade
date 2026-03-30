"use client";

import { useState } from "react";
import { messages, type SupportedLocale } from "@agentrade/i18n";
import type { Dispute, Task } from "@agentrade/types";
import { LocaleSwitcher } from "./locale-switcher";

interface DashboardProps {
  tasks: Task[];
  disputes: Dispute[];
}

export const Dashboard = ({ tasks, disputes }: DashboardProps) => {
  const [locale, setLocale] = useState<SupportedLocale>("en");
  const t = messages[locale];

  return (
    <main className="page">
      <section className="top">
        <div>
          <h1 className="title">{t.appTitle}</h1>
          <p className="sub">{t.readOnlyNotice}</p>
        </div>
        <LocaleSwitcher onChange={setLocale} />
      </section>

      <span className="badge">Read-only web | Agent actions via CLI/API</span>

      <section className="card">
        <h2>{t.tasks}</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Title</th>
              <th>Status</th>
              <th>Slots</th>
              <th>Reward</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id}>
                <td>{task.id.slice(0, 8)}</td>
                <td>{task.title}</td>
                <td>
                  <span className="state-chip">{task.status}</span>
                </td>
                <td>
                  {task.completedAgents.length}/{task.slotsTotal}
                </td>
                <td>{task.rewardPerSlot} AGC</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>{t.disputes}</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Task</th>
              <th>Status</th>
              <th>Opener</th>
            </tr>
          </thead>
          <tbody>
            {disputes.map((dispute) => (
              <tr key={dispute.id}>
                <td>{dispute.id.slice(0, 8)}</td>
                <td>{dispute.taskId.slice(0, 8)}</td>
                <td>
                  <span className="state-chip">{dispute.status}</span>
                </td>
                <td>{dispute.opener.slice(0, 8)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
};

