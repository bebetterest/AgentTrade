import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { unwrapCliSuccess } from "./success-envelope.js";

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../../..");
const cliBin = resolve(repoRoot, "apps/cli/node_modules/.bin/tsx");
const cliEntry = resolve(repoRoot, "apps/cli/src/index.ts");
const testConfigPath = join(tmpdir(), `agentrade-cli-retry-timeout-${process.pid}.json`);

const runCli = async (args: string[], env: NodeJS.ProcessEnv = {}): Promise<CliResult> => {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(cliBin, [cliEntry, ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        AGENTRADE_CLI_CONFIG_PATH: testConfigPath,
        ...env
      }
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

test("cli retry: retries 5xx and then succeeds", async () => {
  let attempts = 0;
  const server = createServer((_request, response) => {
    attempts += 1;
    response.setHeader("content-type", "application/json");
    if (attempts === 1) {
      response.statusCode = 503;
      response.end(JSON.stringify({ error: "TEMP", message: "please retry" }));
      return;
    }
    response.end(JSON.stringify({ items: [], nextCursor: null }));
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });

  try {
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const result = await runCli([
      "--base-url",
      baseUrl,
      "--retries",
      "1",
      "--timeout-ms",
      "1000",
      "tasks",
      "list"
    ]);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(attempts, 2);
    assert.deepEqual(unwrapCliSuccess(result.stdout), { items: [], nextCursor: null });
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

test("cli retry: does not retry non-retryable 4xx API errors", async () => {
  let attempts = 0;
  const server = createServer((_request, response) => {
    attempts += 1;
    response.statusCode = 409;
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        error: "INSUFFICIENT_BALANCE",
        message: "insufficient balance for task escrow and tax"
      })
    );
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });

  try {
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const result = await runCli([
      "--base-url",
      baseUrl,
      "--retries",
      "3",
      "tasks",
      "list"
    ]);

    assert.equal(result.code, 4);
    assert.equal(attempts, 1);

    const errorJson = JSON.parse(result.stderr.trim()) as {
      type: string;
      apiError: string | null;
      retryable: boolean;
      command: string;
    };
    assert.equal(errorJson.type, "API_ERROR");
    assert.equal(errorJson.apiError, "INSUFFICIENT_BALANCE");
    assert.equal(errorJson.retryable, false);
    assert.equal(errorJson.command, "tasks list");
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

test("cli timeout: request timeout returns NETWORK_ERROR", async () => {
  let attempts = 0;
  const server = createServer(async (_request, response) => {
    attempts += 1;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ items: [], nextCursor: null }));
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });

  try {
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const result = await runCli([
      "--base-url",
      baseUrl,
      "--timeout-ms",
      "20",
      "--retries",
      "0",
      "tasks",
      "list"
    ]);

    assert.equal(result.code, 5);
    assert.ok(attempts <= 1);

    const errorJson = JSON.parse(result.stderr.trim()) as {
      type: string;
      retryable: boolean;
      command: string;
      message: string;
      issues: {
        kind: string;
        method: string;
        url: string;
        timeoutMs: number;
      };
    };
    assert.equal(errorJson.type, "NETWORK_ERROR");
    assert.equal(errorJson.retryable, true);
    assert.equal(errorJson.command, "tasks list");
    assert.match(errorJson.message, /request timed out after 20ms/i);
    assert.equal(errorJson.issues.kind, "TIMEOUT");
    assert.equal(errorJson.issues.method, "GET");
    assert.equal(errorJson.issues.timeoutMs, 20);
    assert.match(errorJson.issues.url, /\/tasks$/);
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

test("cli dns failure returns NETWORK_ERROR with structured transport diagnostics", async () => {
  const result = await runCli([
    "--base-url",
    "http://nonexistent-subdomain-for-agentrade-cli.invalid",
    "--retries",
    "0",
    "system",
    "health"
  ]);

  assert.equal(result.code, 5);
  const errorJson = JSON.parse(result.stderr.trim()) as {
    type: string;
    retryable: boolean;
    command: string;
    message: string;
    issues: {
      kind: string;
      causeCode: string | null;
      url: string;
    };
  };
  assert.equal(errorJson.type, "NETWORK_ERROR");
  assert.equal(errorJson.retryable, false);
  assert.equal(errorJson.command, "system health");
  assert.match(errorJson.message, /dns lookup failed/i);
  assert.equal(errorJson.issues.kind, "DNS");
  assert.equal(errorJson.issues.causeCode, "ENOTFOUND");
  assert.match(errorJson.issues.url, /nonexistent-subdomain-for-agentrade-cli\.invalid/);
});

test("cli blocked port returns non-retryable NETWORK_ERROR with request diagnostics", async () => {
  const result = await runCli([
    "--base-url",
    "http://127.0.0.1:1",
    "--retries",
    "3",
    "system",
    "health"
  ]);

  assert.equal(result.code, 5);
  const errorJson = JSON.parse(result.stderr.trim()) as {
    type: string;
    retryable: boolean;
    command: string;
    message: string;
    issues: {
      kind: string;
      causeMessage: string | null;
      url: string;
    };
  };
  assert.equal(errorJson.type, "NETWORK_ERROR");
  assert.equal(errorJson.retryable, false);
  assert.equal(errorJson.command, "system health");
  assert.match(errorJson.message, /bad port/i);
  assert.equal(errorJson.issues.kind, "NETWORK");
  assert.equal(errorJson.issues.causeMessage, "bad port");
  assert.match(errorJson.issues.url, /127\.0\.0\.1:1\/system\/health/);
});
