import assert from "node:assert/strict";
import test from "node:test";
import { TaskStatus } from "@agentrade/types";
import { AgentradeApiClient, ApiClientError } from "@agentrade/sdk";

interface RecordedCall {
  input: string;
  init?: RequestInit;
}

const taskFixture = {
  id: "task-1",
  publisher: "0x1111111111111111111111111111111111111111",
  title: "Fixture Task",
  descriptionMd: "desc",
  acceptanceCriteria: "criteria",
  status: TaskStatus.IN_PROGRESS,
  deadlineUtc: "2027-01-01T00:00:00.000Z",
  displayTimezone: "UTC",
  slotsTotal: 1,
  rewardPerSlot: 5,
  allowRepeatCompletionsBySameAgent: false,
  taxAmount: 1,
  rewardEscrowRemaining: 5,
  intentCount: 0,
  competitionRatio: 0,
  completedAgents: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

const taskIntentionFixture = {
  id: "intention-1",
  taskId: "task-1",
  agent: "0x1111111111111111111111111111111111111111",
  createdAt: "2026-01-01T00:00:00.000Z"
};

test("sdk request assembly: headers/body/auth", async () => {
  const calls: RecordedCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input: String(input), init });
    return new Response(JSON.stringify(taskIntentionFixture), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const client = new AgentradeApiClient({
    baseUrl: "http://localhost:3000/",
    token: "token-123",
    fetchImpl,
    retries: 0,
    timeoutMs: 5000
  });

  await client.addTaskIntention("task-1");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, "http://localhost:3000/tasks/task-1/intentions");
  assert.equal(calls[0].init?.method, "POST");
  assert.equal((calls[0].init?.headers as Record<string, string>).authorization, "Bearer token-123");
});

test("sdk request assembly: privileged settings mutation adds admin header", async () => {
  const calls: RecordedCall[] = [];
  const runtimeSettingsFixture = {
    currentRules: {
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
    },
    pendingNextPatch: null,
    nextRules: {
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
    },
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input: String(input), init });
    return new Response(JSON.stringify(runtimeSettingsFixture), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const client = new AgentradeApiClient({
    baseUrl: "http://localhost:3000/",
    token: "token-123",
    adminKey: "admin-key-123",
    fetchImpl,
    retries: 0,
    timeoutMs: 5000
  });

  await client.updateRuntimeSettings({
    applyTo: "next",
    patch: { taxRateBps: 600 }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, "http://localhost:3000/system/settings");
  assert.equal(calls[0].init?.method, "PATCH");
  assert.equal((calls[0].init?.headers as Record<string, string>).authorization, "Bearer token-123");
  assert.equal(
    (calls[0].init?.headers as Record<string, string>)["x-admin-service-key"],
    "admin-key-123"
  );
});

test("sdk privileged settings mutation requires admin key", async () => {
  const client = new AgentradeApiClient({
    baseUrl: "http://localhost:3000",
    token: "token-123",
    fetchImpl: async () =>
      new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } }),
    retries: 0,
    timeoutMs: 1000
  });

  await assert.rejects(
    async () =>
      client.updateRuntimeSettings({
        applyTo: "current",
        patch: { taxRateBps: 500 }
      }),
    (error: unknown) => {
      assert.ok(error instanceof ApiClientError);
      assert.equal(error.apiError, "MISSING_ADMIN_KEY");
      return true;
    }
  );
});

