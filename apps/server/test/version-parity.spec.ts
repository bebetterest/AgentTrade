import jwt from "jsonwebtoken";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Address } from "@agentrade/types";
import { buildApp } from "../src/app.js";

type ApiVersion = "v1" | "v2";
type InjectPayload = string | object | Buffer | NodeJS.ReadableStream;

const addr = (seed: string): Address =>
  `0x${Buffer.from(seed).toString("hex").slice(0, 40).padEnd(40, "0")}` as Address;

const futureDeadline = (hours = 24): string =>
  new Date(Date.now() + hours * 3_600_000).toISOString();

const versionPath = (version: ApiVersion, suffix: string): string =>
  version === "v1" ? `/v1${suffix}` : `/v2${suffix}`;

const healthPath = (version: ApiVersion): string =>
  version === "v1" ? "/health" : "/v2/system/health";

const normalizeGeneratedAt = (value: unknown): unknown => {
  if (!value || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeGeneratedAt(item));
  }
  const record = { ...(value as Record<string, unknown>) };
  if ("generatedAt" in record) {
    record.generatedAt = "<normalized>";
  }
  for (const [key, nested] of Object.entries(record)) {
    record[key] = normalizeGeneratedAt(nested);
  }
  return record;
};

const getErrorCode = (version: ApiVersion, payload: unknown): string | null => {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (version === "v2" && record.error && typeof record.error === "object") {
    const nested = record.error as Record<string, unknown>;
    return typeof nested.code === "string" ? nested.code : null;
  }
  return typeof record.error === "string" ? record.error : null;
};

