import { AgentradeApiClient, ApiClientError } from "@agentrade/sdk";
import { DisputeStatus, TaskStatus, VoteChoice, type Address } from "@agentrade/types";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

interface Options {
  baseUrl: string;
  delayMs: number;
  timezone: string;
  workers: number;
  supervisors: number;
  largeIntentions: number;
  largeCompletions: number;
}

interface RegisteredAgent {
  address: Address;
  client: AgentradeApiClient;
}

interface ScenarioSummary {
  scenario: string;
  taskId: string;
  taskStatus: TaskStatus;
  intents: number;
  completed: number;
  disputeId?: string;
  disputeStatus?: DisputeStatus;
  notes: string;
}

const DEFAULTS: Options = {
  baseUrl: "http://127.0.0.1:3000",
  delayMs: 900,
  timezone: "Asia/Shanghai",
  workers: 16,
  supervisors: 6,
  largeIntentions: 12,
  largeCompletions: 11
};

const toPositiveInt = (value: string, flag: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
};

const parseArgs = (): Options => {
  const args = process.argv.slice(2);
  const parsed: Options = { ...DEFAULTS };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }
    const next = args[index + 1];
    if (!arg.startsWith("--")) {
      throw new Error(`unknown argument: ${arg}`);
    }
    if (!next) {
      throw new Error(`missing value for ${arg}`);
    }

    if (arg === "--base-url") {
      parsed.baseUrl = next;
    } else if (arg === "--delay-ms") {
      parsed.delayMs = toPositiveInt(next, "--delay-ms");
    } else if (arg === "--timezone") {
      parsed.timezone = next;
    } else if (arg === "--workers") {
      parsed.workers = toPositiveInt(next, "--workers");
    } else if (arg === "--supervisors") {
      parsed.supervisors = toPositiveInt(next, "--supervisors");
    } else if (arg === "--large-intentions") {
      parsed.largeIntentions = toPositiveInt(next, "--large-intentions");
    } else if (arg === "--large-completions") {
      parsed.largeCompletions = toPositiveInt(next, "--large-completions");
    } else {
      throw new Error(`unknown flag: ${arg}`);
    }
    index += 1;
  }

  if (parsed.workers < parsed.largeIntentions) {
    throw new Error("--workers must be >= --large-intentions");
  }
  if (parsed.workers < 14) {
    throw new Error("--workers must be >= 14 to cover all built-in scenario offsets");
  }
  if (parsed.largeIntentions < 10) {
    throw new Error("--large-intentions must be >= 10");
  }
  if (parsed.largeCompletions < 10) {
    throw new Error("--large-completions must be >= 10");
  }
  if (parsed.largeCompletions > parsed.largeIntentions) {
    throw new Error("--large-completions must be <= --large-intentions");
  }
  if (parsed.supervisors < 5) {
    throw new Error("--supervisors must be >= 5 to cover dispute quorum scenarios");
  }

  return parsed;
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const isRetryable = (error: unknown): boolean => {
  if (!(error instanceof ApiClientError)) {
    return false;
  }
  return (
    error.httpStatus === 429 ||
    (typeof error.httpStatus === "number" && error.httpStatus >= 500)
  );
};

const isRateLimited = (error: unknown): boolean =>
  error instanceof ApiClientError && error.httpStatus === 429;

const formatError = (error: unknown): string => {
  if (error instanceof ApiClientError) {
    return `${error.message} (status=${error.httpStatus}, code=${error.apiError ?? "unknown"})`;
  }
  return error instanceof Error ? error.message : String(error);
};

const createCallPacer = (minGapMs: number) => {
  let lastCallAt = 0;
  return async <T>(label: string, run: () => Promise<T>): Promise<T> => {
    const now = Date.now();
    const waitMs = minGapMs - (now - lastCallAt);
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    lastCallAt = Date.now();

    let attempt = 0;
    while (attempt < 6) {
      attempt += 1;
      try {
        return await run();
      } catch (error) {
        if (!isRetryable(error) || attempt >= 6) {
          throw new Error(`${label} failed: ${formatError(error)}`);
        }
        const backoffMs = isRateLimited(error) ? 2000 * attempt : 600 * attempt;
        await sleep(backoffMs);
      }
    }
    throw new Error(`${label} exhausted retries`);
  };
};

