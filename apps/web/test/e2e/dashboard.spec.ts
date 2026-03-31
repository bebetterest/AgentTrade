import { expect, type Page, test } from "playwright/test";
import { ActivityEventType, DisputeStatus, TaskStatus, type ActivityEvent, type AgentDirectoryItem, type AgentProfile, type Dispute, type Task } from "@agentrade/types";

const ISO_NOW = "2026-03-31T12:00:00.000Z";

const tasks: Task[] = [
  {
    id: "task-alpha",
    publisher: "0x1111111111111111111111111111111111111111",
    title: "Alpha Content Review",
    descriptionMd: "Review alpha artifacts.",
    acceptanceCriteria: "Clear summary with actions.",
    status: TaskStatus.OPEN,
    deadlineUtc: "2026-04-01T12:00:00.000Z",
    displayTimezone: "UTC",
    slotsTotal: 2,
    rewardPerSlot: 20,
    allowRepeatCompletionsBySameAgent: false,
    taxAmount: 2,
    rewardEscrowRemaining: 40,
    acceptedAgents: [],
    completedAgents: [],
    createdAt: "2026-03-29T08:00:00.000Z",
    updatedAt: "2026-03-31T10:00:00.000Z"
  },
  {
    id: "task-beta",
    publisher: "0x2222222222222222222222222222222222222222",
    title: "Beta Dataset Labeling",
    descriptionMd: "Label beta dataset.",
    acceptanceCriteria: ">= 95% quality score.",
    status: TaskStatus.IN_PROGRESS,
    deadlineUtc: "2026-04-02T12:00:00.000Z",
    displayTimezone: "UTC",
    slotsTotal: 3,
    rewardPerSlot: 50,
    allowRepeatCompletionsBySameAgent: false,
    taxAmount: 5,
    rewardEscrowRemaining: 100,
    acceptedAgents: ["0x3333333333333333333333333333333333333333"],
    completedAgents: [],
    createdAt: "2026-03-30T09:00:00.000Z",
    updatedAt: "2026-03-31T11:00:00.000Z"
  },
  {
    id: "task-gamma",
    publisher: "0x1111111111111111111111111111111111111111",
    title: "Gamma Summary Draft",
    descriptionMd: "Draft gamma summary.",
    acceptanceCriteria: "At least 1200 words.",
    status: TaskStatus.CLOSED,
    deadlineUtc: "2026-03-30T12:00:00.000Z",
    displayTimezone: "UTC",
    slotsTotal: 1,
    rewardPerSlot: 35,
    allowRepeatCompletionsBySameAgent: false,
    taxAmount: 3,
    rewardEscrowRemaining: 0,
    acceptedAgents: ["0x4444444444444444444444444444444444444444"],
    completedAgents: ["0x4444444444444444444444444444444444444444"],
    createdAt: "2026-03-28T09:00:00.000Z",
    updatedAt: "2026-03-31T09:00:00.000Z"
  }
];

const agentProfiles: AgentProfile[] = [
  {
    address: "0x3333333333333333333333333333333333333333",
    name: "Agent One",
    bio: "Focus on data quality.",
    reputation: { publisher: 1.2, worker: 1.6, supervisor: 1.1 },
    stats: {
      tasksPublished: 1,
      tasksAccepted: 3,
      tasksCompleted: 2,
      tasksTerminated: 0,
      submissionsRejected: 0,
      supervisionVotes: 1
    },
    createdAt: "2026-03-20T00:00:00.000Z",
    updatedAt: "2026-03-31T11:00:00.000Z"
  },
  {
    address: "0x4444444444444444444444444444444444444444",
    name: "Agent Two",
    bio: "Strong closing rate.",
    reputation: { publisher: 1.4, worker: 2.2, supervisor: 1.3 },
    stats: {
      tasksPublished: 2,
      tasksAccepted: 4,
      tasksCompleted: 4,
      tasksTerminated: 0,
      submissionsRejected: 0,
      supervisionVotes: 2
    },
    createdAt: "2026-03-19T00:00:00.000Z",
    updatedAt: "2026-03-31T11:30:00.000Z"
  },
  {
    address: "0x5555555555555555555555555555555555555555",
    name: "Agent Three",
    bio: "Occasional contributor.",
    reputation: { publisher: 1, worker: 1.1, supervisor: 1 },
    stats: {
      tasksPublished: 0,
      tasksAccepted: 1,
      tasksCompleted: 0,
      tasksTerminated: 1,
      submissionsRejected: 1,
      supervisionVotes: 0
    },
    createdAt: "2026-03-18T00:00:00.000Z",
    updatedAt: "2026-03-29T11:30:00.000Z"
  }
];

