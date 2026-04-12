import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import type { Address } from "@agentrade/types";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../server/src/app.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const REQUIRE_DB_URL = process.env.REQUIRE_TEST_DATABASE_URL === "true";
if (REQUIRE_DB_URL && !TEST_DB_URL) {
  throw new Error(
    "TEST_DATABASE_URL is required when REQUIRE_TEST_DATABASE_URL=true. " +
      "Set TEST_DATABASE_URL explicitly or run Docker-backed DB scripts."
  );
}
const runDbSuite = TEST_DB_URL ? test : test.skip;
const RUN_HEX = `${Date.now().toString(16)}${process.pid.toString(16)}`;
const RUN_OFFSET = BigInt(`0x${RUN_HEX.slice(0, 16) || "1"}`);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../../..");
const cliBin = resolve(repoRoot, "apps/cli/node_modules/.bin/tsx");
const cliEntry = resolve(repoRoot, "apps/cli/src/index.ts");
const testConfigPath = join(tmpdir(), `agentrade-cli-persistence-${process.pid}.json`);

interface CliRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface CliErrorPayload {
  type: string;
  message: string;
  httpStatus: number | null;
  apiError: string | null;
  retryable: boolean;
  command: string;
}

interface PersistenceContext {
  secret: string;
}

const addr = (seed: string): Address =>
  `0x${createHash("sha256").update(`${RUN_HEX}-${seed}`).digest("hex").slice(0, 40)}` as Address;

const indexedAddr = (offset: number, index: number): Address =>
  `0x${(RUN_OFFSET * 1_000_000n + BigInt(offset) + BigInt(index) + 1n).toString(16).padStart(40, "0")}` as Address;

const base64Url = (value: string): string => Buffer.from(value).toString("base64url");

const signToken = (address: Address, secret: string): string => {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ sub: address, iat: now, exp: now + 3600 }));
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
};

const hasOption = (args: string[], option: string): boolean =>
  args.includes(option) || args.some((arg) => arg.startsWith(`${option}=`));

const runCli = async (
  baseUrl: string,
  args: string[],
  env: NodeJS.ProcessEnv = {}
): Promise<CliRunResult> => {
  const globalArgs: string[] = [];
  if (env.AGENTRADE_TOKEN && !hasOption(args, "--token")) {
    globalArgs.push("--token", env.AGENTRADE_TOKEN);
  }

  const childEnv = { ...process.env, ...env };
  delete childEnv.AGENTRADE_TOKEN;
  if (!childEnv.AGENTRADE_CLI_CONFIG_PATH) {
    childEnv.AGENTRADE_CLI_CONFIG_PATH = testConfigPath;
  }

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(cliBin, [cliEntry, "--base-url", baseUrl, ...globalArgs, ...args], {
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

const parseCliError = (result: CliRunResult): CliErrorPayload => {
  assert.ok(result.stderr.trim().length > 0, "stderr must contain structured error JSON");
  return JSON.parse(result.stderr.trim()) as CliErrorPayload;
};

const ensureServerRuntimeSecretsForCliTests = (): void => {
  if (
    !process.env.JWT_SECRET ||
    process.env.JWT_SECRET.trim().length === 0 ||
    process.env.JWT_SECRET === "replace-this-secret"
  ) {
    process.env.JWT_SECRET = "cli-persistence-fallback-jwt-secret";
  }
  if (
    !process.env.ADMIN_SERVICE_KEY ||
    process.env.ADMIN_SERVICE_KEY.trim().length === 0 ||
    process.env.ADMIN_SERVICE_KEY === "replace-this-admin-key"
  ) {
    process.env.ADMIN_SERVICE_KEY = "cli-persistence-fallback-admin-key";
  }
};

const startApp = async (): Promise<{ app: FastifyInstance; baseUrl: string }> => {
  ensureServerRuntimeSecretsForCliTests();
  const app = await buildApp();
  await app.listen({ host: "127.0.0.1", port: 0 });
  const serverAddress = app.server.address() as AddressInfo;
  return {
    app,
    baseUrl: `http://127.0.0.1:${serverAddress.port}`
  };
};

const closeApp = async (app: FastifyInstance | null): Promise<void> => {
  if (app) {
    await app.close();
  }
};

const forceAutoCloseCurrentCycle = async (
  baseUrl: string
): Promise<{ closedCycleId: string; openedCycleId: string }> => {
  const activeBefore = (await runCliJson(baseUrl, ["cycles", "active"])) as { id: string };
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: TEST_DB_URL!
      }
    }
  });
  await prisma.cycle.update({
    where: { id: activeBefore.id },
    data: { startedAt: new Date(Date.now() - 8 * 24 * 3_600_000) }
  });
  await prisma.$disconnect();

  const activeAfter = (await runCliJson(baseUrl, ["cycles", "active"])) as { id: string };
  assert.notEqual(activeAfter.id, activeBefore.id);
  return { closedCycleId: activeBefore.id, openedCycleId: activeAfter.id };
};