describe("v1/v2 parity", () => {
  let app: FastifyInstance | null = null;
  const secret = "version-parity-secret";
  const adminKey = "version-parity-admin-key";
  const oldEnv = { ...process.env };

  beforeAll(() => {
    process.env.JWT_SECRET = secret;
    process.env.ADMIN_SERVICE_KEY = adminKey;
    process.env.ENABLE_PERSISTENCE = "false";
    process.env.ENABLE_REDIS_RATE_LIMIT = "false";
    process.env.RATE_LIMIT_PER_MINUTE = "10000";
    process.env.RATE_LIMIT_BURST = "10000";
  });

  beforeEach(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  afterAll(() => {
    process.env = oldEnv;
  });

  const bearer = (address: Address): string => jwt.sign({ sub: address }, secret, { expiresIn: "1h" });

  const jsonRequest = async (
    method: "GET" | "POST" | "PATCH",
    url: string,
    options: {
      token?: string;
      admin?: boolean;
      payload?: unknown;
    } = {}
  ) => {
    const request: {
      method: "GET" | "POST" | "PATCH";
      url: string;
      headers: Record<string, string>;
      payload?: InjectPayload;
    } = {
      method,
      url,
      headers: {
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(options.admin ? { "x-admin-service-key": adminKey } : {})
      },
      ...(options.payload === undefined
        ? {}
        : { payload: options.payload as InjectPayload })
    };
    const response = await app!.inject(request);
    return {
      response,
      body: response.json() as Record<string, unknown>
    };
  };

  it("keeps populated read models aligned between v1 and v2", async () => {
    const publisher = addr("parity-publisher-read");
    const worker = addr("parity-worker-read");
    const supervisor = addr("parity-supervisor-read");

    const publisherToken = bearer(publisher);
    const workerToken = bearer(worker);
    const supervisorToken = bearer(supervisor);

    const createdTask = await jsonRequest("POST", versionPath("v2", "/tasks"), {
      token: publisherToken,
      payload: {
        title: "read-parity-task",
        descriptionMd: "desc",
        acceptanceCriteria: "criteria",
        deadlineUtc: futureDeadline(),
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    expect(createdTask.response.statusCode).toBe(200);
    const taskId = String(createdTask.body.id);

    const acceptTask = await jsonRequest("POST", versionPath("v2", `/tasks/${taskId}/accept`), {
      token: workerToken
    });
    expect(acceptTask.response.statusCode).toBe(200);

    const submitted = await jsonRequest("POST", versionPath("v2", `/tasks/${taskId}/submissions`), {
      token: workerToken,
      payload: { payloadMd: "worker-output" }
    });
    expect(submitted.response.statusCode).toBe(200);
    const submissionId = String(submitted.body.id);

    const rejected = await jsonRequest("POST", versionPath("v2", `/submissions/${submissionId}/reject`), {
      token: publisherToken
    });
    expect(rejected.response.statusCode).toBe(200);

    const disputeOpened = await jsonRequest("POST", versionPath("v2", "/disputes"), {
      token: publisherToken,
      payload: {
        taskId,
        submissionId,
        reasonMd: "needs-review"
      }
    });
    expect(disputeOpened.response.statusCode).toBe(200);
    const disputeId = String(disputeOpened.body.id);

    const voted = await jsonRequest("POST", versionPath("v2", `/disputes/${disputeId}/votes`), {
      token: supervisorToken,
      payload: { vote: "COMPLETED" }
    });
    expect(voted.response.statusCode).toBe(200);

    const closed = await jsonRequest("POST", versionPath("v2", "/admin/cycles/close"), {
      admin: true
    });
    expect(closed.response.statusCode).toBe(200);
    const closedCycleId = String(closed.body.closedCycleId);

    const requests = [
      ["GET", healthPath("v1"), healthPath("v2")],
      ["GET", `/v1/tasks?publisher=${publisher}&sort=reward&order=desc&limit=10`, `/v2/tasks?publisher=${publisher}&sort=reward&order=desc&limit=10`],
      ["GET", `/v1/tasks/${taskId}`, `/v2/tasks/${taskId}`],
      ["GET", `/v1/disputes?taskId=${taskId}&status=RESOLVED_COMPLETED&limit=10`, `/v2/disputes?taskId=${taskId}&status=RESOLVED_COMPLETED&limit=10`],
      ["GET", `/v1/disputes/${disputeId}`, `/v2/disputes/${disputeId}`],
      ["GET", `/v1/activities?taskId=${taskId}&order=desc&limit=20`, `/v2/activities?taskId=${taskId}&order=desc&limit=20`],
      ["GET", `/v1/agents?q=${publisher}&sort=score&order=desc&limit=10`, `/v2/agents?q=${publisher}&sort=score&order=desc&limit=10`],
      ["GET", `/v1/agents/${publisher}`, `/v2/agents/${publisher}`],
      ["GET", `/v1/agents/${publisher}/stats`, `/v2/agents/${publisher}/stats`],
      ["GET", `/v1/ledger/${worker}`, `/v2/ledger/${worker}`],
      ["GET", "/v1/cycles?limit=10", "/v2/cycles?limit=10"],
      ["GET", "/v1/cycles/active", "/v2/cycles/active"],
      ["GET", `/v1/cycles/${closedCycleId}`, `/v2/cycles/${closedCycleId}`],
      ["GET", `/v1/cycles/${closedCycleId}/rewards`, `/v2/cycles/${closedCycleId}/rewards`],
      ["GET", "/v1/dashboard/summary?tz=UTC", "/v2/dashboard/summary?tz=UTC"],
      ["GET", "/v1/dashboard/trends?tz=UTC&window=7d", "/v2/dashboard/trends?tz=UTC&window=7d"],
      ["GET", "/v1/economy/params", "/v2/economy/params"]
    ] as const;

    for (const [method, v1Url, v2Url] of requests) {
      const left = await jsonRequest(method, v1Url);
      const right = await jsonRequest(method, v2Url);
      expect(left.response.statusCode).toBe(200);
      expect(right.response.statusCode).toBe(200);
      expect(normalizeGeneratedAt(left.body)).toEqual(normalizeGeneratedAt(right.body));
    }
  });

  it.each(["v1", "v2"] as const)("supports the full write lifecycle through %s routes", async (version) => {
    const publisher = addr(`parity-publisher-${version}`);
    const worker = addr(`parity-worker-${version}`);
    const supervisor = addr(`parity-supervisor-${version}`);

    const publisherToken = bearer(publisher);
    const workerToken = bearer(worker);
    const supervisorToken = bearer(supervisor);

    const createdTask = await jsonRequest("POST", versionPath(version, "/tasks"), {
      token: publisherToken,
      payload: {
        title: `${version}-task`,
        descriptionMd: "desc",
        acceptanceCriteria: "criteria",
        deadlineUtc: futureDeadline(),
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    expect(createdTask.response.statusCode).toBe(200);
    expect(createdTask.body.status).toBe("OPEN");
    const taskId = String(createdTask.body.id);

    const accepted = await jsonRequest("POST", versionPath(version, `/tasks/${taskId}/accept`), {
      token: workerToken
    });
    expect(accepted.response.statusCode).toBe(200);
    expect(accepted.body.status).toBe("IN_PROGRESS");

    const submitted = await jsonRequest("POST", versionPath(version, `/tasks/${taskId}/submissions`), {
      token: workerToken,
      payload: { payloadMd: "submission" }
    });
    expect(submitted.response.statusCode).toBe(200);
    expect(submitted.body.status).toBe("SUBMITTED");
    const submissionId = String(submitted.body.id);

    const rejected = await jsonRequest("POST", versionPath(version, `/submissions/${submissionId}/reject`), {
      token: publisherToken
    });
    expect(rejected.response.statusCode).toBe(200);
    expect(rejected.body.status).toBe("REJECTED");

    const openedDispute = await jsonRequest("POST", versionPath(version, "/disputes"), {
      token: publisherToken,
      payload: {
        taskId,
        submissionId,
        reasonMd: "recheck"
      }
    });
    expect(openedDispute.response.statusCode).toBe(200);
    expect(openedDispute.body.status).toBe("OPEN");
    const disputeId = String(openedDispute.body.id);

    const voted = await jsonRequest("POST", versionPath(version, `/disputes/${disputeId}/votes`), {
      token: supervisorToken,
      payload: { vote: "COMPLETED" }
    });
    expect(voted.response.statusCode).toBe(200);
    expect(voted.body.vote).toBeDefined();
    expect(voted.body.workload).toBeDefined();

    const confirmTask = await jsonRequest("POST", versionPath(version, "/tasks"), {
      token: publisherToken,
      payload: {
        title: `${version}-confirm-task`,
        descriptionMd: "desc",
        acceptanceCriteria: "criteria",
        deadlineUtc: futureDeadline(),
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 6,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    const confirmTaskId = String(confirmTask.body.id);
    await jsonRequest("POST", versionPath(version, `/tasks/${confirmTaskId}/accept`), {
      token: workerToken
    });
    const confirmSubmission = await jsonRequest("POST", versionPath(version, `/tasks/${confirmTaskId}/submissions`), {
      token: workerToken,
      payload: { payloadMd: "confirmed-output" }
    });
    const confirmSubmissionId = String(confirmSubmission.body.id);
    const confirmed = await jsonRequest("POST", versionPath(version, `/submissions/${confirmSubmissionId}/confirm`), {
      token: publisherToken
    });
    expect(confirmed.response.statusCode).toBe(200);
    expect(confirmed.body.status).toBe("CONFIRMED");

    const terminateTask = await jsonRequest("POST", versionPath(version, "/tasks"), {
      token: publisherToken,
      payload: {
        title: `${version}-terminate-task`,
        descriptionMd: "desc",
        acceptanceCriteria: "criteria",
        deadlineUtc: futureDeadline(),
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 4,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    const terminateTaskId = String(terminateTask.body.id);
    const terminated = await jsonRequest("POST", versionPath(version, `/tasks/${terminateTaskId}/terminate`), {
      token: publisherToken
    });
    expect(terminated.response.statusCode).toBe(200);
    expect(terminated.body.status).toBe("TERMINATED");

    const updatedProfile = await jsonRequest("PATCH", versionPath(version, `/agents/${publisher}/profile`), {
      token: publisherToken,
      payload: { bio: `${version}-bio` }
    });
    expect(updatedProfile.response.statusCode).toBe(200);
    expect(updatedProfile.body.bio).toBe(`${version}-bio`);

    const overrideTask = await jsonRequest("POST", versionPath(version, "/tasks"), {
      token: publisherToken,
      payload: {
        title: `${version}-override-task`,
        descriptionMd: "desc",
        acceptanceCriteria: "criteria",
        deadlineUtc: futureDeadline(),
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 9,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    const overrideTaskId = String(overrideTask.body.id);
    await jsonRequest("POST", versionPath(version, `/tasks/${overrideTaskId}/accept`), {
      token: workerToken
    });
    const overrideSubmission = await jsonRequest("POST", versionPath(version, `/tasks/${overrideTaskId}/submissions`), {
      token: workerToken,
      payload: { payloadMd: "override-output" }
    });
    const overrideSubmissionId = String(overrideSubmission.body.id);
    await jsonRequest("POST", versionPath(version, `/submissions/${overrideSubmissionId}/reject`), {
      token: publisherToken
    });
    const overrideDispute = await jsonRequest("POST", versionPath(version, "/disputes"), {
      token: publisherToken,
      payload: {
        taskId: overrideTaskId,
        submissionId: overrideSubmissionId,
        reasonMd: "admin-finalize"
      }
    });
    const overrideDisputeId = String(overrideDispute.body.id);
    const overridden = await jsonRequest("POST", versionPath(version, `/admin/disputes/${overrideDisputeId}/override`), {
      admin: true,
      payload: { result: "COMPLETED" }
    });
    expect(overridden.response.statusCode).toBe(200);
    expect(overridden.body.status).toBe("RESOLVED_COMPLETED");

    const exported = await jsonRequest("POST", versionPath(version, "/admin/bridge/export"), {
      admin: true,
      payload: { addresses: [publisher, worker] }
    });
    expect(exported.response.statusCode).toBe(200);
    expect(Array.isArray(exported.body.exports)).toBe(true);

    const closed = await jsonRequest("POST", versionPath(version, "/admin/cycles/close"), {
      admin: true
    });
    expect(closed.response.statusCode).toBe(200);
    expect(typeof closed.body.closedCycleId).toBe("string");
    expect(typeof closed.body.openedCycleId).toBe("string");
  });

  it("keeps auth, access-control, and validation edge semantics aligned between versions", async () => {
    const publisher = addr("parity-auth-publisher");

    for (const version of ["v1", "v2"] as const) {
      const invalidChallenge = await jsonRequest("POST", versionPath(version, "/auth/challenge"), {
        payload: { address: "not-an-evm-address" }
      });
      expect(invalidChallenge.response.statusCode).toBe(400);
      expect(getErrorCode(version, invalidChallenge.body)).toBe("VALIDATION_ERROR");

      const missingChallenge = await jsonRequest("POST", versionPath(version, "/auth/verify"), {
        payload: {
          address: publisher,
          nonce: "nonce-missing",
          message: "message-missing",
          signature: "0xdeadbeef"
        }
      });
      expect(missingChallenge.response.statusCode).toBe(401);
      expect(getErrorCode(version, missingChallenge.body)).toBe("HTTP_ERROR");

      const missingBearer = await jsonRequest("POST", versionPath(version, "/tasks"), {
        payload: {
          title: `${version}-missing-bearer`,
          descriptionMd: "desc",
          acceptanceCriteria: "criteria",
          deadlineUtc: futureDeadline(),
          displayTimezone: "UTC",
          slotsTotal: 1,
          rewardPerSlot: 10,
          allowRepeatCompletionsBySameAgent: false
        }
      });
      expect(missingBearer.response.statusCode).toBe(401);
      expect(getErrorCode(version, missingBearer.body)).toBe("HTTP_ERROR");

      const invalidAdmin = await app!.inject({
        method: "POST",
        url: versionPath(version, "/admin/cycles/close"),
        headers: { "x-admin-service-key": "wrong-admin-key" }
      });
      expect(invalidAdmin.statusCode).toBe(401);
      expect(getErrorCode(version, invalidAdmin.json() as Record<string, unknown>)).toBe("HTTP_ERROR");

      const invalidCursor = await jsonRequest("GET", versionPath(version, "/tasks?cursor=-1&limit=1"));
      expect(invalidCursor.response.statusCode).toBe(400);
      expect(getErrorCode(version, invalidCursor.body)).toBe("VALIDATION_ERROR");
    }
  });

  it("keeps explicit pagination aligned between versions across list endpoints", async () => {
    const publishers = Array.from({ length: 4 }, (_, index) => addr(`parity-page-publisher-${index}`));

    for (const publisher of publishers) {
      const createdTask = await jsonRequest("POST", versionPath("v2", "/tasks"), {
        token: bearer(publisher),
        payload: {
          title: `pagination-task-${publisher.slice(-4)}`,
          descriptionMd: "desc",
          acceptanceCriteria: "criteria",
          deadlineUtc: futureDeadline(),
          displayTimezone: "UTC",
          slotsTotal: 1,
          rewardPerSlot: 10,
          allowRepeatCompletionsBySameAgent: false
        }
      });
      expect(createdTask.response.statusCode).toBe(200);
    }

    for (let step = 0; step < 24; step += 1) {
      const closed = await jsonRequest("POST", versionPath("v2", "/admin/cycles/close"), {
        admin: true
      });
      expect(closed.response.statusCode).toBe(200);
    }

    const pagedRequests = [
      ["/v1/tasks?cursor=1&limit=2", "/v2/tasks?cursor=1&limit=2"],
      ["/v1/activities?cursor=1&limit=2", "/v2/activities?cursor=1&limit=2"],
      ["/v1/agents?cursor=1&limit=2", "/v2/agents?cursor=1&limit=2"],
      ["/v1/cycles?cursor=1&limit=2", "/v2/cycles?cursor=1&limit=2"]
    ] as const;

    for (const [v1Url, v2Url] of pagedRequests) {
      const left = await jsonRequest("GET", v1Url);
      const right = await jsonRequest("GET", v2Url);
      expect(left.response.statusCode).toBe(200);
      expect(right.response.statusCode).toBe(200);
      expect(normalizeGeneratedAt(left.body)).toEqual(normalizeGeneratedAt(right.body));
    }
  });

  it("keeps error semantics aligned between versions", async () => {
    for (const version of ["v1", "v2"] as const) {
      const missingTask = await jsonRequest("GET", versionPath(version, "/tasks/task-does-not-exist"));
      expect(missingTask.response.statusCode).toBe(404);
      expect(getErrorCode(version, missingTask.body)).toBe("TASK_NOT_FOUND");

      const invalidTimezone = await jsonRequest("GET", versionPath(version, "/dashboard/summary?tz=Bad/Timezone"));
      expect(invalidTimezone.response.statusCode).toBe(400);
      expect(getErrorCode(version, invalidTimezone.body)).toBe("HTTP_ERROR");
    }
  });
});
