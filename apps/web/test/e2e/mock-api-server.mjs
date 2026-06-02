import http from "node:http";

const MOCK_PORT = Number(process.env.PLAYWRIGHT_MOCK_API_PORT ?? 3300);

const ISO_NOW = "2026-03-31T12:00:00.000Z";

const tasks = [
  {
    id: "task-alpha",
    publisher: "0x1111111111111111111111111111111111111111",
    title: "Alpha Content Review",
    descriptionMd: "Review alpha artifacts.",
    acceptanceCriteria: "Clear summary with actions.",
    status: "OPEN",
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
    targetMentions: [],
    createdAt: "2026-03-29T08:00:00.000Z",
    updatedAt: "2026-03-31T10:00:00.000Z"
  },
  {
    id: "task-beta",
    publisher: "0x2222222222222222222222222222222222222222",
    title: "Beta Dataset Labeling",
    descriptionMd: "Label beta dataset.",
    acceptanceCriteria: ">= 95% quality score.",
    status: "IN_PROGRESS",
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
    targetMentions: [],
    createdAt: "2026-03-30T09:00:00.000Z",
    updatedAt: "2026-03-31T11:00:00.000Z"
  },
  {
    id: "task-gamma",
    publisher: "0x1111111111111111111111111111111111111111",
    title: "Gamma Summary Draft",
    descriptionMd: "Draft gamma summary.",
    acceptanceCriteria: "At least 1200 words.",
    status: "CLOSED",
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
    targetMentions: [],
    createdAt: "2026-03-28T09:00:00.000Z",
    updatedAt: "2026-03-31T09:00:00.000Z"
  }
];

const submissions = [
  {
    id: "submission-1",
    taskId: "task-beta",
    agent: "0x3333333333333333333333333333333333333333",
    payloadMd: "Labeled 300 samples with QA notes.",
    rejectReasonMd: "Output quality mismatch. Missing coverage report and evidence.",
    attachments: [{ name: "beta-log", url: "https://example.com/beta.log" }],
    status: "REJECTED",
    createdAt: "2026-03-31T10:40:00.000Z",
    updatedAt: "2026-03-31T11:15:00.000Z"
  },
  {
    id: "submission-2",
    taskId: "task-gamma",
    agent: "0x4444444444444444444444444444444444444444",
    payloadMd: "Drafted 1300-word summary and references.",
    rejectReasonMd: null,
    attachments: [],
    status: "CONFIRMED",
    createdAt: "2026-03-31T09:00:00.000Z",
    updatedAt: "2026-03-31T09:15:00.000Z"
  }
];

