import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
const cliPackageVersion = (
  JSON.parse(readFileSync(resolve(repoRoot, "apps/cli/package.json"), "utf8")) as { version: string }
).version;
const testConfigPath = join(tmpdir(), `agentrade-cli-behavior-${process.pid}.json`);

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

test("cli help includes global option and error contract guidance", async () => {
  const result = await runCli(["--help"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /CLI runtime setting precedence:/);
  assert.match(result.stdout, /agentrade config set\/show\/unset/);
  assert.match(result.stdout, /--base-url/);
  assert.match(result.stdout, /Output contract:/);
  assert.match(result.stdout, /Exit codes:/);
});

test("cli --version matches package version", async () => {
  const result = await runCli(["--version"]);
  assert.equal(result.code, 0);
  assert.equal(result.stdout.trim(), cliPackageVersion);
  assert.equal(result.stderr.trim(), "");
});

test("cli fallback command detection keeps command path when global options are before command", async () => {
  const result = await runCli([
    "--pretty",
    "--base-url",
    "http://127.0.0.1:1",
    "tasks",
    "get"
  ]);

  assert.equal(result.code, 2);
  const errorJson = JSON.parse(result.stderr.trim()) as {
    type: string;
    command: string;
  };
  assert.equal(errorJson.type, "VALIDATION_ERROR");
  assert.equal(errorJson.command, "tasks get");
});

test("cli auth verify blocks empty nonce/signature before network request", async () => {
  const address = "0x1111111111111111111111111111111111111111";

  const emptyNonce = await runCli([
    "--base-url",
    "http://127.0.0.1:1",
    "auth",
    "verify",
    "--address",
    address,
    "--nonce",
    "   ",
    "--signature",
    "sig",
    "--message",
    "message"
  ]);
  assert.equal(emptyNonce.code, 2);
  const emptyNonceError = JSON.parse(emptyNonce.stderr.trim()) as {
    type: string;
    command: string;
    message: string;
  };
  assert.equal(emptyNonceError.type, "VALIDATION_ERROR");
  assert.equal(emptyNonceError.command, "auth verify");
  assert.match(emptyNonceError.message, /--nonce must be non-empty/);

  const emptySignature = await runCli([
    "--base-url",
    "http://127.0.0.1:1",
    "auth",
    "verify",
    "--address",
    address,
    "--nonce",
    "nonce-1",
    "--signature",
    " ",
    "--message",
    "message"
  ]);
  assert.equal(emptySignature.code, 2);
  const emptySignatureError = JSON.parse(emptySignature.stderr.trim()) as {
    type: string;
    command: string;
    message: string;
  };
  assert.equal(emptySignatureError.type, "VALIDATION_ERROR");
  assert.equal(emptySignatureError.command, "auth verify");
  assert.match(emptySignatureError.message, /--signature must be non-empty/);
});

test("cli tasks create blocks invalid timezone before network request", async () => {
  const result = await runCli(
    [
      "--base-url",
      "http://127.0.0.1:1",
      "--token",
      "token-1",
      "tasks",
      "create",
      "--title",
      "tz-check",
      "--desc",
      "desc",
      "--criteria",
      "criteria",
      "--deadline",
      "2027-01-01T00:00:00.000Z",
      "--tz",
      "Mars/Base",
      "--slots",
      "1",
      "--reward",
      "1"
    ]
  );
  assert.equal(result.code, 2);
  const errorJson = JSON.parse(result.stderr.trim()) as {
    type: string;
    command: string;
    message: string;
  };
  assert.equal(errorJson.type, "VALIDATION_ERROR");
  assert.equal(errorJson.command, "tasks create");
  assert.match(errorJson.message, /--tz must be a valid IANA timezone/);
});

test("cli disputes list blocks removed status enum before network request", async () => {
  const result = await runCli([
    "--base-url",
    "http://127.0.0.1:1",
    "disputes",
    "list",
    "--status",
    "RESOLVED_NOT_COMPLETED"
  ]);
  assert.equal(result.code, 2);
  const errorJson = JSON.parse(result.stderr.trim()) as {
    type: string;
    command: string;
    message: string;
  };
  assert.equal(errorJson.type, "VALIDATION_ERROR");
  assert.equal(errorJson.command, "disputes list");
  assert.match(errorJson.message, /--status must be OPEN\|RESOLVED_COMPLETED/);
});

test("cli activities list accepts TASK_SUBMITTED and SUBMISSION_REJECTED enum values", async () => {
  for (const activityType of ["TASK_SUBMITTED", "SUBMISSION_REJECTED"] as const) {
    const result = await runCli([
      "--base-url",
      "http://127.0.0.1:1",
      "activities",
      "list",
      "--type",
      activityType
    ]);
    assert.equal(result.code, 5);
    const errorJson = JSON.parse(result.stderr.trim()) as {
      type: string;
      command: string;
    };
    assert.equal(errorJson.type, "NETWORK_ERROR");
    assert.equal(errorJson.command, "activities list");
  }
});
