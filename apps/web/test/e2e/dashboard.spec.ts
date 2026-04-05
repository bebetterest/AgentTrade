import { expect, type Page, test } from "@playwright/test";
import { stripApiVersionPrefix } from "@agentrade/contracts";
import { ActivityEventType, CycleStatus, DisputeStatus, TaskStatus, type ActivityEvent, type AgentDirectoryItem, type AgentProfile, type Cycle, type Dispute, type Task } from "@agentrade/types";

const ISO_NOW = "2026-03-31T12:00:00.000Z";
const API_ROUTE_PATTERN = "**/*";

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
    intentCount: 0,
    competitionRatio: 0,
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
    intentCount: 1,
    competitionRatio: 0.3333,
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
    intentCount: 1,
    competitionRatio: 1,
    completedAgents: ["0x4444444444444444444444444444444444444444"],
    createdAt: "2026-03-28T09:00:00.000Z",
    updatedAt: "2026-03-31T09:00:00.000Z"
  }
];

const taskIntentionsByTaskId: Record<string, Array<{ id: string; taskId: string; agent: string; createdAt: string }>> = {
  "task-alpha": [],
  "task-beta": [
    {
      id: "intention-1",
      taskId: "task-beta",
      agent: "0x3333333333333333333333333333333333333333",
      createdAt: "2026-03-31T10:10:00.000Z"
    }
  ],
  "task-gamma": [
    {
      id: "intention-2",
      taskId: "task-gamma",
      agent: "0x4444444444444444444444444444444444444444",
      createdAt: "2026-03-30T09:30:00.000Z"
    }
  ]
};

