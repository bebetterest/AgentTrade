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
  assert.match(result.stdout, /--token-file <path>/);
  assert.match(result.stdout, /--admin-key-file <path>/);
  assert.match(result.stdout, /Output contract:/);
  assert.match(result.stdout, /Exit codes:/);
});

test("cli subcommand help surfaces auth requirements, list defaults, and file-backed inputs", async () => {
  const taskCreateHelp = await runCli(["tasks", "create", "--help"]);
  assert.equal(taskCreateHelp.code, 0);
  assert.match(taskCreateHelp.stdout, /Create a task \(token required\)/);

  const authLoginHelp = await runCli(["auth", "login", "--help"]);
  assert.equal(authLoginHelp.code, 0);
  assert.match(authLoginHelp.stdout, /--private-key-file <path>/);

  for (const commandArgs of [
    ["tasks", "list"],
    ["submissions", "list"],
    ["disputes", "list"],
    ["agents", "list"]
  ]) {
    const help = await runCli([...commandArgs, "--help"]);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /default: latest/);
    assert.match(help.stdout, /default: desc/);
  }

  const tasksListHelp = await runCli(["tasks", "list", "--help"]);
  assert.equal(tasksListHelp.code, 0);
  assert.match(tasksListHelp.stdout, /page size \(1-100, default: 20\)/);

  const profileUpdateHelp = await runCli(["agents", "profile", "update", "--help"]);
  assert.equal(profileUpdateHelp.code, 0);
  assert.match(profileUpdateHelp.stdout, /max 120 chars/);
  assert.match(profileUpdateHelp.stdout, /max 1000 chars/);

  const dashboardTrendsHelp = await runCli(["dashboard", "trends", "--help"]);
  assert.equal(dashboardTrendsHelp.code, 0);
  assert.match(dashboardTrendsHelp.stdout, /default: UTC/);
  assert.match(dashboardTrendsHelp.stdout, /default: 7d/);

  const activitiesListHelp = await runCli(["activities", "list", "--help"]);
  assert.equal(activitiesListHelp.code, 0);
  assert.match(activitiesListHelp.stdout, /ADMIN_AUDIT/);
  assert.match(activitiesListHelp.stdout, /default: desc/);

  const settingsUpdateHelp = await runCli(["system", "settings", "update", "--help"]);
  assert.equal(settingsUpdateHelp.code, 0);
  assert.match(settingsUpdateHelp.stdout, /token \+ admin key required/i);
  assert.match(settingsUpdateHelp.stdout, /--patch-file <path>/);
  assert.match(settingsUpdateHelp.stdout, /max 1000 chars/);

  const settingsHistoryHelp = await runCli(["system", "settings", "history", "--help"]);
  assert.equal(settingsHistoryHelp.code, 0);
  assert.match(settingsHistoryHelp.stdout, /page size \(1-100, default: 20\)/);
});

