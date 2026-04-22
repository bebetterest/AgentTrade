import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseCliSuccessEnvelope } from "./success-envelope.js";

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../../..");
const cliDistEntry = resolve(repoRoot, "apps/cli/dist/index.js");

const runDistCli = async (args: string[], env: NodeJS.ProcessEnv = {}): Promise<CliResult> => {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("node", [cliDistEntry, ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
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

test("dist smoke: discovery output remains plain text while command help documents the exception", async () => {
  const help = await runDistCli(["--help"]);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /success: command execution writes stdout JSON with \{ok,command,data,warnings\?\}/);
  assert.match(help.stdout, /exception: --help and --version write plain text to stdout/i);
  assert.equal(help.stderr.trim(), "");

  const version = await runDistCli(["--version"]);
  assert.equal(version.code, 0);
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/);
  assert.equal(version.stderr.trim(), "");
});

test("dist smoke: command success output uses the stable envelope", async () => {
  const configDir = mkdtempSync(join(tmpdir(), "agentrade-cli-dist-smoke-envelope-"));
  const configPath = join(configDir, "config.json");

  const result = await runDistCli(["config", "show"], {
    AGENTRADE_CLI_CONFIG_PATH: configPath
  });

  assert.equal(result.code, 0, result.stderr);
  const envelope = parseCliSuccessEnvelope<{
    path: string;
    exists: boolean;
    configured: { baseUrl: string | null };
    effective: { baseUrl: string };
  }>(result.stdout);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.command, "config show");
  assert.equal(envelope.data.path, configPath);
  assert.equal(envelope.data.exists, false);
  assert.equal(envelope.data.configured.baseUrl, null);
  assert.match(envelope.data.effective.baseUrl, /^https?:\/\//);
  assert.equal(envelope.warnings, undefined);
});

test("dist smoke: config warnings stay at envelope top-level", async () => {
  const configDir = mkdtempSync(join(tmpdir(), "agentrade-cli-dist-smoke-warnings-"));
  const configPath = join(configDir, "config.json");

  writeFileSync(
    configPath,
    JSON.stringify(
      {
        baseUrl: "https://api.example.com",
        token: "legacy-plaintext-token",
        adminKey: "legacy-plaintext-admin-key"
      },
      null,
      2
    ),
    "utf8"
  );

  const result = await runDistCli(["config", "show"], {
    AGENTRADE_CLI_CONFIG_PATH: configPath
  });

  assert.equal(result.code, 0, result.stderr);
  const envelope = parseCliSuccessEnvelope<{
    configured: {
      token: string | null;
      adminKey: string | null;
      tokenConfigured: boolean;
      adminKeyConfigured: boolean;
    };
    warnings?: unknown;
  }>(result.stdout);

  assert.equal(envelope.command, "config show");
  assert.equal(envelope.data.configured.token, "***configured***");
  assert.equal(envelope.data.configured.adminKey, "***configured***");
  assert.equal(envelope.data.configured.tokenConfigured, true);
  assert.equal(envelope.data.configured.adminKeyConfigured, true);
  assert.equal(envelope.data.warnings, undefined);
  assert.equal(envelope.warnings?.length, 2);
  assert.deepEqual(
    envelope.warnings?.map((warning) => warning.field).sort(),
    ["adminKey", "token"]
  );
});
