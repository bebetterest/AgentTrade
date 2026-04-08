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

type AuthMode = "none" | "bearer" | "admin";

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

const runCli = async (args: string[], env: NodeJS.ProcessEnv): Promise<CliResult> => {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(cliBin, [cliEntry, ...args], {
      cwd: repoRoot,
      env: { ...process.env, ...env }
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
  const adminKey = "cli-contract-admin";
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
  const dashboardSummaryPayload = {
    timezone: "Asia/Shanghai",
    generatedAt: now,
    activeCycleId: "cycle-1",
    today: { tasksPublished: 1, tasksIntented: 0, tasksCompleted: 0, disputesOpened: 0 },
    currentCycle: { tasksPublished: 1, tasksIntented: 0, tasksCompleted: 0, disputesOpened: 0 },
    totals: { tasks: 1, disputes: 1, agents: 1 }
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
  const closeCyclePayload = {
    closedCycleId: "cycle-1",
    openedCycleId: "cycle-2",
    rewardPool: 0,
    distributions: [],
    finalizedDisputes: []
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
    disputeReasonMaxLength: 4000,
    taskSlotsMax: 100,
    taskRewardPerSlotMax: 1000000,
    taskDeadlineMaxHours: 4320,
    taxRateBps: 500,
    taxMin: 1,
    rewardMin: 1,
    mintPerCycle: 1000,
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
  const descFile = join(tmpDir, "desc.md");
  const criteriaFile = join(tmpDir, "criteria.md");
  const payloadFile = join(tmpDir, "payload.md");
  const reasonFile = join(tmpDir, "reason.md");
  const nameFile = join(tmpDir, "name.txt");
  const addressesFile = join(tmpDir, "addresses.txt");
  writeFileSync(messageFile, "message-from-file", "utf8");
  writeFileSync(descFile, "desc-from-file", "utf8");
  writeFileSync(criteriaFile, "criteria-from-file", "utf8");
  writeFileSync(payloadFile, "payload-from-file", "utf8");
  writeFileSync(reasonFile, "reason-from-file", "utf8");
  writeFileSync(nameFile, "name-from-file", "utf8");
  writeFileSync(addressesFile, `${addressA},${addressB}\n${addressA}`, "utf8");

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
      case "POST /v2/admin/cycles/close":
        response.end(JSON.stringify(closeCyclePayload));
        return;
      case "POST /v2/admin/disputes/dispute-1/override":
        response.end(JSON.stringify({ ...disputePayload, status: "RESOLVED_COMPLETED" }));
        return;
      case "POST /v2/admin/bridge/export":
        response.end(
          JSON.stringify({
            chain: "base-sepolia",
            mode: "OFFCHAIN_EXPORT_ONLY",
            exports: [
              { address: addressA, amount: 1 },
              { address: addressB, amount: 2 }
            ]
          })
        );
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
    AGENTRADE_ADMIN_SERVICE_KEY: adminKey
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
    assert.equal(headers["x-admin-service-key"], adminKey);
    assert.equal(headers.authorization, undefined);
  };

  const runAndAssert = async (
    args: string[],
    expected: ExpectedRequest,
    options: { pretty?: boolean } = {}
  ): Promise<void> => {
    const beforeCalls = calls.length;
    const result = await runCli(["--base-url", baseUrl, ...args], baseEnv);
    assert.equal(result.code, 0, `command failed: ${args.join(" ")}\n${result.stderr}`);
    assert.equal(calls.length, beforeCalls + 1, `request count mismatch for ${args.join(" ")}`);

    const parsed = JSON.parse(result.stdout.trim()) as unknown;
    assert.equal(typeof parsed, "object");
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
        "--signature",
        "sig-1",
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
          signature: "sig-1",
          message: "message-from-file"
        }
      }
    );

    const beforeRegisterCalls = calls.length;
    const registerResult = await runCli(["--base-url", baseUrl, "auth", "register"], baseEnv);
    assert.equal(registerResult.code, 0, `command failed: auth register\n${registerResult.stderr}`);
    assert.equal(calls.length, beforeRegisterCalls + 2, "auth register must trigger challenge + verify");

    const registerOutput = JSON.parse(registerResult.stdout.trim()) as {
      wallet: { address: string; privateKey: string };
      auth: { token: string; expiresIn: string };
      securityNotice: { level: string; message: string };
    };
    assert.match(registerOutput.wallet.address, /^0x[a-fA-F0-9]{40}$/);
    assert.match(registerOutput.wallet.privateKey, /^0x[a-fA-F0-9]{64}$/);
    assert.equal(registerOutput.auth.token, "jwt-token");
    assert.equal(registerOutput.auth.expiresIn, "15m");
    assert.equal(registerOutput.securityNotice.level, "CRITICAL");
    assert.match(registerOutput.securityNotice.message, /DISPLAYED ONLY ONCE/);
    assert.match(registerOutput.securityNotice.message, /NEVER SHARE/);

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
        "--title",
        "contract-task",
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
          title: "contract-task",
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
    await runAndAssert(["submissions", "reject", "--submission", "submission-1"], {
      method: "POST",
      url: "/v2/submissions/submission-1/reject",
      auth: "bearer"
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

    await runAndAssert(["admin", "cycles", "close"], {
      method: "POST",
      url: "/v2/admin/cycles/close",
      auth: "admin"
    });
    await runAndAssert(["admin", "disputes", "override", "--dispute", "dispute-1", "--result", "NOT_COMPLETED"], {
      method: "POST",
      url: "/v2/admin/disputes/dispute-1/override",
      auth: "admin",
      body: { result: "NOT_COMPLETED" }
    });
    await runAndAssert(["admin", "bridge", "export", "--addresses-file", addressesFile], {
      method: "POST",
      url: "/v2/admin/bridge/export",
      auth: "admin",
      body: { addresses: [addressA, addressB] }
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