test("sdk can opt into explicit versioned contract paths", async () => {
  const calls: RecordedCall[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    calls.push({ input: String(input) });
    return new Response(JSON.stringify({ ok: true, service: "agentrade-server" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const client = new AgentradeApiClient({
    baseUrl: "http://localhost:3000/",
    fetchImpl,
    preferVersionlessPaths: false,
    retries: 0,
    timeoutMs: 5000
  });

  await client.health();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, "http://localhost:3000/v2/system/health");
});

test("sdk retries 5xx then succeeds", async () => {
  let attempt = 0;
  const fetchImpl: typeof fetch = async () => {
    attempt += 1;
    if (attempt === 1) {
      return new Response(JSON.stringify({ error: "TEMP", message: "try again" }), {
        status: 500,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ items: [], nextCursor: null }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const client = new AgentradeApiClient({
    baseUrl: "http://localhost:3000",
    fetchImpl,
    retries: 1,
    timeoutMs: 1000
  });

  const data = await client.getTasks();
  assert.deepEqual(data, { items: [], nextCursor: null });
  assert.equal(attempt, 2);
});

test("sdk network failure surfaces ApiClientError", async () => {
  const fetchImpl: typeof fetch = async () => {
    throw new TypeError("network down");
  };

  const client = new AgentradeApiClient({
    baseUrl: "http://localhost:3000",
    fetchImpl,
    retries: 0,
    timeoutMs: 1000
  });

  await assert.rejects(async () => client.getTasks(), (error: unknown) => {
    assert.ok(error instanceof ApiClientError);
    assert.equal(error.httpStatus, null);
    assert.equal(error.retryable, true);
    assert.match(error.message, /network request failed for GET http:\/\/localhost:3000\/tasks: network down/i);
    assert.deepEqual(error.issues, {
      kind: "NETWORK",
      method: "GET",
      url: "http://localhost:3000/tasks",
      timeoutMs: 1000,
      causeName: "TypeError",
      causeCode: null,
      causeMessage: "network down"
    });
    return true;
  });
});

test("sdk dns failure is classified with structured transport issues", async () => {
  const dnsCause = Object.assign(new Error("getaddrinfo ENOTFOUND api.agentrade.invalid"), {
    code: "ENOTFOUND"
  });
  const fetchImpl: typeof fetch = async () => {
    throw new TypeError("fetch failed", { cause: dnsCause });
  };

  const client = new AgentradeApiClient({
    baseUrl: "http://api.agentrade.invalid",
    fetchImpl,
    retries: 0,
    timeoutMs: 1000
  });

  await assert.rejects(async () => client.getTasks(), (error: unknown) => {
    assert.ok(error instanceof ApiClientError);
    assert.equal(error.httpStatus, null);
    assert.equal(error.retryable, false);
    assert.match(error.message, /dns lookup failed for GET http:\/\/api\.agentrade\.invalid\/tasks: ENOTFOUND/i);
    assert.deepEqual(error.issues, {
      kind: "DNS",
      method: "GET",
      url: "http://api.agentrade.invalid/tasks",
      timeoutMs: 1000,
      causeName: "Error",
      causeCode: "ENOTFOUND",
      causeMessage: "getaddrinfo ENOTFOUND api.agentrade.invalid"
    });
    return true;
  });
});

test("sdk blocked port is non-retryable and keeps request diagnostics", async () => {
  const fetchImpl: typeof fetch = async () => {
    throw new TypeError("fetch failed", {
      cause: new Error("bad port")
    });
  };

  const client = new AgentradeApiClient({
    baseUrl: "http://127.0.0.1:1",
    fetchImpl,
    retries: 3,
    timeoutMs: 1000
  });

  await assert.rejects(async () => client.health(), (error: unknown) => {
    assert.ok(error instanceof ApiClientError);
    assert.equal(error.httpStatus, null);
    assert.equal(error.retryable, false);
    assert.match(error.message, /network request failed for GET http:\/\/127\.0\.0\.1:1\/system\/health: bad port/i);
    assert.deepEqual(error.issues, {
      kind: "NETWORK",
      method: "GET",
      url: "http://127.0.0.1:1/system/health",
      timeoutMs: 1000,
      causeName: "Error",
      causeCode: null,
      causeMessage: "bad port"
    });
    return true;
  });
});

test("sdk malformed json on error still reports http status", async () => {
  const fetchImpl: typeof fetch = async () => {
    return new Response("{bad-json", {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  };

  const client = new AgentradeApiClient({
    baseUrl: "http://localhost:3000",
    fetchImpl,
    retries: 0,
    timeoutMs: 1000
  });

  await assert.rejects(async () => client.getTasks(), (error: unknown) => {
    assert.ok(error instanceof ApiClientError);
    assert.equal(error.httpStatus, 500);
    assert.equal(error.retryable, true);
    return true;
  });
});
