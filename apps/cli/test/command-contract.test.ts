import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import type { IncomingHttpHeaders } from "node:http";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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

    const routeKey = `${request.method ?? "GET"} ${request.url ?? "/"}`;
    response.setHeader("content-type", "application/json");

    switch (routeKey) {
      case "GET /health":
        response.end(JSON.stringify({ ok: true, service: "mock-agentrade" }));
        return;
      case "POST /v1/auth/challenge":
        response.end(JSON.stringify({ nonce: "nonce-1", message: "mock-message" }));
        return;
      case "POST /v1/auth/verify":
        response.end(JSON.stringify({ token: "jwt-token" }));
        return;
      case "GET /v1/tasks":
        response.end(JSON.stringify({ items: [] }));
        return;
      case `GET /v1/tasks?q=task&status=OPEN&publisher=${addressA}&sort=reward&order=asc&cursor=2&limit=5`:
        response.end(JSON.stringify({ items: [], nextCursor: null }));
        return;
      case "GET /v1/tasks/task-1":
        response.end(JSON.stringify({ id: "task-1", status: "OPEN" }));
        return;
      case "POST /v1/tasks":
        response.end(JSON.stringify({ id: "task-created" }));
        return;
      case "POST /v1/tasks/task-1/accept":
        response.end(JSON.stringify({ id: "task-1", status: "IN_PROGRESS" }));
        return;
      case "POST /v1/tasks/task-1/submissions":
        response.end(JSON.stringify({ id: "submission-1" }));
        return;
      case "POST /v1/tasks/task-1/terminate":
        response.end(JSON.stringify({ id: "task-1", status: "TERMINATED" }));
        return;
      case "POST /v1/submissions/submission-1/confirm":
        response.end(JSON.stringify({ id: "submission-1", status: "CONFIRMED" }));
        return;
      case "POST /v1/submissions/submission-1/reject":
        response.end(JSON.stringify({ id: "submission-1", status: "REJECTED" }));
        return;
      case "GET /v1/disputes":
        response.end(JSON.stringify({ items: [] }));
        return;
      case `GET /v1/disputes?taskId=task-1&opener=${addressA}&status=OPEN&q=dispute&sort=created&order=asc&cursor=1&limit=3`:
        response.end(JSON.stringify({ items: [], nextCursor: null }));
        return;
      case "GET /v1/disputes/dispute-1":
        response.end(JSON.stringify({ id: "dispute-1" }));
        return;
      case "POST /v1/disputes":
        response.end(JSON.stringify({ id: "dispute-opened" }));
        return;
      case "POST /v1/disputes/dispute-1/votes":
        response.end(JSON.stringify({ disputeId: "dispute-1", vote: "COMPLETED" }));
        return;
      case `GET /v1/agents/${addressA}`:
        response.end(JSON.stringify({ address: addressA }));
        return;
      case `GET /v1/agents?q=agent&activeOnly=true&sort=score&order=asc&cursor=4&limit=6`:
        response.end(JSON.stringify({ items: [], nextCursor: null }));
        return;
      case `PATCH /v1/agents/${addressA}/profile`:
        response.end(JSON.stringify({ address: addressA }));
        return;
      case `GET /v1/agents/${addressA}/stats`:
        response.end(JSON.stringify({ tasksPublished: 1 }));
        return;
      case `GET /v1/activities?taskId=task-1&disputeId=dispute-1&address=${addressA}&type=TASK_COMPLETED&order=asc&cursor=2&limit=4`:
        response.end(JSON.stringify({ items: [], nextCursor: null }));
        return;
      case "GET /v1/dashboard/summary?tz=Asia%2FShanghai":
        response.end(JSON.stringify({ today: {}, currentCycle: {}, totals: {} }));
        return;
      case "GET /v1/dashboard/trends?tz=Asia%2FShanghai&window=30d":
        response.end(JSON.stringify({ window: "30d", points: [] }));
        return;
      case `GET /v1/ledger/${addressA}`:
        response.end(JSON.stringify({ available: 10 }));
        return;
      case "GET /v1/cycles":
        response.end(JSON.stringify({ items: [{ id: "cycle-1" }] }));
        return;
      case "GET /v1/cycles/active":
        response.end(JSON.stringify({ id: "cycle-1" }));
        return;
      case "GET /v1/cycles/cycle-1":
        response.end(JSON.stringify({ id: "cycle-1" }));
        return;
      case "GET /v1/cycles/cycle-1/rewards":
        response.end(JSON.stringify({ cycle: { id: "cycle-1" }, workloads: [] }));
        return;
      case "GET /v1/economy/params":
        response.end(JSON.stringify({ taxRateBps: 500 }));
        return;
      case "POST /v1/admin/cycles/close":
        response.end(JSON.stringify({ closedCycleId: "cycle-1", openedCycleId: "cycle-2" }));
        return;
      case "POST /v1/admin/disputes/dispute-1/override":
        response.end(JSON.stringify({ id: "dispute-1", status: "RESOLVED" }));
        return;
      case "POST /v1/admin/bridge/export":
        response.end(JSON.stringify({ exports: [{ address: addressA }, { address: addressB }] }));
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
    assert.equal(call.url, expected.url);
    assertAuth(call.headers, expected.auth);
    if (expected.body === undefined) {
      assert.equal(call.body, null);
    } else {
      assert.deepEqual(call.body, expected.body);
    }
  };

  try {
    await runAndAssert(["--pretty", "system", "health"], { method: "GET", url: "/health", auth: "none" }, { pretty: true });

    await runAndAssert(["auth", "challenge", "--address", addressA], {
      method: "POST",
      url: "/v1/auth/challenge",
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
        url: "/v1/auth/verify",
        auth: "none",
        body: {
          address: addressA,
          nonce: "nonce-1",
          signature: "sig-1",
          message: "message-from-file"
        }
      }
    );

    await runAndAssert(["tasks", "list"], { method: "GET", url: "/v1/tasks", auth: "none" });
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
        url: `/v1/tasks?q=task&status=OPEN&publisher=${addressA}&sort=reward&order=asc&cursor=2&limit=5`,
        auth: "none"
      }
    );
    await runAndAssert(["tasks", "get", "--task", "task-1"], { method: "GET", url: "/v1/tasks/task-1", auth: "none" });

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
        url: "/v1/tasks",
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

    await runAndAssert(["tasks", "accept", "--task", "task-1"], {
      method: "POST",
      url: "/v1/tasks/task-1/accept",
      auth: "bearer"
    });
    await runAndAssert(["tasks", "submit", "--task", "task-1", "--payload-file", payloadFile], {
      method: "POST",
      url: "/v1/tasks/task-1/submissions",
      auth: "bearer",
      body: { payloadMd: "payload-from-file" }
    });
    await runAndAssert(["tasks", "terminate", "--task", "task-1"], {
      method: "POST",
      url: "/v1/tasks/task-1/terminate",
      auth: "bearer"
    });

    await runAndAssert(["submissions", "confirm", "--submission", "submission-1"], {
      method: "POST",
      url: "/v1/submissions/submission-1/confirm",
      auth: "bearer"
    });
    await runAndAssert(["submissions", "reject", "--submission", "submission-1"], {
      method: "POST",
      url: "/v1/submissions/submission-1/reject",
      auth: "bearer"
    });

    await runAndAssert(["disputes", "list"], { method: "GET", url: "/v1/disputes", auth: "none" });
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
        url: `/v1/disputes?taskId=task-1&opener=${addressA}&status=OPEN&q=dispute&sort=created&order=asc&cursor=1&limit=3`,
        auth: "none"
      }
    );
    await runAndAssert(["disputes", "get", "--dispute", "dispute-1"], {
      method: "GET",
      url: "/v1/disputes/dispute-1",
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
        url: "/v1/disputes",
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
      url: "/v1/disputes/dispute-1/votes",
      auth: "bearer",
      body: { vote: "COMPLETED" }
    });

    await runAndAssert(["agents", "profile", "get", "--address", addressA], {
      method: "GET",
      url: `/v1/agents/${addressA}`,
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
        url: "/v1/agents?q=agent&activeOnly=true&sort=score&order=asc&cursor=4&limit=6",
        auth: "none"
      }
    );
    await runAndAssert(
      ["agents", "profile", "update", "--address", addressA, "--name-file", nameFile, "--bio", "bio-inline"],
      {
        method: "PATCH",
        url: `/v1/agents/${addressA}/profile`,
        auth: "bearer",
        body: { name: "name-from-file", bio: "bio-inline" }
      }
    );
    await runAndAssert(["agents", "stats", "--address", addressA], {
      method: "GET",
      url: `/v1/agents/${addressA}/stats`,
      auth: "none"
    });

    await runAndAssert(["ledger", "get", "--address", addressA], {
      method: "GET",
      url: `/v1/ledger/${addressA}`,
      auth: "none"
    });

    await runAndAssert(["cycles", "list"], { method: "GET", url: "/v1/cycles", auth: "none" });
    await runAndAssert(["cycles", "active"], { method: "GET", url: "/v1/cycles/active", auth: "none" });
    await runAndAssert(["cycles", "get", "--cycle", "cycle-1"], {
      method: "GET",
      url: "/v1/cycles/cycle-1",
      auth: "none"
    });
    await runAndAssert(["cycles", "rewards", "--cycle", "cycle-1"], {
      method: "GET",
      url: "/v1/cycles/cycle-1/rewards",
      auth: "none"
    });

    await runAndAssert(["economy", "params"], { method: "GET", url: "/v1/economy/params", auth: "none" });
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
        url: `/v1/activities?taskId=task-1&disputeId=dispute-1&address=${addressA}&type=TASK_COMPLETED&order=asc&cursor=2&limit=4`,
        auth: "none"
      }
    );
    await runAndAssert(["dashboard", "summary", "--tz", "Asia/Shanghai"], {
      method: "GET",
      url: "/v1/dashboard/summary?tz=Asia%2FShanghai",
      auth: "none"
    });
    await runAndAssert(["dashboard", "trends", "--tz", "Asia/Shanghai", "--window", "30d"], {
      method: "GET",
      url: "/v1/dashboard/trends?tz=Asia%2FShanghai&window=30d",
      auth: "none"
    });

    await runAndAssert(["admin", "cycles", "close"], {
      method: "POST",
      url: "/v1/admin/cycles/close",
      auth: "admin"
    });
    await runAndAssert(["admin", "disputes", "override", "--dispute", "dispute-1", "--result", "NOT_COMPLETED"], {
      method: "POST",
      url: "/v1/admin/disputes/dispute-1/override",
      auth: "admin",
      body: { result: "NOT_COMPLETED" }
    });
    await runAndAssert(["admin", "bridge", "export", "--addresses-file", addressesFile], {
      method: "POST",
      url: "/v1/admin/bridge/export",
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
