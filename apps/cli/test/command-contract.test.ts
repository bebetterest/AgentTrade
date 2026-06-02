import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import type { IncomingHttpHeaders } from "node:http";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { stripApiVersionPrefix } from "@agentrade/contracts";
import { parseCliSuccessEnvelope, unwrapCliSuccess } from "./success-envelope.js";

type AuthMode = "none" | "bearer" | "bearer_admin";

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: unknown;
}

interface ExpectedRequest {
  method: string;
  url: string;
  auth: AuthMode;
  body?: unknown;
}

const toContractRouteUrl = (url: string): string =>
  /^\/v\d+(?=\/|$)/.test(url) ? url : (url === "/" ? "/v2" : `/v2${url}`);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../../..");
const cliBin = resolve(repoRoot, "apps/cli/node_modules/.bin/tsx");
const cliEntry = resolve(repoRoot, "apps/cli/src/index.ts");
const testConfigPath = join(tmpdir(), `agentrade-cli-command-contract-${process.pid}.json`);

const hasOption = (args: string[], option: string): boolean =>
  args.includes(option) || args.some((arg) => arg.startsWith(`${option}=`));

const runCli = async (
  args: string[],
  env: NodeJS.ProcessEnv,
  stdinText?: string
): Promise<CliResult> => {
  const globalArgs: string[] = [];
  if (env.AGENTRADE_TOKEN && !hasOption(args, "--token") && !hasOption(args, "--token-file")) {
    globalArgs.push("--token", env.AGENTRADE_TOKEN);
  }
  if (env.AGENTRADE_ADMIN_KEY && !hasOption(args, "--admin-key") && !hasOption(args, "--admin-key-file")) {
    globalArgs.push("--admin-key", env.AGENTRADE_ADMIN_KEY);
  }

  const childEnv = { ...process.env, ...env };
  delete childEnv.AGENTRADE_TOKEN;
  delete childEnv.AGENTRADE_ADMIN_KEY;
  if (!childEnv.AGENTRADE_CLI_CONFIG_PATH) {
    childEnv.AGENTRADE_CLI_CONFIG_PATH = testConfigPath;
  }

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(cliBin, [cliEntry, ...globalArgs, ...args], {
      cwd: repoRoot,
      env: childEnv
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", rejectPromise);
    child.stdin.end(stdinText ?? "");
    child.on("close", (code) => {
      resolvePromise({ code, stdout, stderr });
    });
  });
};

const readRequestBody = async (request: import("node:http").IncomingMessage): Promise<string> => {
  return new Promise((resolvePromise, rejectPromise) => {
    let data = "";
    request.on("data", (chunk) => {
      data += String(chunk);
    });
    request.on("end", () => resolvePromise(data));
    request.on("error", rejectPromise);
  });
};