const agents: AgentDirectoryItem[] = [
  {
    ...agentProfiles[0],
    latestActivityAt: "2026-03-31T10:50:00.000Z",
    score: 58,
    isActive: true
  },
  {
    ...agentProfiles[1],
    latestActivityAt: "2026-03-31T11:10:00.000Z",
    score: 92,
    isActive: true
  },
  {
    ...agentProfiles[2],
    latestActivityAt: "2026-03-28T10:00:00.000Z",
    score: 21,
    isActive: false
  }
];

const disputes: Dispute[] = [
  {
    id: "dispute-1",
    taskId: "task-beta",
    submissionId: "submission-1",
    opener: "0x2222222222222222222222222222222222222222",
    reasonMd: "Output quality mismatch.",
    status: DisputeStatus.OPEN,
    createdAt: "2026-03-31T11:20:00.000Z",
    updatedAt: "2026-03-31T11:20:00.000Z"
  }
];

const activities: ActivityEvent[] = [
  {
    id: "activity-1",
    type: ActivityEventType.TASK_PUBLISHED,
    cycleId: "cycle-9",
    taskId: "task-alpha",
    disputeId: null,
    actor: "0x1111111111111111111111111111111111111111",
    createdAt: "2026-03-31T10:00:00.000Z"
  },
  {
    id: "activity-2",
    type: ActivityEventType.TASK_ACCEPTED,
    cycleId: "cycle-9",
    taskId: "task-beta",
    disputeId: null,
    actor: "0x3333333333333333333333333333333333333333",
    createdAt: "2026-03-31T10:20:00.000Z"
  },
  {
    id: "activity-3",
    type: ActivityEventType.DISPUTE_OPENED,
    cycleId: "cycle-9",
    taskId: "task-beta",
    disputeId: "dispute-1",
    actor: "0x2222222222222222222222222222222222222222",
    createdAt: "2026-03-31T11:20:00.000Z"
  },
  {
    id: "activity-4",
    type: ActivityEventType.TASK_COMPLETED,
    cycleId: "cycle-9",
    taskId: "task-gamma",
    disputeId: null,
    actor: "0x4444444444444444444444444444444444444444",
    createdAt: "2026-03-31T09:10:00.000Z"
  }
];

const paginate = <T,>(items: T[], cursorRaw: string | null, limitRaw: string | null) => {
  const start = Number(cursorRaw ?? "0");
  const limit = Number(limitRaw ?? "20");
  const sliced = items.slice(start, start + limit);
  const nextCursor = start + limit < items.length ? String(start + limit) : null;
  return { items: sliced, nextCursor };
};

const sortByDate = (left: string, right: string, order: "asc" | "desc") =>
  order === "asc" ? left.localeCompare(right) : right.localeCompare(left);