const withPersistenceEnvironment = async (
  fn: (context: PersistenceContext) => Promise<void>
): Promise<void> => {
  const oldEnv = { ...process.env };
  const secret = "cli-persistence-stress-secret";
  const adminServiceKey = "cli-persistence-stress-admin-key";

  try {
    process.env.JWT_SECRET = secret;
    process.env.ADMIN_SERVICE_KEY = adminServiceKey;
    process.env.ENABLE_PERSISTENCE = "true";
    process.env.ENABLE_REDIS_RATE_LIMIT = "false";
    process.env.RATE_LIMIT_PER_MINUTE = "100000";
    process.env.RATE_LIMIT_BURST = "100000";
    process.env.DATABASE_URL = TEST_DB_URL;
    process.env.TEST_DATABASE_URL = TEST_DB_URL;
    process.env.VITEST = "true";
    await fn({ secret });
  } finally {
    process.env = oldEnv;
  }
};

const createTask = async (
  baseUrl: string,
  publisherToken: string,
  title: string,
  slots: number,
  reward: number
): Promise<{ id: string }> => {
  return (await runCliJson(
    baseUrl,
    [
      "tasks",
      "create",
      "--title",
      title,
      "--desc",
      "desc",
      "--criteria",
      "criteria",
      "--deadline",
      new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      "--tz",
      "UTC",
      "--slots",
      String(slots),
      "--reward",
      String(reward)
    ],
    { AGENTRADE_TOKEN: publisherToken }
  )) as { id: string };
};

const createRejectedSubmission = async (
  baseUrl: string,
  publisherToken: string,
  workerToken: string,
  title: string
): Promise<{ taskId: string; submissionId: string }> => {
  const task = await createTask(baseUrl, publisherToken, title, 1, 6);
  await runCliJson(baseUrl, ["tasks", "intend", "--task", task.id], {
    AGENTRADE_TOKEN: workerToken
  });
  const submission = (await runCliJson(
    baseUrl,
    ["tasks", "submit", "--task", task.id, "--payload", "result"],
    { AGENTRADE_TOKEN: workerToken }
  )) as { id: string };
  await runCliJson(baseUrl, ["submissions", "reject", "--submission", submission.id, "--reason", "needs fixes"], {
    AGENTRADE_TOKEN: publisherToken
  });
  return { taskId: task.id, submissionId: submission.id };
};

let sequence: Promise<void> = Promise.resolve();
const runSequentially = async (fn: () => Promise<void>): Promise<void> => {
  const next = sequence.then(fn, fn);
  sequence = next.then(
    () => undefined,
    () => undefined
  );
  return next;
};

runDbSuite(
  "cli persistence: concurrent intentions remain deterministic",
  { timeout: 180_000 },
  async () =>
    runSequentially(async () => {
      await withPersistenceEnvironment(async ({ secret }) => {
        let app: FastifyInstance | null = null;
        try {
          const started = await startApp();
          app = started.app;
          const baseUrl = started.baseUrl;

          const publisher = addr("cli-persist-publisher-intend");
          const publisherToken = signToken(publisher, secret);
          const createdTask = await createTask(baseUrl, publisherToken, "cli-persist-intend-race", 6, 5);

          const workerAddresses = Array.from({ length: 24 }, (_, index) => indexedAddr(80_000, index));
          const intendResults = await Promise.all(
            workerAddresses.map((worker) =>
              runCli(baseUrl, ["tasks", "intend", "--task", createdTask.id], {
                AGENTRADE_TOKEN: signToken(worker, secret)
              })
            )
          );

          const intendSuccess = intendResults.filter((item) => item.code === 0);
          const intendFailures = intendResults.filter((item) => item.code !== 0);
          assert.equal(intendSuccess.length, workerAddresses.length);
          assert.equal(intendFailures.length, 0);

          const intendedTask = (await runCliJson(baseUrl, ["tasks", "get", "--task", createdTask.id])) as {
            intentCount: number;
            competitionRatio: number;
          };
          assert.equal(intendedTask.intentCount, workerAddresses.length);
          assert.equal(intendedTask.competitionRatio, 4);
        } finally {
          await closeApp(app);
        }
      });
    })
);