const taskIntentionsByTaskId = {
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

const agentProfiles = [
  {
    address: "0x3333333333333333333333333333333333333333",
    name: "Agent One",
    bio: "Focus on data quality.",
    status: "ACTIVE",
    bannedAt: null,
    banReasonCode: null,
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
    status: "ACTIVE",
    bannedAt: null,
    banReasonCode: null,
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
    status: "ACTIVE",
    bannedAt: null,
    banReasonCode: null,
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

const agents = [
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

const cycles = [
  {
    id: "cycle-9",
    status: "OPEN",
    mintedAmount: 1000,
    taxPool: 80,
    penaltyPool: 10,
    startedAt: "2026-03-28T00:00:00.000Z",
    closedAt: null
  },
  {
    id: "cycle-8",
    status: "CLOSED",
    mintedAmount: 980,
    taxPool: 60,
    penaltyPool: 5,
    startedAt: "2026-03-20T00:00:00.000Z",
    closedAt: "2026-03-27T23:59:59.000Z"
  },
  {
    id: "cycle-7",
    status: "CLOSED",
    mintedAmount: 950,
    taxPool: 55,
    penaltyPool: 0,
    startedAt: "2026-03-13T00:00:00.000Z",
    closedAt: "2026-03-19T23:59:59.000Z"
  }
];

const disputes = [
  {
    id: "dispute-1",
    taskId: "task-beta",
    submissionId: "submission-1",
    opener: "0x2222222222222222222222222222222222222222",
    reasonMd: "Output quality mismatch.",
    status: "OPEN",
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
};

const ledgerByAddress = {
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

const activities = [
  {
    id: "activity-1",
    type: "TASK_PUBLISHED",
    cycleId: "cycle-9",
    taskId: "task-alpha",
    disputeId: null,
    actor: "0x1111111111111111111111111111111111111111",
    createdAt: "2026-03-31T10:00:00.000Z"
  },
  {
    id: "activity-2",
    type: "TASK_INTENDED",
    cycleId: "cycle-9",
    taskId: "task-beta",
    disputeId: null,
    actor: "0x3333333333333333333333333333333333333333",
    createdAt: "2026-03-31T10:20:00.000Z"
  },
  {
    id: "activity-3",
    type: "DISPUTE_OPENED",
    cycleId: "cycle-9",
    taskId: "task-beta",
    disputeId: "dispute-1",
    actor: "0x2222222222222222222222222222222222222222",
    createdAt: "2026-03-31T11:20:00.000Z"
  },
  {
    id: "activity-4",
    type: "TASK_COMPLETED",
    cycleId: "cycle-9",
    taskId: "task-gamma",
    disputeId: null,
    actor: "0x4444444444444444444444444444444444444444",
    createdAt: "2026-03-31T09:10:00.000Z"
  }
];

const defaultScenario = Object.freeze({
  failTaskById: null,
  failAgentByAddress: null,
  failCycleById: null,
  failDisputeById: null,
  failActivitiesByTaskIdOnce: null,
  failActivitiesByAddressOnce: null
});

let scenario = {
  ...defaultScenario,
  failedTaskActivity: false,
  failedAddressActivity: false
};

const parseJsonBody = async (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });

const paginate = (items, cursorRaw, limitRaw) => {
  const start = Number(cursorRaw ?? "0");
  const limit = Number(limitRaw ?? "20");
  const sliced = items.slice(start, start + limit);
  const nextCursor = start + limit < items.length ? String(start + limit) : null;
  return { items: sliced, nextCursor };
};

const sortByDate = (left, right, order) =>
  order === "asc" ? left.localeCompare(right) : right.localeCompare(left);

const stripVersionPrefix = (pathname) => {
  const next = pathname.replace(/^\/v\d+(?=\/|$)/, "");
  return next.length > 0 ? next : "/";
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

const sendJson = (res, status, body) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...corsHeaders
  });
  res.end(JSON.stringify(body));
};

const handler = async (req, res) => {
  if (!req.url) {
    sendJson(res, 400, { error: "missing url" });
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://127.0.0.1:${MOCK_PORT}`);
  const path = stripVersionPrefix(url.pathname);

  if (path === "/__mock__/state" && req.method === "POST") {
    try {
      const body = await parseJsonBody(req);
      scenario = {
        ...defaultScenario,
        failTaskById: typeof body.failTaskById === "string" ? body.failTaskById : null,
        failAgentByAddress:
          typeof body.failAgentByAddress === "string" ? body.failAgentByAddress : null,
        failCycleById: typeof body.failCycleById === "string" ? body.failCycleById : null,
        failDisputeById: typeof body.failDisputeById === "string" ? body.failDisputeById : null,
        failActivitiesByTaskIdOnce:
          typeof body.failActivitiesByTaskIdOnce === "string" ? body.failActivitiesByTaskIdOnce : null,
        failActivitiesByAddressOnce:
          typeof body.failActivitiesByAddressOnce === "string" ? body.failActivitiesByAddressOnce : null,
        failedTaskActivity: false,
        failedAddressActivity: false
      };
      sendJson(res, 200, { ok: true, scenario });
      return;
    } catch {
      sendJson(res, 400, { error: "invalid json" });
      return;
    }
  }

  if (path === "/dashboard/summary") {
    sendJson(res, 200, {
      timezone: url.searchParams.get("tz") ?? "UTC",
      generatedAt: ISO_NOW,
      activeCycleId: "cycle-9",
      today: { tasksPublished: 2, tasksIntented: 1, tasksCompleted: 1, disputesOpened: 1 },
      currentCycle: { tasksPublished: 7, tasksIntented: 6, tasksCompleted: 5, disputesOpened: 2 },
      totals: { tasks: 3, disputes: 1, agents: 3 }
    });
    return;
  }

  if (path === "/dashboard/trends") {
    sendJson(res, 200, {
      timezone: url.searchParams.get("tz") ?? "UTC",
      generatedAt: ISO_NOW,
      window: url.searchParams.get("window") === "30d" ? "30d" : "7d",
      points: [
        { bucketStart: "2026-03-29T00:00:00.000Z", label: "03-29", tasksPublished: 1, tasksIntented: 1, tasksCompleted: 0, disputesOpened: 0 },
        { bucketStart: "2026-03-30T00:00:00.000Z", label: "03-30", tasksPublished: 2, tasksIntented: 2, tasksCompleted: 1, disputesOpened: 0 },
        { bucketStart: "2026-03-31T00:00:00.000Z", label: "03-31", tasksPublished: 2, tasksIntented: 1, tasksCompleted: 1, disputesOpened: 1 }
      ]
    });
    return;
  }

  if (path === "/system/health") {
    sendJson(res, 200, { ok: true, service: "agentrade-server" });
    return;
  }

  if (path === "/economy/params") {
    sendJson(res, 200, {
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
      taskSubmissionAttachmentMaxCount: 10,
      taskSubmissionAttachmentNameMaxLength: 200,
      taskSubmissionAttachmentUrlMaxLength: 2000,
      taskSubmissionAttachmentMaxSizeBytes: 104857600,
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
      scoreWeightReputationBps: 4500,
      scoreWeightCompletionBps: 3500,
      scoreWeightQualityBps: 2000,
      bridgeChain: "base-sepolia",
      bridgeMode: "OFFCHAIN_EXPORT_ONLY"
    });
    return;
  }

  if (path === "/cycles/active") {
    sendJson(res, 200, cycles[0]);
    return;
  }

  if (path === "/cycles") {
    const sorted = [...cycles].sort((a, b) => sortByDate(a.startedAt, b.startedAt, "desc"));
    sendJson(res, 200, paginate(sorted, url.searchParams.get("cursor"), url.searchParams.get("limit") ?? "2"));
    return;
  }

  if (path.startsWith("/cycles/") && path.endsWith("/rewards")) {
    const cycleId = path.split("/")[2] ?? "";
    if (scenario.failCycleById === cycleId) {
      sendJson(res, 500, { error: "forced failure for detail route" });
      return;
    }

    const rewards = cycleRewardsById[cycleId];
    sendJson(res, rewards ? 200 : 404, rewards ?? { error: "not found" });
    return;
  }

  if (path.startsWith("/cycles/")) {
    const cycleId = path.split("/").at(-1) ?? "";
    const cycle = cycles.find((item) => item.id === cycleId);
    sendJson(res, cycle ? 200 : 404, cycle ?? { error: "not found" });
    return;
  }

  if (path === "/tasks") {
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const status = url.searchParams.get("status");
    const sort = url.searchParams.get("sort") ?? "latest";
    const order = url.searchParams.get("order") ?? "desc";
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

    sendJson(res, 200, paginate(filtered, url.searchParams.get("cursor"), "2"));
    return;
  }

  if (path.startsWith("/tasks/") && path.endsWith("/intentions")) {
    const taskId = path.split("/")[2] ?? "";
    const intentions = taskIntentionsByTaskId[taskId] ?? [];
    const body = paginate(intentions, url.searchParams.get("cursor"), url.searchParams.get("limit"));
    sendJson(res, tasks.some((item) => item.id === taskId) ? 200 : 404, tasks.some((item) => item.id === taskId) ? body : { error: "not found" });
    return;
  }

  if (path.startsWith("/tasks/")) {
    const taskId = path.split("/").at(-1) ?? "";
    if (scenario.failTaskById === taskId) {
      sendJson(res, 500, { error: "forced failure for detail route" });
      return;
    }
    const task = tasks.find((item) => item.id === taskId);
    sendJson(res, task ? 200 : 404, task ?? { error: "not found" });
    return;
  }

  if (path === "/submissions") {
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const taskId = url.searchParams.get("taskId");
    const agent = (url.searchParams.get("agent") ?? "").toLowerCase();
    const status = url.searchParams.get("status");
    const sort = url.searchParams.get("sort") ?? "latest";
    const order = url.searchParams.get("order") ?? "desc";

    let filtered = [...submissions];
    if (taskId) {
      filtered = filtered.filter((item) => item.taskId === taskId);
    }
    if (agent) {
      filtered = filtered.filter((item) => item.agent.toLowerCase() === agent);
    }
    if (status) {
      filtered = filtered.filter((item) => item.status === status);
    }
    if (q) {
      filtered = filtered.filter((item) =>
        item.id.toLowerCase().includes(q) ||
        item.taskId.toLowerCase().includes(q) ||
        item.agent.toLowerCase().includes(q) ||
        item.payloadMd.toLowerCase().includes(q)
      );
    }

    filtered.sort((a, b) =>
      sortByDate(sort === "created" ? a.createdAt : a.updatedAt, sort === "created" ? b.createdAt : b.updatedAt, order)
    );

    sendJson(res, 200, paginate(filtered, url.searchParams.get("cursor"), url.searchParams.get("limit")));
    return;
  }

  if (path.startsWith("/submissions/")) {
    const submissionId = path.split("/").at(-1) ?? "";
    const submission = submissions.find((item) => item.id === submissionId);
    sendJson(res, submission ? 200 : 404, submission ?? { error: "not found" });
    return;
  }

  if (path === "/agents") {
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const activeOnly = url.searchParams.get("activeOnly") !== "false";
    const sort = url.searchParams.get("sort") ?? "latest";
    const order = url.searchParams.get("order") ?? "desc";
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

    sendJson(res, 200, paginate(filtered, url.searchParams.get("cursor"), "2"));
    return;
  }

  if (path.startsWith("/agents/")) {
    const address = path.split("/").at(-1) ?? "";
    if (scenario.failAgentByAddress === address) {
      sendJson(res, 500, { error: "forced failure for detail route" });
      return;
    }
    const profile = agentProfiles.find((item) => item.address === address);
    sendJson(res, profile ? 200 : 404, profile ?? { error: "not found" });
    return;
  }

  if (path.startsWith("/ledger/")) {
    const address = path.split("/").at(-1) ?? "";
    const ledger = ledgerByAddress[address];
    sendJson(res, ledger ? 200 : 404, ledger ?? { error: "not found" });
    return;
  }

  if (path === "/disputes") {
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const taskId = url.searchParams.get("taskId");
    const status = url.searchParams.get("status");
    const sort = url.searchParams.get("sort") ?? "latest";
    const order = url.searchParams.get("order") ?? "desc";

    let filtered = taskId ? disputes.filter((item) => item.taskId === taskId) : [...disputes];
    if (q) {
      filtered = filtered.filter((item) =>
        item.id.toLowerCase().includes(q) ||
        item.taskId.toLowerCase().includes(q) ||
        item.opener.toLowerCase().includes(q) ||
        item.reasonMd.toLowerCase().includes(q) ||
        (item.counterpartyReasonMd ? item.counterpartyReasonMd.toLowerCase().includes(q) : false)
      );
    }
    if (status) {
      filtered = filtered.filter((item) => item.status === status);
    }

    filtered.sort((a, b) =>
      sortByDate(sort === "created" ? a.createdAt : a.updatedAt, sort === "created" ? b.createdAt : b.updatedAt, order)
    );

    sendJson(res, 200, paginate(filtered, url.searchParams.get("cursor"), url.searchParams.get("limit")));
    return;
  }

  if (path.startsWith("/disputes/")) {
    const disputeId = path.split("/").at(-1) ?? "";
    if (scenario.failDisputeById === disputeId) {
      sendJson(res, 500, { error: "forced failure for detail route" });
      return;
    }

    const dispute = disputes.find((item) => item.id === disputeId);
    sendJson(res, dispute ? 200 : 404, dispute ?? { error: "not found" });
    return;
  }

  if (path === "/activities") {
    const taskId = url.searchParams.get("taskId");
    const disputeId = url.searchParams.get("disputeId");
    const address = url.searchParams.get("address");
    const order = url.searchParams.get("order") ?? "desc";

    if (
      taskId &&
      scenario.failActivitiesByTaskIdOnce === taskId &&
      !scenario.failedTaskActivity
    ) {
      scenario = {
        ...scenario,
        failedTaskActivity: true
      };
      sendJson(res, 500, { error: "forced failure for retry path" });
      return;
    }

    if (
      address &&
      scenario.failActivitiesByAddressOnce === address &&
      !scenario.failedAddressActivity
    ) {
      scenario = {
        ...scenario,
        failedAddressActivity: true
      };
      sendJson(res, 500, { error: "forced failure for retry path" });
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
    sendJson(res, 200, paginate(filtered, url.searchParams.get("cursor"), url.searchParams.get("limit")));
    return;
  }

  sendJson(res, 404, { error: "unhandled route" });
};

const server = http.createServer((req, res) => {
  handler(req, res).catch((error) => {
    console.error("[mock-api] request handling failed", error);
    sendJson(res, 500, { error: "mock internal error" });
  });
});

server.listen(MOCK_PORT, "127.0.0.1", () => {
  console.log(`[mock-api] listening on http://127.0.0.1:${MOCK_PORT}`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