test("cli command contract: method/path/auth/body coverage for all command groups", async () => {
  const token = "cli-contract-token";
  const adminKey = "cli-contract-admin-key";
  const manualSignature = `0x${"11".repeat(65)}`;
  const addressA = "0x1111111111111111111111111111111111111111";
  const addressB = "0x2222222222222222222222222222222222222222";
  const deadline = "2027-01-01T00:00:00.000Z";
  const now = "2026-04-02T08:00:00.000Z";

  const taskPayload = {
    id: "task-1",
    publisher: addressA,
    title: "contract-task",
    descriptionMd: "desc-from-file",
    acceptanceCriteria: "criteria-from-file",
    status: "OPEN",
    deadlineUtc: deadline,
    displayTimezone: "UTC",
    slotsTotal: 2,
    rewardPerSlot: 7,
    allowRepeatCompletionsBySameAgent: true,
    taxAmount: 1,
    rewardEscrowRemaining: 14,
    intentCount: 0,
    competitionRatio: 0,
    completedAgents: [],
    targetMentions: [],
    createdAt: now,
    updatedAt: now
  };
  const taskIntentionPayload = {
    id: "intention-1",
    taskId: "task-1",
    agent: addressB,
    createdAt: now
  };
  const submissionPayload = {
    id: "submission-1",
    taskId: "task-1",
    agent: addressB,
    payloadMd: "payload-from-file",
    attachments: [],
    status: "SUBMITTED",
    createdAt: now,
    updatedAt: now
  };
  const disputePayload = {
    id: "dispute-1",
    taskId: "task-1",
    submissionId: "submission-1",
    opener: addressA,
    reasonMd: "reason-from-file",
    status: "OPEN",
    createdAt: now,
    updatedAt: now
  };
  const voteResultPayload = {
    vote: {
      id: "vote-1",
      disputeId: "dispute-1",
      agent: addressB,
      vote: "COMPLETED",
      weightSnapshot: 50,
      createdCycleId: "cycle-1",
      createdAt: now
    },
    workload: {
      id: "workload-1",
      cycleId: "cycle-1",
      disputeId: "dispute-1",
      agent: addressB,
      workload: 1,
      createdAt: now,
      settledAt: null
    }
  };
  const agentProfilePayload = {
    address: addressA,
    name: "Agent A",
    bio: "bio-inline",
    status: "ACTIVE",
    bannedAt: null,
    banReasonCode: null,
    reputation: {
      publisher: 50,
      worker: 50,
      supervisor: 50
    },
    stats: {
      tasksPublished: 1,
      tasksIntented: 1,
      tasksCompleted: 1,
      tasksTerminated: 0,
      submissionsRejected: 0,
      supervisionVotes: 0
    },
    createdAt: now,
    updatedAt: now
  };
  const agentDirectoryPayload = {
    ...agentProfilePayload,
    latestActivityAt: now,
    score: 75,
    isActive: true
  };
  const feedbackPayload = {
    id: "feedback-1",
    type: "BUG",
    title: "feedback-title-from-file",
    bodyMd: "feedback-body-from-file",
    reporterAddress: addressA,
    createdAt: now
  };
  const dashboardSummaryPayload = {
    timezone: "Asia/Shanghai",
    generatedAt: now,
    activeCycleId: "cycle-1",
    today: { tasksPublished: 1, tasksIntented: 0, tasksCompleted: 0, disputesOpened: 0 },
    currentCycle: { tasksPublished: 1, tasksIntented: 0, tasksCompleted: 0, disputesOpened: 0 },
    totals: { tasks: 1, disputes: 1, agents: 1 }
  };
  const todosPayload = {
    address: addressA,
    scope: "all",
    selectedType: null,
    generatedAt: now,
    groups: [
      {
        scope: "action_required",
        type: "published_task_submission_pending_review",
        resourceKind: "submission",
        title: "Published Task Submission Pending Review",
        description: "A submitted output under this account's published task still needs confirm or reject handling.",
        totalCount: 1,
        nextCursor: null,
        items: [
          {
            resourceKind: "submission",
            primaryId: "submission-1",
            title: "contract-task",
            taskId: "task-1",
            submissionId: "submission-1",
            disputeId: null,
            status: "SUBMITTED",
            createdAt: now,
            updatedAt: now,
            deadlineUtc: deadline
          }
        ]
      }
    ]
  };
  const cyclePayload = {
    id: "cycle-1",
    status: "OPEN",
    mintedAmount: 0,
    taxPool: 0,
    penaltyPool: 0,
    startedAt: now,
    closedAt: null
  };
  const runtimeRulesPayload = {
    cycleDurationHours: 168,
    mintPerCycle: 1000,
    taxRateBps: 500,
    taskCompletionPublisherWorkload: 1,
    taskCompletionWorkerWorkload: 1,
    disputeQuorum: 3,
    disputeApprovalBps: 5000,
    terminationPenaltyBps: 1000,
    submissionTimeoutHours: 24,
    resubmitCooldownMinutes: 30,
    reputationWeightPublisherBps: 3334,
    reputationWeightWorkerBps: 3333,
    reputationWeightSupervisorBps: 3333,
    scoreWeightReputationBps: 4500,
    scoreWeightCompletionBps: 3500,
    scoreWeightQualityBps: 2000
  };
  const runtimeSettingsPayload = {
    currentRules: runtimeRulesPayload,
    pendingNextPatch: { taxRateBps: 600 },
    nextRules: { ...runtimeRulesPayload, taxRateBps: 600 },
    updatedAt: now
  };
  const runtimeSettingsHistoryPayload = {
    items: [
      {
        id: "runtime-rule-audit-1",
        eventType: "UPDATE",
        applyTo: "next",
        reason: "test update",
        actor: "cli-contract-test",
        cycleId: "cycle-1",
        beforeRules: runtimeRulesPayload,
        afterRules: runtimeRulesPayload,
        patch: { taxRateBps: 600 },
        pendingNextPatch: { taxRateBps: 600 },
        createdAt: now
      }
    ],
    nextCursor: null
  };
  const publicEconomyPayload = {
    appName: "Agentrade",
    enablePersistence: true,
    enableRedisRateLimit: false,
    authChallengeTtlMinutes: 10,
    rateLimitPerMinute: 100,
    rateLimitBurst: 200,
    taskTitleMaxLength: 120,
    taskDescriptionMaxLength: 20000,
    taskAcceptanceCriteriaMaxLength: 8000,
    taskSubmissionPayloadMaxLength: 20000,
    taskSubmissionAttachmentMaxCount: 10,
    taskSubmissionAttachmentNameMaxLength: 200,
    taskSubmissionAttachmentUrlMaxLength: 2000,
    taskSubmissionAttachmentMaxSizeBytes: 104857600,
    taskTargetMentionMaxCount: 5,
    disputeReasonMaxLength: 4000,
    feedbackTitleMaxLength: 200,
    feedbackBodyMaxLength: 20000,
    taskSlotsMax: 100,
    taskRewardPerSlotMax: 1000000,
    taskDeadlineMaxHours: 4320,
    taxRateBps: 500,
    taxMin: 1,
    rewardMin: 1,
    initialAgentBalance: 1000,
    mintPerCycle: 1000,
    cycleDurationHours: 168,
    terminationPenaltyBps: 1000,
    submissionTimeoutHours: 24,
    resubmitCooldownMinutes: 30,
    disputeQuorum: 3,
    disputeApprovalBps: 5000,
    reputationWeightPublisherBps: 3334,
    reputationWeightWorkerBps: 3333,
    reputationWeightSupervisorBps: 3333,
    scoreWeightReputationBps: 4500,
    scoreWeightCompletionBps: 3500,
    scoreWeightQualityBps: 2000,
    bridgeChain: "base-sepolia",
    bridgeMode: "OFFCHAIN_EXPORT_ONLY"
  };

  const tmpDir = mkdtempSync(join(tmpdir(), "agentrade-cli-contract-"));
  const messageFile = join(tmpDir, "message.md");
  const signatureFile = join(tmpDir, "signature.txt");
  const titleFile = join(tmpDir, "title.txt");
  const descFile = join(tmpDir, "desc.md");
  const criteriaFile = join(tmpDir, "criteria.md");
  const payloadFile = join(tmpDir, "payload.md");
  const reasonFile = join(tmpDir, "reason.md");
  const reasonFileCounterparty = join(tmpDir, "reason-counterparty.md");
  const nameFile = join(tmpDir, "name.txt");
  const feedbackTitleFile = join(tmpDir, "feedback-title.txt");
  const feedbackBodyFile = join(tmpDir, "feedback-body.md");
  const tokenFile = join(tmpDir, "token.txt");
  const adminKeyFile = join(tmpDir, "admin-key.txt");
  const patchFile = join(tmpDir, "patch.json");
  const privateKeyFile = join(tmpDir, "private-key.txt");
  writeFileSync(messageFile, "\uFEFFmessage-from-file", "utf8");
  writeFileSync(signatureFile, `\uFEFF${manualSignature}\n`, "utf8");
  writeFileSync(titleFile, "\uFEFFcontract-task-from-file", "utf8");
  writeFileSync(descFile, "\uFEFFdesc-from-file", "utf8");
  writeFileSync(criteriaFile, "\uFEFFcriteria-from-file", "utf8");
  writeFileSync(payloadFile, "\uFEFFpayload-from-file", "utf8");
  writeFileSync(reasonFile, "\uFEFFreason-from-file", "utf8");
  writeFileSync(reasonFileCounterparty, "\uFEFFcounterparty-reason-from-file", "utf8");
  writeFileSync(nameFile, "\uFEFFname-from-file", "utf8");
  writeFileSync(feedbackTitleFile, "\uFEFFfeedback-title-from-file", "utf8");
  writeFileSync(feedbackBodyFile, "\uFEFFfeedback-body-from-file", "utf8");
  writeFileSync(tokenFile, `\uFEFF${token}\n`, "utf8");
  writeFileSync(adminKeyFile, `\uFEFF${adminKey}\n`, "utf8");
  writeFileSync(patchFile, '\uFEFF{"taxRateBps":600,"mintPerCycle":1200}', "utf8");

  const calls: RecordedRequest[] = [];
  const server = createServer(async (request, response) => {
    const bodyText = await readRequestBody(request);
    const body = bodyText.length > 0 ? JSON.parse(bodyText) : null;

    calls.push({
      method: request.method ?? "GET",
      url: request.url ?? "/",
      headers: request.headers,
      body
    });

    const routeKey = `${request.method ?? "GET"} ${toContractRouteUrl(request.url ?? "/")}`;
    response.setHeader("content-type", "application/json");

    switch (routeKey) {
      case "GET /v2/system/health":
        response.end(JSON.stringify({ ok: true, service: "mock-agentrade" }));
        return;
      case "GET /v2/system/metrics":
        response.end(
          JSON.stringify({
            generatedAt: now,
            startedAt: now,
            counters: {
              requestsTotal: 10,
              errorsTotal: 0,
              rateLimitedTotal: 0,
              writeTotal: 4,
              writeErrorTotal: 0,
              writeConflictTotal: 0,
              writeDeadlockTotal: 0,
              requestLogDroppedTotal: 0,
              requestLogFlushTotal: 0,
              requestLogFlushErrorTotal: 0,
              workerJobSuccessTotal: 0,
              workerJobErrorTotal: 0,
              workerJobLockMissTotal: 0,
              workerJobSuccessTotalExact: "0",
              workerJobErrorTotalExact: "0",
              workerJobLockMissTotalExact: "0"
            },
            gauges: {
              requestLogBufferSize: 0
            },
            latencies: {
              requests: { count: 10, avgMs: 5, p50Ms: 4, p95Ms: 8, p99Ms: 9, maxMs: 10 },
              writes: { count: 4, avgMs: 6, p50Ms: 5, p95Ms: 8, p99Ms: 9, maxMs: 10 }
            }
          })
        );
        return;
      case "GET /v2/system/settings":
      case "PATCH /v2/system/settings":
      case "POST /v2/system/settings/reset":
        response.end(JSON.stringify(runtimeSettingsPayload));
        return;
      case "GET /v2/system/settings/history":
      case "GET /v2/system/settings/history?cursor=7&limit=9":
        response.end(JSON.stringify(runtimeSettingsHistoryPayload));
        return;
      case "POST /v2/auth/challenge":
        response.end(JSON.stringify({ nonce: "nonce-1", message: "mock-message" }));
        return;
      case "POST /v2/auth/verify":
        response.end(JSON.stringify({ token: "jwt-token", expiresIn: "15m" }));
        return;
      case "GET /v2/tasks":
        response.end(JSON.stringify({ items: [], nextCursor: null }));
        return;
      case `GET /v2/tasks?q=task&status=OPEN&publisher=${addressA}&sort=reward&order=asc&cursor=2&limit=5`:
        response.end(JSON.stringify({ items: [], nextCursor: null }));
        return;
      case "GET /v2/tasks/task-1":
        response.end(JSON.stringify(taskPayload));
        return;
      case "POST /v2/tasks":
        response.end(JSON.stringify({ ...taskPayload, id: "task-created" }));
        return;
      case "GET /v2/tasks/task-1/intentions":
        response.end(JSON.stringify({ items: [taskIntentionPayload], nextCursor: null }));
        return;
      case "GET /v2/tasks/task-1/intentions?cursor=3&limit=8":
        response.end(JSON.stringify({ items: [taskIntentionPayload], nextCursor: null }));
        return;
      case "POST /v2/tasks/task-1/intentions":
        response.end(JSON.stringify(taskIntentionPayload));
        return;
      case "POST /v2/tasks/task-1/submissions":
        response.end(JSON.stringify(submissionPayload));
        return;
      case "POST /v2/tasks/task-1/terminate":
        response.end(JSON.stringify({ ...taskPayload, status: "TERMINATED" }));
        return;
      case "POST /v2/submissions/submission-1/confirm":
        response.end(JSON.stringify({ ...submissionPayload, status: "CONFIRMED" }));
        return;
      case "POST /v2/submissions/submission-1/reject":
        response.end(JSON.stringify({ ...submissionPayload, status: "REJECTED" }));
        return;
      case "GET /v2/submissions":
        response.end(JSON.stringify({ items: [submissionPayload], nextCursor: null }));
        return;
      case `GET /v2/submissions?taskId=task-1&agent=${addressB}&status=SUBMITTED&q=payload&sort=created&order=asc&cursor=3&limit=8`:
        response.end(JSON.stringify({ items: [submissionPayload], nextCursor: null }));
        return;
      case "GET /v2/submissions/submission-1":
        response.end(JSON.stringify(submissionPayload));
        return;
      case "GET /v2/disputes":
        response.end(JSON.stringify({ items: [], nextCursor: null }));
        return;
      case `GET /v2/disputes?taskId=task-1&opener=${addressA}&status=OPEN&q=dispute&sort=created&order=asc&cursor=1&limit=3`:
        response.end(JSON.stringify({ items: [], nextCursor: null }));
        return;
      case "GET /v2/disputes/dispute-1":
        response.end(JSON.stringify(disputePayload));
        return;
      case "POST /v2/disputes":
        response.end(JSON.stringify({ ...disputePayload, id: "dispute-opened" }));
        return;
      case "POST /v2/disputes/dispute-1/counterparty-reason":
        response.end(
          JSON.stringify({
            ...disputePayload,
            counterpartyResponder: addressB,
            counterpartyReasonMd: "counterparty-reason-from-file"
          })
        );
        return;
      case "POST /v2/disputes/dispute-1/votes":
        response.end(JSON.stringify(voteResultPayload));
        return;
      case `GET /v2/agents/${addressA}`:
        response.end(JSON.stringify(agentProfilePayload));
        return;
      case `GET /v2/agents?q=agent&activeOnly=true&sort=score&order=asc&cursor=4&limit=6`:
        response.end(JSON.stringify({ items: [agentDirectoryPayload], nextCursor: null }));
        return;
      case `PATCH /v2/agents/${addressA}/profile`:
        response.end(JSON.stringify(agentProfilePayload));
        return;
      case `GET /v2/agents/${addressA}/stats`:
        response.end(JSON.stringify(agentProfilePayload.stats));
        return;
      case `GET /v2/activities?taskId=task-1&disputeId=dispute-1&address=${addressA}&type=TASK_COMPLETED&order=asc&cursor=2&limit=4`:
      case "GET /v2/activities?type=TASK_SUBMITTED&order=desc&limit=5":
      case "GET /v2/activities?type=SUBMISSION_REJECTED&order=desc&limit=5":
      case "GET /v2/activities?type=ADMIN_AUDIT&order=desc&limit=5":
        response.end(JSON.stringify({ items: [], nextCursor: null }));
        return;
      case "GET /v2/dashboard/summary?tz=Asia%2FShanghai":
        response.end(JSON.stringify(dashboardSummaryPayload));
        return;
      case "GET /v2/dashboard/trends?tz=Asia%2FShanghai&window=30d":
        response.end(
          JSON.stringify({
            timezone: "Asia/Shanghai",
            generatedAt: now,
            window: "30d",
            points: []
          })
        );
        return;
      case `GET /v2/todos/${addressA}?scope=all`:
      case `GET /v2/todos/${addressA}?scope=action_required&type=published_task_submission_pending_review&limit=2`:
      case `GET /v2/todos/${addressA}?scope=waiting&type=open_dispute_waiting_resolution&cursor=todo-cursor&limit=3`:
        response.end(JSON.stringify(todosPayload));
        return;
      case `GET /v2/ledger/${addressA}`:
        response.end(JSON.stringify({ address: addressA, available: 10, updatedAt: now }));
        return;
      case "GET /v2/cycles":
        response.end(JSON.stringify({ items: [cyclePayload], nextCursor: null }));
        return;
      case "GET /v2/cycles?cursor=1&limit=2":
        response.end(JSON.stringify({ items: [cyclePayload], nextCursor: null }));
        return;
      case "GET /v2/cycles/active":
        response.end(JSON.stringify(cyclePayload));
        return;
      case "GET /v2/cycles/cycle-1":
        response.end(JSON.stringify(cyclePayload));
        return;
      case "GET /v2/cycles/cycle-1/rewards":
        response.end(
          JSON.stringify({
            cycle: cyclePayload,
            rewardPool: 0,
            distributions: [],
            workloads: []
          })
        );
        return;
      case "GET /v2/economy/params":
        response.end(JSON.stringify(publicEconomyPayload));
        return;
      case "POST /v2/feedback":
        response.end(JSON.stringify({ ...feedbackPayload, id: "feedback-created" }));
        return;
      case "GET /v2/feedback":
      case `GET /v2/feedback?type=BUG&reporter=${addressA}&cursor=5&limit=7`:
        response.end(JSON.stringify({ items: [feedbackPayload], nextCursor: null }));
        return;
      case "GET /v2/feedback/feedback-1":
        response.end(JSON.stringify(feedbackPayload));
        return;
      default:
        response.statusCode = 404;
        response.end(JSON.stringify({ error: "NOT_FOUND", message: routeKey }));
    }
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });
  const addressInfo = server.address();
  const port = typeof addressInfo === "object" && addressInfo ? addressInfo.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  const baseEnv = {
    AGENTRADE_TOKEN: token,
    AGENTRADE_ADMIN_KEY: adminKey
  };

  const assertAuth = (headers: IncomingHttpHeaders, mode: AuthMode): void => {
    if (mode === "none") {
      assert.equal(headers.authorization, undefined);
      assert.equal(headers["x-admin-service-key"], undefined);
      return;
    }
    if (mode === "bearer") {
      assert.equal(headers.authorization, `Bearer ${token}`);
      assert.equal(headers["x-admin-service-key"], undefined);
      return;
    }
    assert.equal(headers.authorization, `Bearer ${token}`);
    assert.equal(headers["x-admin-service-key"], adminKey);
  };

  const runAndAssert = async (
    args: string[],
    expected: ExpectedRequest,
    options: { pretty?: boolean; env?: NodeJS.ProcessEnv; stdinText?: string } = {}
  ): Promise<void> => {
    const beforeCalls = calls.length;
    const result = await runCli(
      ["--base-url", baseUrl, ...args],
      { ...baseEnv, ...options.env },
      options.stdinText
    );
    assert.equal(result.code, 0, `command failed: ${args.join(" ")}\n${result.stderr}`);
    assert.equal(calls.length, beforeCalls + 1, `request count mismatch for ${args.join(" ")}`);

    const parsed = parseCliSuccessEnvelope(result.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(typeof parsed.command, "string");
    assert.equal(typeof parsed.data, "object");
    if (options.pretty) {
      assert.match(result.stdout, /\n  "ok": true/);
    }

    const call = calls[calls.length - 1]!;
    assert.equal(call.method, expected.method);
    assert.equal(call.url, stripApiVersionPrefix(expected.url));
    assertAuth(call.headers, expected.auth);
    if (expected.body === undefined) {
      assert.equal(call.body, null);
    } else {
      assert.deepEqual(call.body, expected.body);
    }
  };

  try {
    await runAndAssert(["--pretty", "system", "health"], { method: "GET", url: "/v2/system/health", auth: "none" }, { pretty: true });

    await runAndAssert(["auth", "challenge", "--address", addressA], {
      method: "POST",
        url: "/v2/auth/challenge",
      auth: "none",
      body: { address: addressA }
    });

    await runAndAssert(
      [
        "auth",
        "verify",
        "--address",
        addressA,
        "--nonce",
        "nonce-1",
        "--signature-file",
        signatureFile,
        "--message-file",
        messageFile
      ],
      {
        method: "POST",
        url: "/v2/auth/verify",
        auth: "none",
        body: {
          address: addressA,
          nonce: "nonce-1",
          signature: manualSignature,
          message: "message-from-file"
        }
      }
    );

    const beforeRegisterCalls = calls.length;
    const registerResult = await runCli(["--base-url", baseUrl, "auth", "register"], baseEnv);
    assert.equal(registerResult.code, 0, `command failed: auth register\n${registerResult.stderr}`);
    assert.equal(calls.length, beforeRegisterCalls + 2, "auth register must trigger challenge + verify");

    const registerEnvelope = parseCliSuccessEnvelope<{
      wallet: { address: string; privateKeyIncluded: boolean; privateKey?: string };
      auth: { token: string; expiresIn: string };
      persistence: { walletPersisted: boolean; tokenPersisted: boolean };
    }>(registerResult.stdout);
    const registerOutput = registerEnvelope.data;
    assert.match(registerOutput.wallet.address, /^0x[a-fA-F0-9]{40}$/);
    assert.equal(registerOutput.wallet.privateKeyIncluded, false);
    assert.equal(registerOutput.wallet.privateKey, undefined);
    assert.equal(registerOutput.auth.token, "jwt-token");
    assert.equal(registerOutput.auth.expiresIn, "15m");
    assert.equal(registerOutput.persistence.walletPersisted, true);
    assert.equal(registerOutput.persistence.tokenPersisted, true);
    assert.equal(registerEnvelope.command, "auth register");
    assert.equal(registerEnvelope.warnings?.length, 1);
    assert.equal(registerEnvelope.warnings?.[0]?.code, "WALLET_IDENTITY_CREDENTIAL");
    assert.equal(registerEnvelope.warnings?.[0]?.level, "CRITICAL");
    assert.match(registerEnvelope.warnings?.[0]?.message ?? "", /only identity credential/i);
    assert.match(registerEnvelope.warnings?.[0]?.message ?? "", /Do not share it with other agents/i);

    const registerChallengeCall = calls[beforeRegisterCalls]!;
    assert.equal(registerChallengeCall.method, "POST");
    assert.equal(registerChallengeCall.url, stripApiVersionPrefix("/v2/auth/challenge"));
    assertAuth(registerChallengeCall.headers, "none");
    assert.deepEqual(registerChallengeCall.body, { address: registerOutput.wallet.address });

    const registerVerifyCall = calls[beforeRegisterCalls + 1]!;
    assert.equal(registerVerifyCall.method, "POST");
    assert.equal(registerVerifyCall.url, stripApiVersionPrefix("/v2/auth/verify"));
    assertAuth(registerVerifyCall.headers, "none");
    assert.equal(typeof registerVerifyCall.body, "object");
    const verifyBody = registerVerifyCall.body as {
      address: string;
      nonce: string;
      signature: string;
      message: string;
    };
    assert.equal(verifyBody.address, registerOutput.wallet.address);
    assert.equal(verifyBody.nonce, "nonce-1");
    assert.equal(verifyBody.message, "mock-message");
    assert.match(verifyBody.signature, /^0x[a-fA-F0-9]{130}$/);

    const registerShowKey = await runCli(
      ["--base-url", baseUrl, "auth", "register", "--show-private-key", "--no-persist-token"],
      baseEnv
    );
    assert.equal(registerShowKey.code, 0, `command failed: auth register --show-private-key\n${registerShowKey.stderr}`);
    const registerShowKeyOutput = unwrapCliSuccess<{
      wallet: { address: string; privateKeyIncluded: boolean; privateKey?: string };
      persistence: { walletPersisted: boolean; tokenPersisted: boolean };
    }>(registerShowKey.stdout);
    assert.match(registerShowKeyOutput.wallet.address, /^0x[a-fA-F0-9]{40}$/);
    assert.equal(registerShowKeyOutput.wallet.privateKeyIncluded, true);
    assert.match(registerShowKeyOutput.wallet.privateKey, /^0x[a-fA-F0-9]{64}$/);
    assert.equal(registerShowKeyOutput.persistence.walletPersisted, true);
    assert.equal(registerShowKeyOutput.persistence.tokenPersisted, false);
    const registerPlainPrivateKey = registerShowKeyOutput.wallet.privateKey!;
    writeFileSync(privateKeyFile, `\uFEFF${registerPlainPrivateKey}\n`, "utf8");

    const beforeLoginCalls = calls.length;
    const loginResult = await runCli(["--base-url", baseUrl, "auth", "login", "--no-persist-token"], baseEnv);
    assert.equal(loginResult.code, 0, `command failed: auth login\n${loginResult.stderr}`);
    assert.equal(calls.length, beforeLoginCalls + 2, "auth login must trigger challenge + verify");
    const loginOutput = unwrapCliSuccess<{
      wallet: { address: string };
      auth: { token: string; expiresIn: string };
      persistence: { tokenPersisted: boolean; walletSource: string };
    }>(loginResult.stdout);
    assert.match(loginOutput.wallet.address, /^0x[a-fA-F0-9]{40}$/);
    assert.equal(loginOutput.auth.token, "jwt-token");
    assert.equal(loginOutput.auth.expiresIn, "15m");
    assert.equal(loginOutput.persistence.tokenPersisted, false);
    assert.equal(loginOutput.persistence.walletSource, "config");

    const loginChallengeCall = calls[beforeLoginCalls]!;
    assert.equal(loginChallengeCall.method, "POST");
    assert.equal(loginChallengeCall.url, stripApiVersionPrefix("/v2/auth/challenge"));
    assertAuth(loginChallengeCall.headers, "none");
    assert.equal(typeof loginChallengeCall.body, "object");
    const loginChallengeBody = loginChallengeCall.body as { address: string };
    assert.match(loginChallengeBody.address, /^0x[a-fA-F0-9]{40}$/);

    const loginVerifyCall = calls[beforeLoginCalls + 1]!;
    assert.equal(loginVerifyCall.method, "POST");
    assert.equal(loginVerifyCall.url, stripApiVersionPrefix("/v2/auth/verify"));
    assertAuth(loginVerifyCall.headers, "none");
    assert.equal(typeof loginVerifyCall.body, "object");
    const loginVerifyBody = loginVerifyCall.body as {
      address: string;
      nonce: string;
      signature: string;
      message: string;
    };
    assert.equal(loginVerifyBody.address, loginChallengeBody.address);
    assert.equal(loginVerifyBody.nonce, "nonce-1");
    assert.equal(loginVerifyBody.message, "mock-message");
    assert.match(loginVerifyBody.signature, /^0x[a-fA-F0-9]{130}$/);

    const forceDifferentWalletAddress = await runCli(
      ["--base-url", baseUrl, "config", "set", "wallet-address", registerOutput.wallet.address],
      baseEnv
    );
    assert.equal(
      forceDifferentWalletAddress.code,
      0,
      `command failed: config set wallet-address\n${forceDifferentWalletAddress.stderr}`
    );

    const beforeLoginOverrideCalls = calls.length;
    const loginWithOverride = await runCli(
      [
        "--base-url",
        baseUrl,
        "auth",
        "login",
        "--private-key",
        registerPlainPrivateKey,
        "--no-persist-token"
      ],
      baseEnv
    );
    assert.equal(loginWithOverride.code, 0, `command failed: auth login --private-key\n${loginWithOverride.stderr}`);
    assert.equal(calls.length, beforeLoginOverrideCalls + 2, "auth login --private-key must trigger challenge + verify");
    const loginWithOverrideOutput = unwrapCliSuccess<{
      wallet: { address: string };
      persistence: { walletSource: string };
    }>(loginWithOverride.stdout);
    assert.equal(loginWithOverrideOutput.wallet.address, registerShowKeyOutput.wallet.address);
    assert.notEqual(loginWithOverrideOutput.wallet.address, registerOutput.wallet.address);
    assert.equal(loginWithOverrideOutput.persistence.walletSource, "flag");

    const beforeLoginFileCalls = calls.length;
    const loginWithFile = await runCli(
      [
        "--base-url",
        baseUrl,
        "auth",
        "login",
        "--private-key-file",
        privateKeyFile,
        "--no-persist-token"
      ],
      baseEnv
    );
    assert.equal(loginWithFile.code, 0, `command failed: auth login --private-key-file\n${loginWithFile.stderr}`);
    assert.equal(calls.length, beforeLoginFileCalls + 2, "auth login --private-key-file must trigger challenge + verify");
    const loginWithFileOutput = unwrapCliSuccess<{
      wallet: { address: string };
      persistence: { walletSource: string };
    }>(loginWithFile.stdout);
    assert.equal(loginWithFileOutput.wallet.address, registerShowKeyOutput.wallet.address);
    assert.equal(loginWithFileOutput.persistence.walletSource, "flag");

    const beforeMismatchCalls = calls.length;
    const loginMismatch = await runCli(
      [
        "--base-url",
        baseUrl,
        "auth",
        "login",
        "--address",
        registerOutput.wallet.address,
        "--private-key",
        registerPlainPrivateKey
      ],
      baseEnv
    );
    assert.equal(loginMismatch.code, 2);
    assert.equal(calls.length, beforeMismatchCalls, "auth login mismatch should fail before network request");
    const loginMismatchErr = JSON.parse(loginMismatch.stderr.trim()) as {
      type: string;
      command: string;
      message: string;
    };
    assert.equal(loginMismatchErr.type, "VALIDATION_ERROR");
    assert.equal(loginMismatchErr.command, "auth login");
    assert.match(loginMismatchErr.message, /does not match the resolved private key address/i);

    await runAndAssert(["tasks", "list"], { method: "GET", url: "/v2/tasks", auth: "none" });
    await runAndAssert(
      [
        "tasks",
        "list",
        "--q",
        "task",
        "--status",
        "OPEN",
        "--publisher",
        addressA,
        "--sort",
        "reward",
        "--order",
        "asc",
        "--cursor",
        "2",
        "--limit",
        "5"
      ],
      {
        method: "GET",
        url: `/v2/tasks?q=task&status=OPEN&publisher=${addressA}&sort=reward&order=asc&cursor=2&limit=5`,
        auth: "none"
      }
    );
    await runAndAssert(["tasks", "get", "--task", "task-1"], { method: "GET", url: "/v2/tasks/task-1", auth: "none" });

    await runAndAssert(
      [
        "tasks",
        "create",
        "--title-file",
        titleFile,
        "--desc-file",
        descFile,
        "--criteria-file",
        criteriaFile,
        "--deadline",
        deadline,
        "--tz",
        "UTC",
        "--slots",
        "2",
        "--reward",
        "7",
        "--allow-repeat"
      ],
      {
        method: "POST",
        url: "/v2/tasks",
        auth: "bearer",
        body: {
          title: "contract-task-from-file",
          descriptionMd: "desc-from-file",
          acceptanceCriteria: "criteria-from-file",
          deadlineUtc: deadline,
          displayTimezone: "UTC",
          slotsTotal: 2,
          rewardPerSlot: 7,
          allowRepeatCompletionsBySameAgent: true
        }
      }
    );

    await runAndAssert(["tasks", "intend", "--task", "task-1"], {
      method: "POST",
      url: "/v2/tasks/task-1/intentions",
      auth: "bearer"
    });
    await runAndAssert(["tasks", "intentions", "--task", "task-1"], {
      method: "GET",
      url: "/v2/tasks/task-1/intentions",
      auth: "none"
    });
    await runAndAssert(["tasks", "intentions", "--task", "task-1", "--cursor", "3", "--limit", "8"], {
      method: "GET",
      url: "/v2/tasks/task-1/intentions?cursor=3&limit=8",
      auth: "none"
    });
    await runAndAssert(["tasks", "submit", "--task", "task-1", "--payload-file", payloadFile], {
      method: "POST",
      url: "/v2/tasks/task-1/submissions",
      auth: "bearer",
      body: { payloadMd: "payload-from-file" }
    });
    await runAndAssert(
      ["tasks", "submit", "--task", "task-1", "--payload-file", "-"],
      {
        method: "POST",
        url: "/v2/tasks/task-1/submissions",
        auth: "bearer",
        body: { payloadMd: "payload-from-stdin" }
      },
      { stdinText: "payload-from-stdin" }
    );
    await runAndAssert(["tasks", "terminate", "--task", "task-1"], {
      method: "POST",
      url: "/v2/tasks/task-1/terminate",
      auth: "bearer"
    });

    await runAndAssert(["submissions", "confirm", "--submission", "submission-1"], {
      method: "POST",
      url: "/v2/submissions/submission-1/confirm",
      auth: "bearer"
    });
    await runAndAssert(["submissions", "reject", "--submission", "submission-1", "--reason", "needs fixes"], {
      method: "POST",
      url: "/v2/submissions/submission-1/reject",
      auth: "bearer",
      body: {
        reasonMd: "needs fixes"
      }
    });
    await runAndAssert(["submissions", "list"], {
      method: "GET",
      url: "/v2/submissions",
      auth: "none"
    });
    await runAndAssert(
      [
        "submissions",
        "list",
        "--task",
        "task-1",
        "--agent",
        addressB,
        "--status",
        "SUBMITTED",
        "--q",
        "payload",
        "--sort",
        "created",
        "--order",
        "asc",
        "--cursor",
        "3",
        "--limit",
        "8"
      ],
      {
        method: "GET",
        url: `/v2/submissions?taskId=task-1&agent=${addressB}&status=SUBMITTED&q=payload&sort=created&order=asc&cursor=3&limit=8`,
        auth: "none"
      }
    );
    await runAndAssert(["submissions", "get", "--submission", "submission-1"], {
      method: "GET",
      url: "/v2/submissions/submission-1",
      auth: "none"
    });

    await runAndAssert(["disputes", "list"], { method: "GET", url: "/v2/disputes", auth: "none" });
    await runAndAssert(
      [
        "disputes",
        "list",
        "--task",
        "task-1",
        "--opener",
        addressA,
        "--status",
        "OPEN",
        "--q",
        "dispute",
        "--sort",
        "created",
        "--order",
        "asc",
        "--cursor",
        "1",
        "--limit",
        "3"
      ],
      {
        method: "GET",
        url: `/v2/disputes?taskId=task-1&opener=${addressA}&status=OPEN&q=dispute&sort=created&order=asc&cursor=1&limit=3`,
        auth: "none"
      }
    );
    await runAndAssert(["disputes", "get", "--dispute", "dispute-1"], {
      method: "GET",
      url: "/v2/disputes/dispute-1",
      auth: "none"
    });
    await runAndAssert(
      [
        "disputes",
        "open",
        "--task",
        "task-1",
        "--submission",
        "submission-1",
        "--reason-file",
        reasonFile
      ],
      {
        method: "POST",
        url: "/v2/disputes",
        auth: "bearer",
        body: {
          taskId: "task-1",
          submissionId: "submission-1",
          reasonMd: "reason-from-file"
        }
      }
    );
    await runAndAssert(
      [
        "disputes",
        "respond",
        "--dispute",
        "dispute-1",
        "--reason-file",
        reasonFileCounterparty
      ],
      {
        method: "POST",
        url: "/v2/disputes/dispute-1/counterparty-reason",
        auth: "bearer",
        body: {
          reasonMd: "counterparty-reason-from-file"
        }
      }
    );
    await runAndAssert(["disputes", "vote", "--dispute", "dispute-1", "--vote", "COMPLETED"], {
      method: "POST",
      url: "/v2/disputes/dispute-1/votes",
      auth: "bearer",
      body: { vote: "COMPLETED" }
    });

    await runAndAssert(["agents", "profile", "get", "--address", addressA], {
      method: "GET",
      url: `/v2/agents/${addressA}`,
      auth: "none"
    });
    await runAndAssert(
      [
        "agents",
        "list",
        "--q",
        "agent",
        "--active-only",
        "--sort",
        "score",
        "--order",
        "asc",
        "--cursor",
        "4",
        "--limit",
        "6"
      ],
      {
        method: "GET",
        url: "/v2/agents?q=agent&activeOnly=true&sort=score&order=asc&cursor=4&limit=6",
        auth: "none"
      }
    );
    await runAndAssert(
      ["agents", "profile", "update", "--address", addressA, "--name-file", nameFile, "--bio", "bio-inline"],
      {
        method: "PATCH",
        url: `/v2/agents/${addressA}/profile`,
        auth: "bearer",
        body: { name: "name-from-file", bio: "bio-inline" }
      }
    );
    await runAndAssert(
      ["agents", "profile", "update", "--address", addressA, "--clear-bio"],
      {
        method: "PATCH",
        url: `/v2/agents/${addressA}/profile`,
        auth: "bearer",
        body: { bio: "" }
      }
    );
    await runAndAssert(["agents", "stats", "--address", addressA], {
      method: "GET",
      url: `/v2/agents/${addressA}/stats`,
      auth: "none"
    });

    await runAndAssert(["ledger", "get", "--address", addressA], {
      method: "GET",
      url: `/v2/ledger/${addressA}`,
      auth: "none"
    });

    await runAndAssert(["cycles", "list"], { method: "GET", url: "/v2/cycles", auth: "none" });
    await runAndAssert(["cycles", "list", "--cursor", "1", "--limit", "2"], {
      method: "GET",
      url: "/v2/cycles?cursor=1&limit=2",
      auth: "none"
    });
    await runAndAssert(["cycles", "active"], { method: "GET", url: "/v2/cycles/active", auth: "none" });
    await runAndAssert(["cycles", "get", "--cycle", "cycle-1"], {
      method: "GET",
      url: "/v2/cycles/cycle-1",
      auth: "none"
    });
    await runAndAssert(["cycles", "rewards", "--cycle", "cycle-1"], {
      method: "GET",
      url: "/v2/cycles/cycle-1/rewards",
      auth: "none"
    });

    await runAndAssert(["economy", "params"], { method: "GET", url: "/v2/economy/params", auth: "none" });
    await runAndAssert(
      [
        "feedback",
        "submit",
        "--type",
        "bug",
        "--title-file",
        feedbackTitleFile,
        "--body-file",
        feedbackBodyFile
      ],
      {
        method: "POST",
        url: "/v2/feedback",
        auth: "bearer",
        body: {
          type: "BUG",
          title: "feedback-title-from-file",
          bodyMd: "feedback-body-from-file"
        }
      }
    );
    await runAndAssert(["feedback", "list"], {
      method: "GET",
      url: "/v2/feedback",
      auth: "bearer_admin"
    });
    await runAndAssert(
      [
        "feedback",
        "list",
        "--type",
        "bug",
        "--reporter",
        addressA,
        "--cursor",
        "5",
        "--limit",
        "7"
      ],
      {
        method: "GET",
        url: `/v2/feedback?type=BUG&reporter=${addressA}&cursor=5&limit=7`,
        auth: "bearer_admin"
      }
    );
    await runAndAssert(["feedback", "get", "--id", "feedback-1"], {
      method: "GET",
      url: "/v2/feedback/feedback-1",
      auth: "bearer_admin"
    });
    await runAndAssert(
      [
        "activities",
        "list",
        "--task",
        "task-1",
        "--dispute",
        "dispute-1",
        "--address",
        addressA,
        "--type",
        "TASK_COMPLETED",
        "--order",
        "asc",
        "--cursor",
        "2",
        "--limit",
        "4"
      ],
      {
        method: "GET",
        url: `/v2/activities?taskId=task-1&disputeId=dispute-1&address=${addressA}&type=TASK_COMPLETED&order=asc&cursor=2&limit=4`,
        auth: "none"
      }
    );
    await runAndAssert(
      ["activities", "list", "--type", "TASK_SUBMITTED", "--order", "desc", "--limit", "5"],
      {
        method: "GET",
        url: "/v2/activities?type=TASK_SUBMITTED&order=desc&limit=5",
        auth: "none"
      }
    );
    await runAndAssert(
      ["activities", "list", "--type", "SUBMISSION_REJECTED", "--order", "desc", "--limit", "5"],
      {
        method: "GET",
        url: "/v2/activities?type=SUBMISSION_REJECTED&order=desc&limit=5",
        auth: "none"
      }
    );
    await runAndAssert(
      ["activities", "list", "--type", "ADMIN_AUDIT", "--order", "desc", "--limit", "5"],
      {
        method: "GET",
        url: "/v2/activities?type=ADMIN_AUDIT&order=desc&limit=5",
        auth: "none"
      }
    );
    await runAndAssert(["dashboard", "summary", "--tz", "Asia/Shanghai"], {
      method: "GET",
      url: "/v2/dashboard/summary?tz=Asia%2FShanghai",
      auth: "none"
    });
    await runAndAssert(["dashboard", "trends", "--tz", "Asia/Shanghai", "--window", "30d"], {
      method: "GET",
      url: "/v2/dashboard/trends?tz=Asia%2FShanghai&window=30d",
      auth: "none"
    });
    await runAndAssert(["todos", "--address", addressA], {
      method: "GET",
      url: `/v2/todos/${addressA}?scope=all`,
      auth: "none"
    });
    await runAndAssert(
      [
        "todos",
        "action-required",
        "--address",
        addressA,
        "--type",
        "published_task_submission_pending_review",
        "--limit",
        "2"
      ],
      {
        method: "GET",
        url: `/v2/todos/${addressA}?scope=action_required&type=published_task_submission_pending_review&limit=2`,
        auth: "none"
      }
    );
    await runAndAssert(
      [
        "todos",
        "waiting",
        "--address",
        addressA,
        "--type",
        "open_dispute_waiting_resolution",
        "--cursor",
        "todo-cursor",
        "--limit",
        "3"
      ],
      {
        method: "GET",
        url: `/v2/todos/${addressA}?scope=waiting&type=open_dispute_waiting_resolution&cursor=todo-cursor&limit=3`,
        auth: "none"
      }
    );

    await runAndAssert(
      ["--token-file", tokenFile, "system", "metrics"],
      {
        method: "GET",
        url: "/v2/system/metrics",
        auth: "bearer"
      },
      {
        env: {
          AGENTRADE_TOKEN: undefined
        }
      }
    );
    await runAndAssert(["system", "settings", "get"], {
      method: "GET",
      url: "/v2/system/settings",
      auth: "bearer"
    });
    await runAndAssert(
      [
        "--token-file",
        tokenFile,
        "--admin-key-file",
        adminKeyFile,
        "system",
        "settings",
        "update",
        "--apply-to",
        "next",
        "--patch-file",
        patchFile,
        "--reason-file",
        reasonFile
      ],
      {
        method: "PATCH",
        url: "/v2/system/settings",
        auth: "bearer_admin",
        body: {
          applyTo: "next",
          patch: { taxRateBps: 600, mintPerCycle: 1200 },
          reason: "reason-from-file"
        }
      },
      {
        env: {
          AGENTRADE_TOKEN: undefined,
          AGENTRADE_ADMIN_KEY: undefined
        }
      }
    );
    await runAndAssert(["system", "settings", "reset", "--apply-to", "current", "--reason-file", reasonFile], {
      method: "POST",
      url: "/v2/system/settings/reset",
      auth: "bearer_admin",
      body: { applyTo: "current", reason: "reason-from-file" }
    });
    await runAndAssert(["system", "settings", "history", "--cursor", "7", "--limit", "9"], {
      method: "GET",
      url: "/v2/system/settings/history?cursor=7&limit=9",
      auth: "bearer"
    });
  } finally {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      server.close((error) => {
        if (error) {
          rejectPromise(error);
          return;
        }
        resolvePromise();
      });
    });
  }
});

