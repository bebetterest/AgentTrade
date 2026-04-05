import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { AddressInfo } from "node:net";
import type { Address } from "@agentrade/types";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../server/src/app.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../../..");
const cliBin = resolve(repoRoot, "apps/cli/node_modules/.bin/tsx");
const cliEntry = resolve(repoRoot, "apps/cli/src/index.ts");

const addr = (seed: string): Address =>
  `0x${Buffer.from(seed).toString("hex").slice(0, 40).padEnd(40, "0")}` as Address;

const base64Url = (value: string): string => Buffer.from(value).toString("base64url");

const signToken = (address: Address, secret: string): string => {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ sub: address, iat: now, exp: now + 3600 }));
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
};

const runCli = async (
  baseUrl: string,
  args: string[],
  env: NodeJS.ProcessEnv = {}
): Promise<{ code: number | null; stdout: string; stderr: string }> => {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(cliBin, [cliEntry, "--base-url", baseUrl, ...args], {
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

const runCliJson = async (
  baseUrl: string,
  args: string[],
  env: NodeJS.ProcessEnv = {}
): Promise<unknown> => {
  const result = await runCli(baseUrl, args, env);
  assert.equal(result.code, 0, `command failed: ${args.join(" ")}\n${result.stderr}`);
  assert.ok(result.stdout.trim().length > 0, "stdout must contain JSON");
  return JSON.parse(result.stdout.trim());
};

test("cli integration: covers lifecycle/read/admin command groups", async () => {
  const oldEnv = { ...process.env };
  const jwtSecret = "cli-test-secret";
  const adminKey = "cli-test-admin-key";

  process.env.JWT_SECRET = jwtSecret;
  process.env.ADMIN_SERVICE_KEY = adminKey;
  process.env.ENABLE_PERSISTENCE = "false";
  process.env.ENABLE_REDIS_RATE_LIMIT = "false";
  process.env.RATE_LIMIT_PER_MINUTE = "10000";
  process.env.RATE_LIMIT_BURST = "10000";
  process.env.VITEST = "true";

  let app: FastifyInstance | null = null;

  try {
    app = await buildApp();
    await app.listen({ host: "127.0.0.1", port: 0 });
    const serverAddress = app.server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${serverAddress.port}`;

    const publisher = addr("cli-publisher-1");
    const worker = addr("cli-worker-1");
    const supervisor = addr("cli-supervisor-1");

    const publisherToken = signToken(publisher, jwtSecret);
    const workerToken = signToken(worker, jwtSecret);
    const supervisorToken = signToken(supervisor, jwtSecret);

    const health = (await runCliJson(baseUrl, ["system", "health"])) as { ok: boolean; service: string };
    assert.equal(health.ok, true);
    assert.equal(health.service, "agentrade-server");

    const challenge = (await runCliJson(baseUrl, ["auth", "challenge", "--address", publisher])) as {
      nonce: string;
      message: string;
    };
    assert.equal(typeof challenge.nonce, "string");
    assert.equal(typeof challenge.message, "string");

    const registered = (await runCliJson(baseUrl, ["auth", "register"])) as {
      wallet: { address: Address; privateKey: string };
      auth: { token: string; expiresIn: string };
      securityNotice: { level: string; message: string };
    };
    assert.match(registered.wallet.address, /^0x[a-fA-F0-9]{40}$/);
    assert.match(registered.wallet.privateKey, /^0x[a-fA-F0-9]{64}$/);
    assert.equal(registered.auth.expiresIn, "15m");
    assert.equal(registered.securityNotice.level, "CRITICAL");
    assert.match(registered.securityNotice.message, /DISPLAYED ONLY ONCE/);

    await runCliJson(
      baseUrl,
      ["agents", "profile", "update", "--address", registered.wallet.address, "--bio", "registered-user"],
      { AGENTRADE_TOKEN: registered.auth.token }
    );
    const registeredProfile = (await runCliJson(
      baseUrl,
      ["agents", "profile", "get", "--address", registered.wallet.address]
    )) as { bio: string };
    assert.equal(registeredProfile.bio, "registered-user");

    const deadline = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const createdTask = (await runCliJson(
      baseUrl,
      [
        "tasks",
        "create",
        "--title",
        "integration-task",
        "--desc",
        "desc",
        "--criteria",
        "criteria",
        "--deadline",
        deadline,
        "--tz",
        "UTC",
        "--slots",
        "1",
        "--reward",
        "10"
      ],
      { AGENTRADE_TOKEN: publisherToken }
    )) as { id: string };

    assert.equal(typeof createdTask.id, "string");

    const listTasks = (await runCliJson(baseUrl, ["tasks", "list"])) as { items: Array<{ id: string }> };
    assert.ok(listTasks.items.some((item) => item.id === createdTask.id));

    const fetchedTask = (await runCliJson(baseUrl, ["tasks", "get", "--task", createdTask.id])) as {
      id: string;
      status: string;
    };
    assert.equal(fetchedTask.id, createdTask.id);

    await runCliJson(baseUrl, ["tasks", "intend", "--task", createdTask.id], {
      AGENTRADE_TOKEN: workerToken
    });

    const submission = (await runCliJson(
      baseUrl,
      ["tasks", "submit", "--task", createdTask.id, "--payload", "worker submission"],
      { AGENTRADE_TOKEN: workerToken }
    )) as { id: string };

    await runCliJson(baseUrl, ["submissions", "reject", "--submission", submission.id], {
      AGENTRADE_TOKEN: publisherToken
    });

    const dispute = (await runCliJson(
      baseUrl,
      [
        "disputes",
        "open",
        "--task",
        createdTask.id,
        "--submission",
        submission.id,
        "--reason",
        "recheck"
      ],
      { AGENTRADE_TOKEN: publisherToken }
    )) as { id: string };

    const disputeList = (await runCliJson(baseUrl, ["disputes", "list"])) as {
      items: Array<{ id: string }>;
    };
    assert.ok(disputeList.items.some((item) => item.id === dispute.id));

    const disputeDetail = (await runCliJson(baseUrl, ["disputes", "get", "--dispute", dispute.id])) as {
      id: string;
    };
    assert.equal(disputeDetail.id, dispute.id);

    await runCliJson(
      baseUrl,
      ["disputes", "vote", "--dispute", dispute.id, "--vote", "COMPLETED"],
      { AGENTRADE_TOKEN: supervisorToken }
    );

    const confirmTask = (await runCliJson(
      baseUrl,
      [
        "tasks",
        "create",
        "--title",
        "confirm-task",
        "--desc",
        "desc",
        "--criteria",
        "criteria",
        "--deadline",
        deadline,
        "--tz",
        "UTC",
        "--slots",
        "1",
        "--reward",
        "5"
      ],
      { AGENTRADE_TOKEN: publisherToken }
    )) as { id: string };

    await runCliJson(baseUrl, ["tasks", "intend", "--task", confirmTask.id], {
      AGENTRADE_TOKEN: workerToken
    });

    const confirmSubmission = (await runCliJson(
      baseUrl,
      ["tasks", "submit", "--task", confirmTask.id, "--payload", "worker result"],
      { AGENTRADE_TOKEN: workerToken }
    )) as { id: string };

    await runCliJson(baseUrl, ["submissions", "confirm", "--submission", confirmSubmission.id], {
      AGENTRADE_TOKEN: publisherToken
    });

    const terminateTask = (await runCliJson(
      baseUrl,
      [
        "tasks",
        "create",
        "--title",
        "terminate-task",
        "--desc",
        "desc",
        "--criteria",
        "criteria",
        "--deadline",
        deadline,
        "--tz",
        "UTC",
        "--slots",
        "1",
        "--reward",
        "5"
      ],
      { AGENTRADE_TOKEN: publisherToken }
    )) as { id: string };

    await runCliJson(baseUrl, ["tasks", "terminate", "--task", terminateTask.id], {
      AGENTRADE_TOKEN: publisherToken
    });

    await runCliJson(baseUrl, ["agents", "profile", "update", "--address", publisher, "--bio", "updated"], {
      AGENTRADE_TOKEN: publisherToken
    });

    const profile = (await runCliJson(baseUrl, ["agents", "profile", "get", "--address", publisher])) as {
      bio: string;
    };
    assert.equal(profile.bio, "updated");

    const stats = (await runCliJson(baseUrl, ["agents", "stats", "--address", publisher])) as {
      tasksPublished: number;
    };
    assert.equal(typeof stats.tasksPublished, "number");

    const ledger = (await runCliJson(baseUrl, ["ledger", "get", "--address", publisher])) as {
      available: number;
    };
    assert.equal(typeof ledger.available, "number");

    const economy = (await runCliJson(baseUrl, ["economy", "params"])) as {
      taxRateBps: number;
      terminationPenaltyBps: number;
      jwtSecret?: string;
      adminServiceKey?: string;
      databaseUrl?: string;
      redisUrl?: string;
      host?: string;
      port?: number;
    };
    assert.equal(typeof economy.taxRateBps, "number");
    assert.equal(typeof economy.terminationPenaltyBps, "number");
    assert.equal("jwtSecret" in economy, false);
    assert.equal("adminServiceKey" in economy, false);
    assert.equal("databaseUrl" in economy, false);
    assert.equal("redisUrl" in economy, false);
    assert.equal("host" in economy, false);
    assert.equal("port" in economy, false);

    const cycles = (await runCliJson(baseUrl, ["cycles", "list"])) as { items: Array<{ id: string }> };
    assert.ok(cycles.items.length >= 1);

    const activeCycle = (await runCliJson(baseUrl, ["cycles", "active"])) as { id: string };
    assert.equal(typeof activeCycle.id, "string");

    const cycleDetail = (await runCliJson(baseUrl, ["cycles", "get", "--cycle", activeCycle.id])) as {
      id: string;
    };
    assert.equal(cycleDetail.id, activeCycle.id);

    const rewards = (await runCliJson(baseUrl, ["cycles", "rewards", "--cycle", activeCycle.id])) as {
      cycle: { id: string };
      workloads: unknown[];
    };
    assert.equal(rewards.cycle.id, activeCycle.id);
    assert.ok(Array.isArray(rewards.workloads));

    const closed = (await runCliJson(baseUrl, ["admin", "cycles", "close"], {
      AGENTRADE_ADMIN_SERVICE_KEY: adminKey
    })) as { closedCycleId: string; openedCycleId: string };
    assert.equal(typeof closed.closedCycleId, "string");
    assert.equal(typeof closed.openedCycleId, "string");

    await runCliJson(baseUrl, ["admin", "disputes", "override", "--dispute", dispute.id, "--result", "COMPLETED"], {
      AGENTRADE_ADMIN_SERVICE_KEY: adminKey
    });

    const bridge = (await runCliJson(
      baseUrl,
      ["admin", "bridge", "export", "--addresses", `${publisher},${worker}`],
      { AGENTRADE_ADMIN_SERVICE_KEY: adminKey }
    )) as {
      exports: Array<{ address: string }>;
    };
    assert.ok(bridge.exports.length >= 2);
  } finally {
    if (app) {
      await app.close();
    }
    process.env = oldEnv;
  }
});

test("cli integration: structured error output", async () => {
  const oldEnv = { ...process.env };
  const jwtSecret = "cli-test-secret-2";

  process.env.JWT_SECRET = jwtSecret;
  process.env.ADMIN_SERVICE_KEY = "cli-admin-key-2";
  process.env.ENABLE_PERSISTENCE = "false";
  process.env.ENABLE_REDIS_RATE_LIMIT = "false";
  process.env.RATE_LIMIT_PER_MINUTE = "10000";
  process.env.RATE_LIMIT_BURST = "10000";
  process.env.VITEST = "true";

  let app: FastifyInstance | null = null;

  try {
    app = await buildApp();
    await app.listen({ host: "127.0.0.1", port: 0 });
    const serverAddress = app.server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${serverAddress.port}`;

    const missingToken = await runCli(baseUrl, ["tasks", "intend", "--task", "task-1"]);
    assert.equal(missingToken.code, 3);
    const missingTokenErr = JSON.parse(missingToken.stderr.trim()) as {
      type: string;
      message: string;
      command: string;
      httpStatus: number | null;
      apiError: string | null;
      retryable: boolean;
    };
    assert.equal(missingTokenErr.type, "CONFIG_ERROR");
    assert.equal(missingTokenErr.command, "tasks intend");
    assert.equal(missingTokenErr.httpStatus, null);
    assert.equal(missingTokenErr.apiError, null);

    const badVoteToken = signToken(addr("bad-voter"), jwtSecret);
    const badVote = await runCli(baseUrl, ["disputes", "vote", "--dispute", "x", "--vote", "BAD"], {
      AGENTRADE_TOKEN: badVoteToken
    });
    assert.equal(badVote.code, 2);
    const badVoteErr = JSON.parse(badVote.stderr.trim()) as { type: string; retryable: boolean };
    assert.equal(badVoteErr.type, "VALIDATION_ERROR");
    assert.equal(badVoteErr.retryable, false);

    const badAddress = addr("bad-address");
    const challenge = (await runCliJson(baseUrl, ["auth", "challenge", "--address", badAddress])) as {
      nonce: string;
      message: string;
    };
    const verifyFail = await runCli(baseUrl, [
      "auth",
      "verify",
      "--address",
      badAddress,
      "--nonce",
      challenge.nonce,
      "--message",
      challenge.message,
      "--signature",
      "0xdeadbeef"
    ]);

    assert.equal(verifyFail.code, 4);
    const verifyErr = JSON.parse(verifyFail.stderr.trim()) as {
      type: string;
      httpStatus: number | null;
      command: string;
    };
    assert.equal(verifyErr.type, "API_ERROR");
    assert.equal(verifyErr.httpStatus, 401);
    assert.equal(verifyErr.command, "auth verify");
  } finally {
    if (app) {
      await app.close();
    }
    process.env = oldEnv;
  }
});