runDbSuite(
  "cli persistence: concurrent high-cost publish prevents overspend",
  { timeout: 180_000 },
  async () =>
    runSequentially(async () => {
      await withPersistenceEnvironment(async ({ secret }) => {
        let app: FastifyInstance | null = null;
        try {
          const started = await startApp();
          app = started.app;
          const baseUrl = started.baseUrl;

          const publisher = addr("cli-persist-publisher-budget");
          const publisherToken = signToken(publisher, secret);

          const beforePublishLedger = (await runCliJson(baseUrl, ["ledger", "get", "--address", publisher])) as {
            available: number;
          };
          assert.ok(beforePublishLedger.available > 0, "publisher should have positive initial balance");
          const rewardForRace = Math.max(1, Math.floor(beforePublishLedger.available / 8));

          const highCostPublishAttempts = await Promise.all(
            Array.from({ length: 20 }).map(() =>
              runCli(
                baseUrl,
                [
                  "tasks",
                  "create",
                  "--title",
                  "cli-persist-budget-race",
                  "--desc",
                  "budget check",
                  "--criteria",
                  "criteria",
                  "--deadline",
                  new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
                  "--tz",
                  "UTC",
                  "--slots",
                  "1",
                  "--reward",
                  String(rewardForRace)
                ],
                { AGENTRADE_TOKEN: publisherToken }
              )
            )
          );

          const publishSuccess = highCostPublishAttempts.filter((item) => item.code === 0);
          const publishFailures = highCostPublishAttempts.filter((item) => item.code !== 0);
          assert.ok(publishSuccess.length > 0, "expected at least one successful publish");
          assert.ok(publishFailures.length > 0, "expected insufficient-balance publish conflicts");

          const samplePublishedTask = JSON.parse(publishSuccess[0]!.stdout.trim()) as {
            rewardEscrowRemaining: number;
            taxAmount: number;
          };
          const perTaskCost = samplePublishedTask.rewardEscrowRemaining + samplePublishedTask.taxAmount;
          assert.ok(perTaskCost > 0);

          const maxAffordablePublishes = Math.floor(beforePublishLedger.available / perTaskCost);
          assert.equal(publishSuccess.length, maxAffordablePublishes);
          assert.equal(publishFailures.length, 20 - maxAffordablePublishes);

          for (const failure of publishFailures) {
            assert.equal(failure.code, 4, `unexpected exit code for publish race: ${failure.stderr}`);
            const errorPayload = parseCliError(failure);
            assert.equal(errorPayload.type, "API_ERROR");
            assert.equal(errorPayload.apiError, "INSUFFICIENT_BALANCE");
            assert.equal(errorPayload.command, "tasks create");
          }

          const afterPublishLedger = (await runCliJson(baseUrl, ["ledger", "get", "--address", publisher])) as {
            available: number;
          };
          assert.equal(afterPublishLedger.available, beforePublishLedger.available - publishSuccess.length * perTaskCost);
          assert.ok(afterPublishLedger.available >= 0);
        } finally {
          await closeApp(app);
        }
      });
    })
);

runDbSuite(
  "cli persistence: duplicate vote race allows exactly one success",
  { timeout: 180_000 },
  async () =>
    runSequentially(async () => {
      await withPersistenceEnvironment(async ({ secret }) => {
        let app: FastifyInstance | null = null;
        try {
          const started = await startApp();
          app = started.app;
          const baseUrl = started.baseUrl;

          const publisher = addr("cli-persist-publisher-vote");
          const worker = addr("cli-persist-worker-vote");
          const supervisor = addr("cli-persist-supervisor-vote");
          const publisherToken = signToken(publisher, secret);
          const workerToken = signToken(worker, secret);
          const supervisorToken = signToken(supervisor, secret);

          const flow = await createRejectedSubmission(
            baseUrl,
            publisherToken,
            workerToken,
            "cli-persist-vote-race"
          );

          const dispute = (await runCliJson(
            baseUrl,
            [
              "disputes",
              "open",
              "--task",
              flow.taskId,
              "--submission",
              flow.submissionId,
              "--reason",
              "review"
            ],
            { AGENTRADE_TOKEN: publisherToken }
          )) as { id: string };

          const voteAttempts = await Promise.all(
            Array.from({ length: 20 }).map(() =>
              runCli(baseUrl, ["disputes", "vote", "--dispute", dispute.id, "--vote", "COMPLETED"], {
                AGENTRADE_TOKEN: supervisorToken
              })
            )
          );

          const voteSuccess = voteAttempts.filter((item) => item.code === 0);
          const voteFailures = voteAttempts.filter((item) => item.code !== 0);
          assert.equal(voteSuccess.length, 1);
          assert.equal(voteFailures.length, 19);

          for (const failure of voteFailures) {
            assert.equal(failure.code, 4, `unexpected exit code for vote race: ${failure.stderr}`);
            const errorPayload = parseCliError(failure);
            assert.equal(errorPayload.type, "API_ERROR");
            assert.ok(
              errorPayload.apiError === "DUPLICATE_SUPERVISION_PARTICIPATION" ||
                errorPayload.apiError === "DISPUTE_CLOSED",
              `unexpected apiError in vote race: ${failure.stderr}`
            );
            assert.equal(errorPayload.command, "disputes vote");
          }

          const closed = await forceAutoCloseCurrentCycle(baseUrl);
          const rewards = (await runCliJson(baseUrl, ["cycles", "rewards", "--cycle", closed.closedCycleId])) as {
            workloads: Array<{ disputeId: string; settledAt: string | null }>;
          };
          const disputedWorkloads = rewards.workloads.filter((item) => item.disputeId === dispute.id);
          assert.equal(disputedWorkloads.length, 1);
          assert.notEqual(disputedWorkloads[0].settledAt, null);
        } finally {
          await closeApp(app);
        }
      });
    })
);