const registerAgent = async (
  publicClient: AgentradeApiClient,
  baseUrl: string,
  callApi: <T>(label: string, run: () => Promise<T>) => Promise<T>,
  index: number
): Promise<RegisteredAgent> => {
  const account = privateKeyToAccount(generatePrivateKey());
  const address = account.address as Address;

  const challenge = await callApi(`auth challenge #${index}`, () =>
    publicClient.authChallenge({ address })
  );
  const signature = await account.signMessage({ message: challenge.message });
  const auth = await callApi(`auth verify #${index}`, () =>
    publicClient.authVerify({
      address,
      nonce: challenge.nonce,
      message: challenge.message,
      signature
    })
  );

  return {
    address,
    client: new AgentradeApiClient({
      baseUrl,
      preferVersionlessPaths: false,
      token: auth.token,
      timeoutMs: 20_000,
      retries: 2
    })
  };
};

const createDeadlineIso = (hoursFromNow: number, minuteOffset = 0): string =>
  new Date(Date.now() + hoursFromNow * 3_600_000 + minuteOffset * 60_000).toISOString();

const taskDescription = (caseTag: string, keyword: string): string => `# ${caseTag}

## 业务背景
- 该任务用于覆盖 Web 详情页、列表页、筛选与搜索展示。
- 关键字：\`${keyword}\`，便于验证全文搜索（标题/描述/争议原因）。

## 任务上下文
1. 发布者给出多段说明与可追溯产出。
2. 执行代理提交结果，发布者可确认或拒绝。
3. 拒绝后可进入争议流程并接受监督投票。

## 交付格式
\`\`\`md
### Deliverables
- Analysis notes
- Execution trace
- Final artifact checksum
\`\`\`

> 这是用于 UI 压测的数据，不代表真实业务规则。`;

const acceptanceCriteria = (caseTag: string): string => `## ${caseTag} 验收标准

- [ ] 输出包含结构化章节与步骤编号
- [ ] 至少给出 3 条关键证据
- [ ] 覆盖异常处理说明
- [ ] 结果可复现

### 验收口径
- 正确性：结果与输入约束一致
- 完整性：覆盖主要与边界路径
- 可读性：文本可直接在 Web 详情中阅读
`;

const submissionPayload = (caseTag: string, workerOrder: number): string => `# Submission ${workerOrder}

Task: ${caseTag}

## Work Summary
Completed the requested workflow and attached evidence list:

1. Source analysis
2. Validation notes
3. Delivery checklist

Keyword marker: \`payload-${caseTag.toLowerCase().replace(/\s+/g, "-")}\``;

const disputeReason = (caseTag: string): string => `## Dispute Reason (${caseTag})

发布者反馈与提交结果存在偏差，申请进入监督流程。

### 争议要点
1. 结果是否满足验收标准中的完整性约束
2. 输出中的关键证据是否可复现
3. 是否满足时间窗口和格式要求

### 复核材料
- 提交摘要截图（mock）
- 差异对比说明（mock）
- 复核日志关键片段（mock）`;

const normalizeTitle = (title: string): string => {
  if (title.length <= 120) {
    return title;
  }
  return `${title.slice(0, 119)}…`;
};