const installApiMocks = async (page: Page) => {
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === "/v1/dashboard/summary") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          timezone: url.searchParams.get("tz") ?? "UTC",
          generatedAt: ISO_NOW,
          activeCycleId: "cycle-9",
          today: { tasksPublished: 2, tasksAccepted: 1, tasksCompleted: 1, disputesOpened: 1 },
          currentCycle: { tasksPublished: 7, tasksAccepted: 6, tasksCompleted: 5, disputesOpened: 2 },
          totals: { tasks: 3, disputes: 1, agents: 3 }
        })
      });
      return;
    }

    if (path === "/v1/dashboard/trends") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          timezone: url.searchParams.get("tz") ?? "UTC",
          generatedAt: ISO_NOW,
          window: url.searchParams.get("window") === "30d" ? "30d" : "7d",
          points: [
            { bucketStart: "2026-03-29T00:00:00.000Z", label: "03-29", tasksPublished: 1, tasksAccepted: 1, tasksCompleted: 0, disputesOpened: 0 },
            { bucketStart: "2026-03-30T00:00:00.000Z", label: "03-30", tasksPublished: 2, tasksAccepted: 2, tasksCompleted: 1, disputesOpened: 0 },
            { bucketStart: "2026-03-31T00:00:00.000Z", label: "03-31", tasksPublished: 2, tasksAccepted: 1, tasksCompleted: 1, disputesOpened: 1 }
          ]
        })
      });
      return;
    }

    if (path === "/v1/cycles/active") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "cycle-9",
          status: "OPEN",
          mintedAmount: 1000,
          taxPool: 80,
          penaltyPool: 10,
          startedAt: "2026-03-28T00:00:00.000Z",
          closedAt: null
        })
      });
      return;
    }

    if (path === "/v1/tasks") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const status = url.searchParams.get("status");
      const sort = (url.searchParams.get("sort") as "latest" | "created" | "deadline" | "reward" | null) ?? "latest";
      const order = (url.searchParams.get("order") as "asc" | "desc" | null) ?? "desc";
      let filtered = [...tasks];
      if (q) {
        filtered = filtered.filter((item) => item.title.toLowerCase().includes(q) || item.publisher.toLowerCase().includes(q));
      }
      if (status) {
        filtered = filtered.filter((item) => item.status === status);
      }
      filtered.sort((a, b) => {
        if (sort === "reward") {
          return order === "asc" ? a.rewardPerSlot - b.rewardPerSlot : b.rewardPerSlot - a.rewardPerSlot;
        }
        if (sort === "created") {
          return sortByDate(a.createdAt, b.createdAt, order);
        }
        if (sort === "deadline") {
          return sortByDate(a.deadlineUtc, b.deadlineUtc, order);
        }
        return sortByDate(a.updatedAt, b.updatedAt, order);
      });
      const body = paginate(filtered, url.searchParams.get("cursor"), url.searchParams.get("limit"));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body)
      });
      return;
    }

    if (path.startsWith("/v1/tasks/")) {
      const taskId = path.split("/").at(-1) ?? "";
      const task = tasks.find((item) => item.id === taskId);
      await route.fulfill({
        status: task ? 200 : 404,
        contentType: "application/json",
        body: JSON.stringify(task ?? { error: "not found" })
      });
      return;
    }

    if (path === "/v1/agents") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const activeOnly = url.searchParams.get("activeOnly") !== "false";
      const sort = (url.searchParams.get("sort") as "latest" | "score" | "reputation" | "completed" | "published" | "accepted" | null) ?? "latest";
      const order = (url.searchParams.get("order") as "asc" | "desc" | null) ?? "desc";
      let filtered = [...agents];
      if (q) {
        filtered = filtered.filter((item) => item.name.toLowerCase().includes(q) || item.address.toLowerCase().includes(q));
      }
      if (activeOnly) {
        filtered = filtered.filter((item) => item.isActive);
      }
      filtered.sort((a, b) => {
        if (sort === "score") {
          return order === "asc" ? a.score - b.score : b.score - a.score;
        }
        if (sort === "reputation") {
          const left = a.reputation.publisher + a.reputation.worker + a.reputation.supervisor;
          const right = b.reputation.publisher + b.reputation.worker + b.reputation.supervisor;
          return order === "asc" ? left - right : right - left;
        }
        if (sort === "completed") {
          return order === "asc"
            ? a.stats.tasksCompleted - b.stats.tasksCompleted
            : b.stats.tasksCompleted - a.stats.tasksCompleted;
        }
        if (sort === "published") {
          return order === "asc"
            ? a.stats.tasksPublished - b.stats.tasksPublished
            : b.stats.tasksPublished - a.stats.tasksPublished;
        }
        if (sort === "accepted") {
          return order === "asc"
            ? a.stats.tasksAccepted - b.stats.tasksAccepted
            : b.stats.tasksAccepted - a.stats.tasksAccepted;
        }
        const left = a.latestActivityAt ?? "";
        const right = b.latestActivityAt ?? "";
        return sortByDate(left, right, order);
      });
      const body = paginate(filtered, url.searchParams.get("cursor"), url.searchParams.get("limit"));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body)
      });
      return;
    }

    if (path.startsWith("/v1/agents/")) {
      const address = path.split("/").at(-1) ?? "";
      const profile = agentProfiles.find((item) => item.address === address);
      await route.fulfill({
        status: profile ? 200 : 404,
        contentType: "application/json",
        body: JSON.stringify(profile ?? { error: "not found" })
      });
      return;
    }

    if (path === "/v1/disputes") {
      const taskId = url.searchParams.get("taskId");
      const filtered = taskId ? disputes.filter((item) => item.taskId === taskId) : disputes;
      const body = paginate(filtered, url.searchParams.get("cursor"), url.searchParams.get("limit"));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body)
      });
      return;
    }

    if (path === "/v1/activities") {
      const taskId = url.searchParams.get("taskId");
      const address = url.searchParams.get("address");
      const order = (url.searchParams.get("order") as "asc" | "desc" | null) ?? "desc";
      let filtered = [...activities];
      if (taskId) {
        filtered = filtered.filter((item) => item.taskId === taskId);
      }
      if (address) {
        filtered = filtered.filter((item) => item.actor.toLowerCase() === address.toLowerCase());
      }
      filtered.sort((a, b) => sortByDate(a.createdAt, b.createdAt, order));
      const body = paginate(filtered, url.searchParams.get("cursor"), url.searchParams.get("limit"));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body)
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "unhandled route" })
    });
  });
};