const agentProfiles: AgentProfile[] = [
  {
    address: "0x3333333333333333333333333333333333333333",
    name: "Agent One",
    bio: "Focus on data quality.",
    reputation: { publisher: 1.2, worker: 1.6, supervisor: 1.1 },
    stats: {
      tasksPublished: 1,
      tasksIntented: 3,
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
      tasksIntented: 4,
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
      tasksIntented: 1,
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

const cycles: Cycle[] = [
  {
    id: "cycle-9",
    status: CycleStatus.OPEN,
    mintedAmount: 1000,
    taxPool: 80,
    penaltyPool: 10,
    startedAt: "2026-03-28T00:00:00.000Z",
    closedAt: null
  },
  {
    id: "cycle-8",
    status: CycleStatus.CLOSED,
    mintedAmount: 980,
    taxPool: 60,
    penaltyPool: 5,
    startedAt: "2026-03-20T00:00:00.000Z",
    closedAt: "2026-03-27T23:59:59.000Z"
  },
  {
    id: "cycle-7",
    status: CycleStatus.CLOSED,
    mintedAmount: 950,
    taxPool: 55,
    penaltyPool: 0,
    startedAt: "2026-03-13T00:00:00.000Z",
    closedAt: "2026-03-19T23:59:59.000Z"
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

const cycleRewardsById = {
  "cycle-9": {
    cycle: cycles[0],
    rewardPool: 1090,
    distributions: [
      { agent: "0x3333333333333333333333333333333333333333", amount: 545 },
      { agent: "0x4444444444444444444444444444444444444444", amount: 545 }
    ],
    workloads: [
      {
        id: "workload-1",
        cycleId: "cycle-9",
        disputeId: "dispute-1",
        agent: "0x3333333333333333333333333333333333333333",
        workload: 1,
        createdAt: "2026-03-31T11:21:00.000Z",
        settledAt: null
      },
      {
        id: "workload-2",
        cycleId: "cycle-9",
        disputeId: "dispute-1",
        agent: "0x4444444444444444444444444444444444444444",
        workload: 1,
        createdAt: "2026-03-31T11:22:00.000Z",
        settledAt: null
      }
    ]
  },
  "cycle-8": {
    cycle: cycles[1],
    rewardPool: 1045,
    distributions: [{ agent: "0x4444444444444444444444444444444444444444", amount: 1045 }],
    workloads: [
      {
        id: "workload-3",
        cycleId: "cycle-8",
        disputeId: "dispute-1",
        agent: "0x4444444444444444444444444444444444444444",
        workload: 2,
        createdAt: "2026-03-26T11:22:00.000Z",
        settledAt: "2026-03-27T23:00:00.000Z"
      }
    ]
  },
  "cycle-7": {
    cycle: cycles[2],
    rewardPool: 1005,
    distributions: [],
    workloads: []
  }
} as const;

const ledgerByAddress: Record<string, { address: string; available: number; updatedAt: string }> = {
  "0x3333333333333333333333333333333333333333": {
    address: "0x3333333333333333333333333333333333333333",
    available: 42,
    updatedAt: ISO_NOW
  },
  "0x4444444444444444444444444444444444444444": {
    address: "0x4444444444444444444444444444444444444444",
    available: 88,
    updatedAt: ISO_NOW
  },
  "0x5555555555555555555555555555555555555555": {
    address: "0x5555555555555555555555555555555555555555",
    available: 9,
    updatedAt: ISO_NOW
  }
};

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
    type: ActivityEventType.TASK_INTENDED,
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

interface InstallApiMocksOptions {
  failActivitiesByTaskIdOnce?: string;
  failActivitiesByAddressOnce?: string;
  failTaskById?: string;
  failAgentByAddress?: string;
  failCycleById?: string;
  failDisputeById?: string;
}

const installApiMocks = async (page: Page, options: InstallApiMocksOptions = {}) => {
  let failedTaskActivity = false;
  let failedAddressActivity = false;
  await page.route(API_ROUTE_PATTERN, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().resourceType() !== "fetch") {
      await route.continue();
      return;
    }
    const path = stripApiVersionPrefix(url.pathname);

    if (path === "/dashboard/summary") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          timezone: url.searchParams.get("tz") ?? "UTC",
          generatedAt: ISO_NOW,
          activeCycleId: "cycle-9",
          today: { tasksPublished: 2, tasksIntented: 1, tasksCompleted: 1, disputesOpened: 1 },
          currentCycle: { tasksPublished: 7, tasksIntented: 6, tasksCompleted: 5, disputesOpened: 2 },
          totals: { tasks: 3, disputes: 1, agents: 3 }
        })
      });
      return;
    }

    if (path === "/dashboard/trends") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          timezone: url.searchParams.get("tz") ?? "UTC",
          generatedAt: ISO_NOW,
          window: url.searchParams.get("window") === "30d" ? "30d" : "7d",
          points: [
            { bucketStart: "2026-03-29T00:00:00.000Z", label: "03-29", tasksPublished: 1, tasksIntented: 1, tasksCompleted: 0, disputesOpened: 0 },
            { bucketStart: "2026-03-30T00:00:00.000Z", label: "03-30", tasksPublished: 2, tasksIntented: 2, tasksCompleted: 1, disputesOpened: 0 },
            { bucketStart: "2026-03-31T00:00:00.000Z", label: "03-31", tasksPublished: 2, tasksIntented: 1, tasksCompleted: 1, disputesOpened: 1 }
          ]
        })
      });
      return;
    }

    if (path === "/system/health") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, service: "agentrade-server" })
      });
      return;
    }

    if (path === "/economy/params") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          appName: "Agentrade",
          enablePersistence: true,
          enableRedisRateLimit: false,
          authChallengeTtlMinutes: 10,
          rateLimitPerMinute: 60,
          rateLimitBurst: 120,
          taskTitleMaxLength: 120,
          taskDescriptionMaxLength: 4000,
          taskAcceptanceCriteriaMaxLength: 2000,
          taskSubmissionPayloadMaxLength: 5000,
          disputeReasonMaxLength: 2000,
          taskSlotsMax: 5,
          taskRewardPerSlotMax: 500,
          taskDeadlineMaxHours: 72,
          taxRateBps: 500,
          taxMin: 1,
          rewardMin: 1,
          mintPerCycle: 1000,
          terminationPenaltyBps: 2000,
          submissionTimeoutHours: 24,
          resubmitCooldownMinutes: 10,
          disputeQuorum: 3,
          disputeApprovalBps: 6000,
          reputationWeightPublisherBps: 3000,
          reputationWeightWorkerBps: 5000,
          reputationWeightSupervisorBps: 2000,
          bridgeChain: "base-sepolia",
          bridgeMode: "OFFCHAIN_EXPORT_ONLY"
        })
      });
      return;
    }

    if (path === "/cycles/active") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(cycles[0])
      });
      return;
    }

    if (path === "/cycles") {
      const sorted = [...cycles].sort((a, b) => sortByDate(a.startedAt, b.startedAt, "desc"));
      const body = paginate(sorted, url.searchParams.get("cursor"), url.searchParams.get("limit") ?? "2");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body)
      });
      return;
    }

    if (path.startsWith("/cycles/") && path.endsWith("/rewards")) {
      const cycleId = path.split("/")[2] ?? "";
      if (options.failCycleById === cycleId) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "forced failure for detail route" })
        });
        return;
      }
      const rewards = cycleRewardsById[cycleId as keyof typeof cycleRewardsById];
      await route.fulfill({
        status: rewards ? 200 : 404,
        contentType: "application/json",
        body: JSON.stringify(rewards ?? { error: "not found" })
      });
      return;
    }

    if (path.startsWith("/cycles/")) {
      const cycleId = path.split("/").at(-1) ?? "";
      const cycle = cycles.find((item) => item.id === cycleId);
      await route.fulfill({
        status: cycle ? 200 : 404,
        contentType: "application/json",
        body: JSON.stringify(cycle ?? { error: "not found" })
      });
      return;
    }

    if (path === "/tasks") {
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
      const body = paginate(filtered, url.searchParams.get("cursor"), "2");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body)
      });
      return;
    }

    if (path.startsWith("/tasks/") && path.endsWith("/intentions")) {
      const taskId = path.split("/")[2] ?? "";
      const intentions = taskIntentionsByTaskId[taskId] ?? [];
      const body = paginate(intentions, url.searchParams.get("cursor"), url.searchParams.get("limit"));
      await route.fulfill({
        status: tasks.some((item) => item.id === taskId) ? 200 : 404,
        contentType: "application/json",
        body: JSON.stringify(tasks.some((item) => item.id === taskId) ? body : { error: "not found" })
      });
      return;
    }

    if (path.startsWith("/tasks/")) {
      const taskId = path.split("/").at(-1) ?? "";
      if (options.failTaskById === taskId) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "forced failure for detail route" })
        });
        return;
      }
      const task = tasks.find((item) => item.id === taskId);
      await route.fulfill({
        status: task ? 200 : 404,
        contentType: "application/json",
        body: JSON.stringify(task ?? { error: "not found" })
      });
      return;
    }

    if (path === "/agents") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const activeOnly = url.searchParams.get("activeOnly") !== "false";
      const sort = (url.searchParams.get("sort") as "latest" | "score" | "reputation" | "completed" | "published" | "intented" | null) ?? "latest";
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
        if (sort === "intented") {
          return order === "asc"
            ? a.stats.tasksIntented - b.stats.tasksIntented
            : b.stats.tasksIntented - a.stats.tasksIntented;
        }
        const left = a.latestActivityAt ?? "";
        const right = b.latestActivityAt ?? "";
        return sortByDate(left, right, order);
      });
      const body = paginate(filtered, url.searchParams.get("cursor"), "2");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body)
      });
      return;
    }

    if (path.startsWith("/agents/")) {
      const address = path.split("/").at(-1) ?? "";
      if (options.failAgentByAddress === address) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "forced failure for detail route" })
        });
        return;
      }
      const profile = agentProfiles.find((item) => item.address === address);
      await route.fulfill({
        status: profile ? 200 : 404,
        contentType: "application/json",
        body: JSON.stringify(profile ?? { error: "not found" })
      });
      return;
    }

    if (path.startsWith("/ledger/")) {
      const address = path.split("/").at(-1) ?? "";
      const ledger = ledgerByAddress[address];
      await route.fulfill({
        status: ledger ? 200 : 404,
        contentType: "application/json",
        body: JSON.stringify(ledger ?? { error: "not found" })
      });
      return;
    }

    if (path === "/disputes") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const taskId = url.searchParams.get("taskId");
      const status = url.searchParams.get("status");
      const sort = (url.searchParams.get("sort") as "latest" | "created" | null) ?? "latest";
      const order = (url.searchParams.get("order") as "asc" | "desc" | null) ?? "desc";
      let filtered = taskId ? disputes.filter((item) => item.taskId === taskId) : [...disputes];
      if (q) {
        filtered = filtered.filter((item) =>
          item.id.toLowerCase().includes(q) ||
          item.taskId.toLowerCase().includes(q) ||
          item.opener.toLowerCase().includes(q)
        );
      }
      if (status) {
        filtered = filtered.filter((item) => item.status === status);
      }
      filtered.sort((a, b) => sortByDate(sort === "created" ? a.createdAt : a.updatedAt, sort === "created" ? b.createdAt : b.updatedAt, order));
      const body = paginate(filtered, url.searchParams.get("cursor"), url.searchParams.get("limit"));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body)
      });
      return;
    }

    if (path.startsWith("/disputes/")) {
      const disputeId = path.split("/").at(-1) ?? "";
      if (options.failDisputeById === disputeId) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "forced failure for detail route" })
        });
        return;
      }
      const dispute = disputes.find((item) => item.id === disputeId);
      await route.fulfill({
        status: dispute ? 200 : 404,
        contentType: "application/json",
        body: JSON.stringify(dispute ?? { error: "not found" })
      });
      return;
    }

    if (path === "/activities") {
      const taskId = url.searchParams.get("taskId");
      const disputeId = url.searchParams.get("disputeId");
      const address = url.searchParams.get("address");
      const order = (url.searchParams.get("order") as "asc" | "desc" | null) ?? "desc";
      if (taskId && options.failActivitiesByTaskIdOnce === taskId && !failedTaskActivity) {
        failedTaskActivity = true;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "forced failure for retry path" })
        });
        return;
      }
      if (address && options.failActivitiesByAddressOnce === address && !failedAddressActivity) {
        failedAddressActivity = true;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "forced failure for retry path" })
        });
        return;
      }
      let filtered = [...activities];
      if (taskId) {
        filtered = filtered.filter((item) => item.taskId === taskId);
      }
      if (disputeId) {
        filtered = filtered.filter((item) => item.disputeId === disputeId);
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

const openStreamsSection = async (page: Page) => {
  await page.getByTestId("section-tab-streams").click();
  await expect(page.getByTestId("tab-tasks")).toBeVisible();
};

const expandAdvancedFilters = async (page: Page) => {
  const toggle = page.getByTestId("toggle-filters");
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
};

test("information hub renders and supports stream shortcuts", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("AgentHire Platform")).toBeVisible();
  await expect(page.getByTestId("section-tab-overview")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Marketplace Entities" })).toHaveCount(0);

  await page.getByRole("button", { name: "Open Marketplace" }).click();
  await expect(page.getByTestId("section-tab-streams")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Marketplace Entities" })).toBeVisible();

  await page.getByTestId("section-tab-overview").click();
  await page.getByRole("button", { name: "View Disputes" }).click();
  await expect(page).toHaveURL(/section=streams/);
  await expect(page).toHaveURL(/tab=disputes/);
  await expandAdvancedFilters(page);
  await expect(page.getByTestId("dispute-status-select")).toBeVisible();
});

test("top-level sections switch and keep module boundaries", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("section-tab-overview")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("flow-diagram")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Marketplace Entities" })).toHaveCount(0);

  await page.getByTestId("section-tab-metrics").click();
  await expect(page.getByTestId("section-tab-metrics")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("API limit")).toBeVisible();
  await expect(page.getByTestId("flow-diagram")).toHaveCount(0);

  await page.getByTestId("section-tab-activity").click();
  await expect(page.getByTestId("section-tab-activity")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Live Activity" })).toBeVisible();

  await page.getByTestId("section-tab-streams").click();
  await expect(page.getByTestId("section-tab-streams")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Marketplace Entities" })).toBeVisible();
});

test("legacy /center route is removed", async ({ page }) => {
  await page.goto("/center");
  await expect(page).toHaveURL(/\/center/);
  await expect(page.getByText("This page could not be found.")).toBeVisible();
});

test("legacy stream links still recover streams state", async ({ page }) => {
  await page.goto("/?tab=tasks#streams");
  await expect(page.getByTestId("section-tab-streams")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("tab-tasks")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("task-card")).toHaveCount(2);
});

test("locale switch persists across hub and direct detail routes", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("AgentHire Platform")).toBeVisible();

  await page.getByRole("button", { name: "Switch language to Chinese" }).click();
  await expect(page.getByText("AgentHire 平台")).toBeVisible();
  await expect(page.getByRole("button", { name: "进入市场" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("agentrade.locale"))).toBe("zh");
  await expect.poll(() => page.evaluate(() => document.cookie)).toContain("agentrade.locale=zh");

  await page.getByRole("button", { name: "查看争议" }).click();
  await expect(page).toHaveURL(/section=streams/);
  await expect(page).toHaveURL(/tab=disputes/);
  await expect(page.getByText("AgentHire 平台")).toBeVisible();
  await expect(page.getByTestId("tab-tasks")).toContainText("任务");
  await expect(page.getByTestId("dispute-card")).toHaveCount(1);

  await page.goto("/tasks/task-beta");
  await expect(page.getByText("任务档案")).toBeVisible();
  await expect(page.getByRole("link", { name: "返回 AgentHire 平台" })).toHaveAttribute("href", "/?section=streams&tab=tasks");
  await expect(page.getByText("进行中")).toBeVisible();

  await page.getByRole("button", { name: "切换语言到英文" }).click();
  await expect(page.getByText("Task Dossier")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to AgentHire" })).toHaveAttribute("href", "/?section=streams&tab=tasks");
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("agentrade.locale"))).toBe("en");
  await expect.poll(() => page.evaluate(() => document.cookie)).toContain("agentrade.locale=en");
});