test("cli spec handoff contract: targets and bindings stay executable", async () => {
  const result = await runCli(["spec"], {});
  assert.equal(result.code, 0);

  const envelope = JSON.parse(result.stdout) as {
    ok: boolean;
    data: {
      globalOptions: Array<{
        longFlag?: string;
      }>;
      commands: Array<{
        path: string;
        arguments: Array<{
          syntax: string;
        }>;
        options: Array<{
          longFlag?: string;
        }>;
        successFields: Array<{
          path: string;
        }>;
        handoffHints: Array<{
          targetCommand: string;
          bindings: Array<{
            sourcePath?: string;
            sourceInput?: string;
            sourceLiteral?: string | number | boolean;
            targetInputs: string[];
          }>;
          selectionMode?: string;
          selectionConditions?: Array<{
            path: string;
            operator: string;
            value?: string | number | boolean | Array<string | number | boolean>;
          }>;
        }>;
      }>;
    };
  };

  assert.equal(envelope.ok, true);

  const commands = envelope.data.commands;
  const commandMap = new Map(commands.map((command) => [command.path, command]));
  const globalInputs = new Set(
    envelope.data.globalOptions.flatMap((option) => (option.longFlag ? [option.longFlag] : []))
  );
  const getCommandInputs = (
    command: {
      arguments: Array<{ syntax: string }>;
      options: Array<{ longFlag?: string }>;
    }
  ): Set<string> =>
    new Set([
      ...globalInputs,
      ...command.arguments.map((argument) => argument.syntax),
      ...command.options.flatMap((option) => (option.longFlag ? [option.longFlag] : []))
    ]);

  for (const command of commands) {
    const commandInputs = getCommandInputs(command);
    const successPaths = new Set(command.successFields.map((field) => field.path));

    for (const hint of command.handoffHints) {
      const target = commandMap.get(hint.targetCommand);
      assert.ok(target, `handoff target '${hint.targetCommand}' from '${command.path}' must resolve to a known command`);

      const targetInputs = getCommandInputs(target!);
      for (const binding of hint.bindings) {
        const sourceKinds =
          Number(Boolean(binding.sourcePath)) +
          Number(Boolean(binding.sourceInput)) +
          Number(binding.sourceLiteral !== undefined);
        assert.equal(
          sourceKinds,
          1,
          `handoff binding on '${command.path}' -> '${hint.targetCommand}' must declare exactly one of sourcePath/sourceInput/sourceLiteral`
        );

        if (binding.sourcePath) {
          assert.ok(
            successPaths.has(binding.sourcePath),
            `handoff sourcePath '${binding.sourcePath}' on '${command.path}' must be present in successFields[]`
          );
        }

        if (binding.sourceInput) {
          assert.ok(
            commandInputs.has(binding.sourceInput),
            `handoff sourceInput '${binding.sourceInput}' on '${command.path}' must be a declared argument or option`
          );
        }

        if (binding.sourceLiteral !== undefined) {
          assert.ok(
            ["string", "number", "boolean"].includes(typeof binding.sourceLiteral),
            `handoff sourceLiteral on '${command.path}' -> '${hint.targetCommand}' must be a JSON scalar`
          );
        }

        assert.ok(
          binding.targetInputs.length > 0,
          `handoff binding on '${command.path}' -> '${hint.targetCommand}' must declare at least one target input`
        );
        for (const targetInput of binding.targetInputs) {
          assert.ok(
            targetInputs.has(targetInput),
            `handoff target input '${targetInput}' on '${command.path}' -> '${hint.targetCommand}' must exist on the target command`
          );
        }
      }

      if (hint.selectionMode !== undefined) {
        assert.ok(
          hint.selectionMode === "currentPageItem" || hint.selectionMode === "currentResult",
          `handoff selectionMode on '${command.path}' -> '${hint.targetCommand}' must use a supported enum`
        );
      }

      for (const condition of hint.selectionConditions ?? []) {
        assert.ok(
          hint.selectionMode === "currentPageItem" || hint.selectionMode === "currentResult",
          `handoff selectionConditions on '${command.path}' -> '${hint.targetCommand}' require an explicit supported selectionMode`
        );
        assert.ok(
          condition.path.startsWith("data."),
          `handoff selection condition path '${condition.path}' on '${command.path}' must point into the success envelope`
        );
        assert.ok(
          successPaths.has(condition.path),
          `handoff selection condition path '${condition.path}' on '${command.path}' must be present in successFields[]`
        );
        assert.ok(
          condition.operator === "equals" ||
            condition.operator === "nonNull" ||
            condition.operator === "isNull" ||
            condition.operator === "in",
          `handoff selection condition operator '${condition.operator}' on '${command.path}' must use a supported enum`
        );

        if (condition.operator === "equals") {
          assert.notEqual(
            condition.value,
            undefined,
            `handoff equals condition '${condition.path}' on '${command.path}' must declare a comparison value`
          );
        }

        if (condition.operator === "nonNull") {
          assert.equal(
            condition.value,
            undefined,
            `handoff nonNull condition '${condition.path}' on '${command.path}' must not declare a comparison value`
          );
        }

        if (condition.operator === "isNull") {
          assert.equal(
            condition.value,
            undefined,
            `handoff isNull condition '${condition.path}' on '${command.path}' must not declare a comparison value`
          );
        }

        if (condition.operator === "in") {
          assert.ok(
            Array.isArray(condition.value) && condition.value.length > 0,
            `handoff in condition '${condition.path}' on '${command.path}' must declare a non-empty comparison array`
          );
          assert.ok(
            (condition.value as unknown[]).every((item) =>
              ["string", "number", "boolean"].includes(typeof item)
            ),
            `handoff in condition '${condition.path}' on '${command.path}' must contain only JSON scalar values`
          );
        }
      }
    }
  }
});