test.beforeEach(async ({ page }) => {
  await installApiMocks(page);
});

test("task list supports search/filter/sort and load more", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("task-card")).toHaveCount(2);

  await page.getByTestId("load-more-tasks").click();
  await expect(page.getByTestId("task-card")).toHaveCount(3);

  await page.getByTestId("search-input").fill("alpha");
  await expect(page.getByTestId("task-card")).toHaveCount(1);
  await expect(page.getByText("Alpha Content Review")).toBeVisible();

  await page.getByTestId("task-status-select").selectOption("OPEN");
  await expect(page.getByTestId("task-card")).toHaveCount(1);

  await page.getByTestId("task-sort-select").selectOption("reward");
  await page.getByTestId("sort-order-select").selectOption("desc");

  await page.getByTestId("reset-filters").click();
  await expect(page.getByTestId("task-card")).toHaveCount(2);
});

test("user tab supports sorting and pagination", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("tab-users").click();
  await expect(page.getByTestId("agent-card")).toHaveCount(2);

  await page.getByTestId("agent-sort-select").selectOption("score");
  await page.getByTestId("sort-order-select").selectOption("desc");
  await expect(page.getByTestId("agent-card").first()).toContainText("Agent Two");

  await page.getByTestId("load-more-agents").click();
  await expect(page.getByTestId("agent-card")).toHaveCount(3);
});

test("task and agent detail drawers can be opened", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("task-detail-trigger").first().click();
  await expect(page.getByTestId("detail-drawer")).toBeVisible();
  await expect(page.getByText("Alpha Content Review")).toBeVisible();

  await page.locator(".drawer-mask").click();
  await page.getByTestId("tab-users").click();
  await page.getByTestId("agent-detail-trigger").first().click();
  await expect(page.getByTestId("detail-drawer")).toBeVisible();
});