test("task list supports search/filter/sort and load more", async ({ page }) => {
  await page.goto("/");
  await openStreamsSection(page);
  const taskCards = page.getByTestId("task-card");
  await expect(taskCards).toHaveCount(2);
  await expect(page.getByTestId("task-card").filter({ hasText: "Alpha Content Review" })).toContainText("Open");
  await expect(page.getByTestId("task-card").filter({ hasText: "Beta Dataset Labeling" })).toContainText("In progress");
  await expect(page.locator("body")).not.toContainText("IN_PROGRESS");

  // The page supports both manual "Load more" and auto-loading via intersection.
  // In CI the button can be detached while auto-loading completes, so we retry
  // until either count reaches 3 or a stable click succeeds.
  await expect(async () => {
    if (await taskCards.count() >= 3) {
      return;
    }
    const loadMoreButton = page.getByTestId("load-more-tasks");
    if (await loadMoreButton.count() === 0) {
      throw new Error("load-more button missing before tasks reached expected count");
    }
    await loadMoreButton.click();
  }).toPass({
    timeout: 10_000,
    intervals: [100, 250, 500]
  });
  await expect(taskCards).toHaveCount(3);
  await expect(page.getByTestId("task-card").filter({ hasText: "Gamma Summary Draft" })).toContainText("Closed");

  await page.getByTestId("search-input").fill("alpha");
  await expect(page.getByTestId("task-card")).toHaveCount(1);
  await expect(page.getByText("Alpha Content Review")).toBeVisible();

  await page.getByTestId("clear-search-button").click();
  await expect(page.getByTestId("search-input")).toHaveValue("");
  await expect(page.getByText("Beta Dataset Labeling")).toBeVisible();

  await expandAdvancedFilters(page);
  await page.getByTestId("task-status-select").selectOption("OPEN");
  await expect(page.getByTestId("task-card")).toHaveCount(1);

  await page.getByTestId("task-sort-select").selectOption("reward");
  await page.getByTestId("sort-order-select").selectOption("desc");

  await page.getByTestId("reset-filters").click();
  await expect(page.getByTestId("search-input")).toHaveValue("");
  await expect(page.getByTestId("task-status-select")).toHaveValue("");
  await expect(page.getByTestId("task-card").first()).toBeVisible();
});

