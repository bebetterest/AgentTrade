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