test("cli system settings update requires patch input with a validation error", async () => {
  const result = await runCli([
    "--base-url",
    "http://127.0.0.1:1",
    "--token",
    "token-1",
    "--admin-key",
    "admin-1",
    "system",
    "settings",
    "update",
    "--apply-to",
    "next"
  ]);

  assert.equal(result.code, 2);
  const errorJson = JSON.parse(result.stderr.trim()) as {
    type: string;
    command: string;
    message: string;
  };
  assert.equal(errorJson.type, "VALIDATION_ERROR");
  assert.equal(errorJson.command, "system settings update");
  assert.match(errorJson.message, /--patch-json or --patch-file is required/);
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

test("cli auth login requires local wallet private key when no override is provided", async () => {
  const isolatedConfigPath = join(tmpdir(), `agentrade-cli-login-missing-${process.pid}-${Date.now()}.json`);
  const result = await runCli(
    ["--base-url", "http://127.0.0.1:1", "auth", "login"],
    { AGENTRADE_CLI_CONFIG_PATH: isolatedConfigPath }
  );
  assert.equal(result.code, 3);
  const errorJson = JSON.parse(result.stderr.trim()) as {
    type: string;
    command: string;
    message: string;
  };
  assert.equal(errorJson.type, "CONFIG_ERROR");
  assert.equal(errorJson.command, "auth login");
  assert.match(errorJson.message, /missing wallet private key/i);
});

test("cli auth login blocks mismatched --address and --private-key before network request", async () => {
  const result = await runCli([
    "--base-url",
    "http://127.0.0.1:1",
    "auth",
    "login",
    "--address",
    "0x1111111111111111111111111111111111111111",
    "--private-key",
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  ]);
  assert.equal(result.code, 2);
  const errorJson = JSON.parse(result.stderr.trim()) as {
    type: string;
    command: string;
    message: string;
  };
  assert.equal(errorJson.type, "VALIDATION_ERROR");
  assert.equal(errorJson.command, "auth login");
  assert.match(errorJson.message, /does not match the resolved private key address/i);
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

test("cli tasks list blocks invalid status enum before network request", async () => {
  const result = await runCli([
    "--base-url",
    "http://127.0.0.1:1",
    "tasks",
    "list",
    "--status",
    "DONE"
  ]);
  assert.equal(result.code, 2);
  const errorJson = JSON.parse(result.stderr.trim()) as {
    type: string;
    command: string;
    message: string;
  };
  assert.equal(errorJson.type, "VALIDATION_ERROR");
  assert.equal(errorJson.command, "tasks list");
  assert.match(errorJson.message, /--status must be OPEN\|IN_PROGRESS\|TERMINATED\|CLOSED/);
});

test("cli tasks list blocks limit above pagination cap before network request", async () => {
  const result = await runCli([
    "--base-url",
    "http://127.0.0.1:1",
    "tasks",
    "list",
    "--limit",
    "101"
  ]);
  assert.equal(result.code, 2);
  const errorJson = JSON.parse(result.stderr.trim()) as {
    type: string;
    command: string;
    message: string;
  };
  assert.equal(errorJson.type, "VALIDATION_ERROR");
  assert.equal(errorJson.command, "tasks list");
  assert.match(errorJson.message, /--limit must be <= 100/);
});

test("cli agents profile update blocks overlong name before network request", async () => {
  const result = await runCli([
    "--base-url",
    "http://127.0.0.1:1",
    "--token",
    "token-1",
    "agents",
    "profile",
    "update",
    "--address",
    "0x1111111111111111111111111111111111111111",
    "--name",
    "x".repeat(121)
  ]);
  assert.equal(result.code, 2);
  const errorJson = JSON.parse(result.stderr.trim()) as {
    type: string;
    command: string;
    message: string;
  };
  assert.equal(errorJson.type, "VALIDATION_ERROR");
  assert.equal(errorJson.command, "agents profile update");
  assert.match(errorJson.message, /--name must be <= 120 characters/);
});

test("cli system settings reset blocks overlong reason before network request", async () => {
  const result = await runCli([
    "--base-url",
    "http://127.0.0.1:1",
    "--token",
    "token-1",
    "--admin-key",
    "admin-1",
    "system",
    "settings",
    "reset",
    "--apply-to",
    "current",
    "--reason",
    "x".repeat(1001)
  ]);
  assert.equal(result.code, 2);
  const errorJson = JSON.parse(result.stderr.trim()) as {
    type: string;
    command: string;
    message: string;
  };
  assert.equal(errorJson.type, "VALIDATION_ERROR");
  assert.equal(errorJson.command, "system settings reset");
  assert.match(errorJson.message, /--reason must be <= 1000 characters/);
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

test("cli activities list accepts TASK_SUBMITTED, SUBMISSION_REJECTED, and ADMIN_AUDIT enum values", async () => {
  for (const activityType of ["TASK_SUBMITTED", "SUBMISSION_REJECTED", "ADMIN_AUDIT"] as const) {
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