test("user tab supports sorting and pagination", async ({ page }) => {
  await page.goto("/");
  await openStreamsSection(page);

  await page.getByTestId("tab-users").click();
  await expect(page.getByTestId("agent-card")).toHaveCount(2);
  await expect(page.getByTestId("agent-card").filter({ hasText: "Agent One" })).toContainText("Active");
  await expect(page.locator("body")).not.toContainText("ACTIVE");

  await expandAdvancedFilters(page);
  await page.getByTestId("agent-sort-select").selectOption("score");
  await page.getByTestId("sort-order-select").selectOption("desc");
  await expect(page.getByTestId("agent-card").first()).toContainText("Agent Two");

  await page.getByTestId("active-only-checkbox").click();
  await expect(page.getByTestId("active-only-checkbox")).not.toBeChecked();

  const agentCards = page.getByTestId("agent-card");
  await expect(async () => {
    if (await agentCards.count() >= 3) {
      return;
    }
    const loadMoreButton = page.getByTestId("load-more-agents");
    if (await loadMoreButton.count() === 0) {
      throw new Error("load-more button missing before agents reached expected count");
    }
    await loadMoreButton.click();
  }).toPass({
    timeout: 10_000,
    intervals: [100, 250, 500]
  });
  await expect(agentCards).toHaveCount(3);
  await expect(page.getByTestId("agent-card").filter({ hasText: "Agent Three" })).toContainText("Idle");
});

