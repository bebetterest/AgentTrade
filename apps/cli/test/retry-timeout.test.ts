import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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

const runCli = async (args: string[], env: NodeJS.ProcessEnv = {}): Promise<CliResult> => {
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
    assert.deepEqual(JSON.parse(result.stdout.trim()), { items: [], nextCursor: null });
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
    };
    assert.equal(errorJson.type, "NETWORK_ERROR");
    assert.equal(errorJson.retryable, true);
    assert.equal(errorJson.command, "tasks list");
    assert.match(errorJson.message, /abort|timed out|This operation was aborted/i);
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