runDbSuite(
  "cli persistence: duplicate dispute open race allows exactly one success",
  { timeout: 180_000 },
  async () =>
    runSequentially(async () => {
      await withPersistenceEnvironment(async ({ secret }) => {
        let app: FastifyInstance | null = null;
        try {
          const started = await startApp();
          app = started.app;
          const baseUrl = started.baseUrl;

          const publisher = addr("cli-persist-publisher-dispute");
          const worker = addr("cli-persist-worker-dispute");
          const publisherToken = signToken(publisher, secret);
          const workerToken = signToken(worker, secret);

          const flow = await createRejectedSubmission(
            baseUrl,
            publisherToken,
            workerToken,
            "cli-persist-dispute-race"
          );

          const openDisputeAttempts = await Promise.all(
            Array.from({ length: 20 }).map(() =>
              runCli(
                baseUrl,
                [
                  "disputes",
                  "open",
                  "--task",
                  flow.taskId,
                  "--submission",
                  flow.submissionId,
                  "--reason",
                  "duplicate dispute race"
                ],
                { AGENTRADE_TOKEN: publisherToken }
              )
            )
          );

          const openDisputeSuccess = openDisputeAttempts.filter((item) => item.code === 0);
          const openDisputeFailures = openDisputeAttempts.filter((item) => item.code !== 0);
          assert.equal(openDisputeSuccess.length, 1);
          assert.equal(openDisputeFailures.length, 19);

          for (const failure of openDisputeFailures) {
            assert.equal(failure.code, 4, `unexpected exit code for duplicate dispute open: ${failure.stderr}`);
            const errorPayload = parseCliError(failure);
            assert.equal(errorPayload.type, "API_ERROR");
            assert.equal(errorPayload.apiError, "OPEN_DISPUTE_ALREADY_EXISTS");
            assert.equal(errorPayload.command, "disputes open");
          }

          const createdDispute = JSON.parse(openDisputeSuccess[0]!.stdout.trim()) as { id: string };
          const createdDisputeDetails = (await runCliJson(baseUrl, ["disputes", "get", "--dispute", createdDispute.id])) as {
            id: string;
          };
          assert.equal(createdDisputeDetails.id, createdDispute.id);

          const disputesSnapshot = (await runCliJson(baseUrl, ["disputes", "list"])) as {
            items: Array<{ id: string; submissionId: string }>;
          };
          const disputesForSubmission = disputesSnapshot.items.filter(
            (item) => item.submissionId === flow.submissionId
          );
          assert.equal(disputesForSubmission.length, 1);
          assert.equal(disputesForSubmission[0]!.id, createdDispute.id);
        } finally {
          await closeApp(app);
        }
      });
    })
);

runDbSuite(
  "cli persistence: restart keeps task/profile readable",
  { timeout: 180_000 },
  async () =>
    runSequentially(async () => {
      await withPersistenceEnvironment(async ({ secret }) => {
        let app: FastifyInstance | null = null;
        try {
          const publisher = addr("cli-persist-publisher-restart");
          const publisherToken = signToken(publisher, secret);

          const first = await startApp();
          app = first.app;
          let baseUrl = first.baseUrl;

          await runCliJson(
            baseUrl,
            ["agents", "profile", "update", "--address", publisher, "--bio", "persistence-cli-bio"],
            { AGENTRADE_TOKEN: publisherToken }
          );

          const restartTask = await createTask(baseUrl, publisherToken, "cli-persist-restart", 1, 4);

          await closeApp(app);
          app = null;

          const second = await startApp();
          app = second.app;
          baseUrl = second.baseUrl;

          const restartTaskAfter = (await runCliJson(baseUrl, ["tasks", "get", "--task", restartTask.id])) as {
            id: string;
          };
          assert.equal(restartTaskAfter.id, restartTask.id);

          const profileAfterRestart = (await runCliJson(baseUrl, ["agents", "profile", "get", "--address", publisher])) as {
            bio: string;
          };
          assert.equal(profileAfterRestart.bio, "persistence-cli-bio");
        } finally {
          await closeApp(app);
        }
      });
    })
);