test("task and agent detail drawers show enriched fields", async ({ page }) => {
  await page.goto("/");
  await openStreamsSection(page);

  await page.getByTestId("task-card").filter({ hasText: "Beta Dataset Labeling" }).getByTestId("task-detail-trigger").click();
  await expect(page.getByTestId("detail-drawer")).toBeVisible();
  await expect(page.getByText("Beta Dataset Labeling")).toBeVisible();
  await expect(page.getByText("Escrow Remaining")).toBeVisible();
  await expect(page.getByText("Output quality mismatch.")).toBeVisible();

  await page.locator(".drawer-mask").click();
  await page.getByTestId("tab-users").click();
  await page.getByTestId("agent-card").filter({ hasText: "Agent One" }).getByTestId("agent-detail-trigger").click();
  await expect(page.getByTestId("detail-drawer")).toBeVisible();
  await expect(page.getByText("42 AGC")).toBeVisible();
});

test("direct task and agent detail pages use the unified detail shell", async ({ page }) => {
  await page.goto("/tasks/task-beta");
  await expect(page.getByText("Task Dossier")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Beta Dataset Labeling" })).toBeVisible();
  await expect(page.getByText("Escrow Remaining")).toBeVisible();
  await expect(page.getByText("related disputes")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to AgentHire" })).toHaveAttribute("href", "/?section=streams&tab=tasks");

  await page.goto("/agents/0x3333333333333333333333333333333333333333");
  await expect(page.getByText("Agent Profile")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Agent One" })).toBeVisible();
  await expect(page.getByText("Balance & Reputation")).toBeVisible();
  await expect(page.getByText("42 AGC")).toBeVisible();
});

test("cycle tab and active cycle card open reward detail drawer", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).not.toContainText("CLOSED");

  await page.getByTestId("section-tab-metrics").click();
  await page.getByRole("button", { name: "View details" }).click();
  await expect(page.getByTestId("detail-drawer")).toBeVisible();
  await expect(page.getByText("Reward Pool")).toBeVisible();
  await expect(page.getByText("1090 AGC")).toBeVisible();

  await page.locator(".drawer-mask").click();
  await openStreamsSection(page);
  await page.getByTestId("tab-cycles").click();
  await expect(page.getByTestId("cycle-card")).toHaveCount(2);
  await expect(page.getByTestId("cycle-card").filter({ hasText: "cycle-9" })).toContainText("Open");
  await expect(page.getByTestId("cycle-card").filter({ hasText: "cycle-8" })).toContainText("Closed");
  await page.getByTestId("cycle-card").filter({ hasText: "cycle-9" }).getByTestId("cycle-detail-trigger").click();
  await expect(page.getByText("Raw Workloads")).toBeVisible();
  await expect(page.getByText("dispute-1")).toBeVisible();
});

test("direct cycle and dispute detail pages expose summary-first layouts", async ({ page }) => {
  await page.goto("/cycles/cycle-9");
  await expect(page.getByText("Cycle Settlement File")).toBeVisible();
  await expect(page.getByRole("heading", { name: "cycle-9" })).toBeVisible();
  await expect(page.getByText("Reward Pool")).toBeVisible();
  await expect(page.getByText("1090 AGC")).toBeVisible();
  await expect(page.getByText("Raw Workloads")).toBeVisible();

  await page.goto("/disputes/dispute-1");
  await expect(page.getByText("Dispute File")).toBeVisible();
  await expect(page.getByRole("heading", { name: "dispute-1" })).toBeVisible();
  await expect(page.getByText("Submission")).toBeVisible();
  await expect(page.getByText("Output quality mismatch.")).toBeVisible();
  await expect(page.getByText("Dispute Opened")).toBeVisible();
});

test("direct detail pages show not-found state cards", async ({ page }) => {
  await page.goto("/tasks/task-missing");
  await expect(page.getByRole("heading", { name: "Task Not Found" })).toBeVisible();
  await expect(page.getByText("There is no public record for this task id. Return to the platform hub and choose another entity.")).toBeVisible();

  await page.goto("/disputes/dispute-missing");
  await expect(page.getByRole("heading", { name: "Dispute Not Found" })).toBeVisible();
  await expect(page.getByText("There is no public record for this dispute id. Return to the platform hub and choose another dispute.")).toBeVisible();
});

test("direct detail pages show load-failed state cards on API errors", async ({ page }) => {
  await page.unroute(API_ROUTE_PATTERN);
  await installApiMocks(page, { failTaskById: "task-beta", failAgentByAddress: "0x3333333333333333333333333333333333333333" });

  await page.goto("/tasks/task-beta");
  await expect(page.getByRole("heading", { name: "Task Detail Load Failed" })).toBeVisible();
  await expect(page.getByText("The task detail service is unavailable right now. Return to the platform hub and inspect another entity.")).toBeVisible();

  await page.goto("/agents/0x3333333333333333333333333333333333333333");
  await expect(page.getByRole("heading", { name: "Agent Detail Load Failed" })).toBeVisible();
  await expect(page.getByText("The agent detail service is unavailable right now. Return to the platform hub and inspect another public entity.")).toBeVisible();
});

test("invalid query params are sanitized and still return usable results", async ({ page }) => {
  await page.goto("/?tab=bad&q=%20alpha%20&taskStatus=BAD&taskSort=bad&taskOrder=bad&agentSort=bad&agentOrder=bad&activeOnly=bad");

  await expect(page.getByTestId("task-card")).toHaveCount(1);
  await expect(page.getByTestId("tasks-error")).toHaveCount(0);
  await expect(page.getByText("Alpha Content Review")).toBeVisible();
});

test("task detail supports retry after transient API failures", async ({ page }) => {
  await page.unroute(API_ROUTE_PATTERN);
  await installApiMocks(page, { failActivitiesByTaskIdOnce: "task-beta" });

  await page.goto("/");
  await openStreamsSection(page);
  await page.getByTestId("task-card").filter({ hasText: "Beta Dataset Labeling" }).getByTestId("task-detail-trigger").click();
  await expect(page.getByTestId("task-detail-error")).toBeVisible();

  await page.getByTestId("retry-task-detail").click();
  await expect(page.getByText("Beta Dataset Labeling")).toBeVisible();
});

test("disputes tab supports filters and detail drawer", async ({ page }) => {
  await page.goto("/");
  await openStreamsSection(page);

  await page.getByTestId("tab-disputes").click();
  await expect(page.getByTestId("dispute-card")).toHaveCount(1);
  await expandAdvancedFilters(page);
  await page.getByTestId("dispute-status-select").selectOption("OPEN");
  await expect(page.getByTestId("dispute-card")).toContainText("dispute-1");
  await page.getByTestId("dispute-detail-trigger").click();
  await expect(page.getByTestId("detail-drawer")).toContainText("Dispute Overview");
});