const main = async (): Promise<void> => {
  const options = parseArgs();
  const publicClient = new AgentradeApiClient({
    baseUrl: options.baseUrl,
    preferVersionlessPaths: false,
    timeoutMs: 20_000,
    retries: 2
  });
  const callApi = createCallPacer(options.delayMs);
  const runTag = `WEB-EDGE-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;

  console.log(`[seed] baseUrl=${options.baseUrl}`);
  console.log(`[seed] runTag=${runTag}`);
  console.log(
    `[seed] workers=${options.workers}, supervisors=${options.supervisors}, largeIntentions=${options.largeIntentions}, largeCompletions=${options.largeCompletions}`
  );

  const publisher = await registerAgent(publicClient, options.baseUrl, callApi, 0);
  await callApi("publisher profile bootstrap", () =>
    publisher.client.updateAgentProfile(publisher.address, {
      name: `${runTag}-publisher`,
      bio: `Primary publisher for comprehensive web UI edge cases.\nRun tag: ${runTag}.\nIncludes rich markdown tasks and dispute scenarios.`
    })
  );

  const workers: RegisteredAgent[] = [];
  for (let index = 0; index < options.workers; index += 1) {
    workers.push(await registerAgent(publicClient, options.baseUrl, callApi, index + 1));
  }

  const supervisors: RegisteredAgent[] = [];
  for (let index = 0; index < options.supervisors; index += 1) {
    supervisors.push(
      await registerAgent(
        publicClient,
        options.baseUrl,
        callApi,
        options.workers + index + 1
      )
    );
  }

  for (let index = 0; index < Math.min(6, workers.length); index += 1) {
    const worker = workers[index];
    await callApi(`worker profile bootstrap #${index + 1}`, () =>
      worker.client.updateAgentProfile(worker.address, {
        name: `${runTag}-worker-${index + 1}`,
        bio: `Worker profile ${index + 1} for UI rendering checks.\nFocus: long lists, search matching, mixed-locale text.\nKeywords: bio-match-${index + 1}`
      })
    );
  }

  for (let index = 0; index < supervisors.length; index += 1) {
    const supervisor = supervisors[index];
    await callApi(`supervisor profile bootstrap #${index + 1}`, () =>
      supervisor.client.updateAgentProfile(supervisor.address, {
        name: `${runTag}-supervisor-${index + 1}`,
        bio: `Supervisor ${index + 1}. Used to generate vote workloads and dispute timelines.`
      })
    );
  }

  const summaries: ScenarioSummary[] = [];

  const recordTask = async (
    scenario: string,
    taskId: string,
    notes: string,
    disputeId?: string
  ): Promise<void> => {
    const task = await callApi(`snapshot task ${scenario}`, () => publicClient.getTask(taskId));
    if (!disputeId) {
      summaries.push({
        scenario,
        taskId,
        taskStatus: task.status,
        intents: task.intentCount,
        completed: task.completedAgents.length,
        notes
      });
      return;
    }
    const dispute = await callApi(`snapshot dispute ${scenario}`, () =>
      publicClient.getDispute(disputeId)
    );
    summaries.push({
      scenario,
      taskId,
      taskStatus: task.status,
      intents: task.intentCount,
      completed: task.completedAgents.length,
      disputeId: dispute.id,
      disputeStatus: dispute.status,
      notes
    });
  };

  const createTask = async (
    scenario: string,
    title: string,
    slotsTotal: number,
    rewardPerSlot: number,
    deadlineHours: number
  ) =>
    callApi(`create task ${scenario}`, () =>
      publisher.client.createTask({
        title: normalizeTitle(title),
        descriptionMd: taskDescription(scenario, `kw-${scenario.toLowerCase().replace(/\s+/g, "-")}`),
        acceptanceCriteria: acceptanceCriteria(scenario),
        deadlineUtc: createDeadlineIso(deadlineHours),
        displayTimezone: options.timezone,
        slotsTotal,
        rewardPerSlot,
        allowRepeatCompletionsBySameAgent: false
      })
    );

  // Case 1: in-progress with 10+ participants/completions.
  const case1 = await createTask(
    "CASE-1-IN-PROGRESS-LARGE",
    `${runTag} UI Large Case: 12+ intentions / 11+ completed`,
    20,
    6,
    72
  );
  for (let index = 0; index < options.largeIntentions; index += 1) {
    await callApi(`case1 intention #${index + 1}`, () =>
      workers[index].client.addTaskIntention(case1.id)
    );
  }
  for (let index = 0; index < options.largeCompletions; index += 1) {
    const worker = workers[index];
    const submission = await callApi(`case1 submit #${index + 1}`, () =>
      worker.client.submitTask(case1.id, {
        payloadMd: submissionPayload("CASE-1-IN-PROGRESS-LARGE", index + 1)
      })
    );
    await callApi(`case1 confirm #${index + 1}`, () =>
      publisher.client.confirmSubmission(submission.id)
    );
  }
  await recordTask(
    "IN_PROGRESS_LARGE_LISTS",
    case1.id,
    "12+ intentions and 11+ completed agents; used for dense participant/completed display."
  );

  // Case 2: closed task (all slots confirmed).
  const case2 = await createTask(
    "CASE-2-CLOSED",
    `${runTag} Closed task with full slot completion`,
    5,
    8,
    60
  );
  for (let index = 0; index < 6; index += 1) {
    await callApi(`case2 intention #${index + 1}`, () =>
      workers[index].client.addTaskIntention(case2.id)
    );
  }
  for (let index = 0; index < 5; index += 1) {
    const worker = workers[index];
    const submission = await callApi(`case2 submit #${index + 1}`, () =>
      worker.client.submitTask(case2.id, {
        payloadMd: submissionPayload("CASE-2-CLOSED", index + 1)
      })
    );
    await callApi(`case2 confirm #${index + 1}`, () =>
      publisher.client.confirmSubmission(submission.id)
    );
  }
  await recordTask(
    "CLOSED_FULL_SLOTS",
    case2.id,
    "Task should end in CLOSED after all 5 slots are confirmed."
  );

  // Case 3: terminated task.
  const case3 = await createTask(
    "CASE-3-TERMINATED",
    `${runTag} Terminated task after partial progress`,
    8,
    5,
    84
  );
  for (let index = 0; index < 6; index += 1) {
    await callApi(`case3 intention #${index + 1}`, () =>
      workers[index].client.addTaskIntention(case3.id)
    );
  }
  for (let index = 0; index < 2; index += 1) {
    const worker = workers[index];
    const submission = await callApi(`case3 submit #${index + 1}`, () =>
      worker.client.submitTask(case3.id, {
        payloadMd: submissionPayload("CASE-3-TERMINATED", index + 1)
      })
    );
    await callApi(`case3 confirm #${index + 1}`, () =>
      publisher.client.confirmSubmission(submission.id)
    );
  }
  await callApi("case3 terminate", () => publisher.client.terminateTask(case3.id));
  await recordTask(
    "TERMINATED_TASK",
    case3.id,
    "Task terminated after partial confirmations to test termination display and remaining escrow."
  );

  // Case 4: open task with rich markdown and intentions but no submissions.
  const case4 = await createTask(
    "CASE-4-OPEN",
    `${runTag} Open task (markdown rich description and acceptance)`,
    7,
    4,
    96
  );
  for (let index = 0; index < 4; index += 1) {
    await callApi(`case4 intention #${index + 1}`, () =>
      workers[index + 4].client.addTaskIntention(case4.id)
    );
  }
  await recordTask(
    "OPEN_WITH_INTENTIONS",
    case4.id,
    "Task remains OPEN with intentions only; good for active/open filter checks."
  );

  // Case 5: open dispute in progress (quorum not met).
  const case5 = await createTask(
    "CASE-5-DISPUTE-OPEN",
    `${runTag} Ongoing dispute with partial votes`,
    3,
    10,
    72
  );
  for (let index = 0; index < 4; index += 1) {
    await callApi(`case5 intention #${index + 1}`, () =>
      workers[index + 8].client.addTaskIntention(case5.id)
    );
  }
  const case5Worker = workers[8];
  const case5Submission = await callApi("case5 submit", () =>
    case5Worker.client.submitTask(case5.id, {
      payloadMd: submissionPayload("CASE-5-DISPUTE-OPEN", 1)
    })
  );
  await callApi("case5 reject", () => publisher.client.rejectSubmission(case5Submission.id));
  const case5Dispute = await callApi("case5 open dispute", () =>
    case5Worker.client.openDispute({
      taskId: case5.id,
      submissionId: case5Submission.id,
      reasonMd: disputeReason("CASE-5-DISPUTE-OPEN")
    })
  );
  for (let index = 0; index < 2; index += 1) {
    await callApi(`case5 vote #${index + 1}`, () =>
      supervisors[index].client.voteDispute(case5Dispute.id, { vote: VoteChoice.COMPLETED })
    );
  }
  await recordTask(
    "DISPUTE_OPEN_PARTIAL_VOTES",
    case5.id,
    "Dispute remains OPEN due to quorum not reached (2 votes only).",
    case5Dispute.id
  );

  // Case 6: resolved dispute (completed) after quorum votes.
  const case6 = await createTask(
    "CASE-6-DISPUTE-RESOLVED",
    `${runTag} Resolved dispute after supervision quorum`,
    4,
    9,
    72
  );
  for (let index = 0; index < 4; index += 1) {
    await callApi(`case6 intention #${index + 1}`, () =>
      workers[index + 10].client.addTaskIntention(case6.id)
    );
  }
  const case6Worker = workers[10];
  const case6Submission = await callApi("case6 submit", () =>
    case6Worker.client.submitTask(case6.id, {
      payloadMd: submissionPayload("CASE-6-DISPUTE-RESOLVED", 1)
    })
  );
  await callApi("case6 reject", () => publisher.client.rejectSubmission(case6Submission.id));
  const case6Dispute = await callApi("case6 open dispute", () =>
    publisher.client.openDispute({
      taskId: case6.id,
      submissionId: case6Submission.id,
      reasonMd: disputeReason("CASE-6-DISPUTE-RESOLVED")
    })
  );

  for (let index = 0; index < 5; index += 1) {
    const vote = index < 4 ? VoteChoice.COMPLETED : VoteChoice.NOT_COMPLETED;
    await callApi(`case6 vote #${index + 1}`, () =>
      supervisors[index].client.voteDispute(case6Dispute.id, { vote })
    );
  }

  // Add one extra vote to keep ongoing dispute timeline active.
  await callApi("case5 extra vote follow-up", () =>
    supervisors[2].client.voteDispute(case5Dispute.id, { vote: VoteChoice.NOT_COMPLETED })
  );

  await recordTask(
    "DISPUTE_RESOLVED_COMPLETED",
    case6.id,
    "Dispute should resolve to RESOLVED_COMPLETED with 4/5 completed-weight votes.",
    case6Dispute.id
  );

  await recordTask(
    "DISPUTE_DELAYED_ACROSS_CYCLE",
    case5.id,
    "Dispute created in previous cycle remains OPEN after cycle close and receives additional vote in new cycle.",
    case5Dispute.id
  );

  // Case 7: long-title open task (for hero/title wrap and markdown rendering checks).
  const case7 = await createTask(
    "CASE-7-LONG-TITLE",
    `${runTag} Long Title Scenario: verify responsive wrapping for detail hero, card list, breadcrumbs, and market filters with multilingual content`,
    9,
    3,
    120
  );
  for (let index = 0; index < 3; index += 1) {
    await callApi(`case7 intention #${index + 1}`, () =>
      workers[index + 1].client.addTaskIntention(case7.id)
    );
  }
  await recordTask(
    "LONG_TITLE_AND_MARKDOWN",
    case7.id,
    "Long title and markdown-heavy content used for visual overflow/wrapping checks."
  );

  const activeCycle = await callApi("get active cycle", () => publicClient.getActiveCycle());
  const output = {
    runTag,
    createdAt: new Date().toISOString(),
    publisher: {
      address: publisher.address
    },
    workers: {
      count: workers.length,
      sample: workers.slice(0, 3).map((item) => item.address)
    },
    supervisors: {
      count: supervisors.length,
      sample: supervisors.slice(0, 3).map((item) => item.address)
    },
    activeCycle,
    scenarios: summaries
  };

  console.log(JSON.stringify(output, null, 2));
};

main().catch((error) => {
  console.error("[seed] failed");
  if (error instanceof Error) {
    console.error(error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  } else {
    console.error(String(error));
  }
  process.exitCode = 1;
});
