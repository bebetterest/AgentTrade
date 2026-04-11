import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
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

const runCli = async (
  args: string[],
  configPath: string,
  env: NodeJS.ProcessEnv = {}
): Promise<CliResult> => {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(cliBin, [cliEntry, ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        AGENTRADE_CLI_CONFIG_PATH: configPath,
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

const createConfigPath = (): { configPath: string; cleanup: () => void } => {
  const dir = mkdtempSync(join(tmpdir(), "agentrade-cli-config-runtime-"));
  return {
    configPath: join(dir, "config.json"),
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
    }
  };
};

test("cli config command: set/show/unset persisted values", async () => {
  const { configPath, cleanup } = createConfigPath();

  try {
    const setBase = await runCli(["config", "set", "base-url", "https://api.example.com"], configPath);
    assert.equal(setBase.code, 0, setBase.stderr);
    const setBaseJson = JSON.parse(setBase.stdout.trim()) as {
      action: string;
      key: string;
      configured: { baseUrl: string | null };
    };
    assert.equal(setBaseJson.action, "set");
    assert.equal(setBaseJson.key, "baseUrl");
    assert.equal(setBaseJson.configured.baseUrl, "https://api.example.com");

    const setToken = await runCli(["config", "set", "token", "token-1234567890"], configPath);
    assert.equal(setToken.code, 0, setToken.stderr);
    const setTokenJson = JSON.parse(setToken.stdout.trim()) as {
      configured: { tokenConfigured: boolean; token: string | null };
      effective: { tokenConfigured: boolean };
    };
    assert.equal(setTokenJson.configured.tokenConfigured, true);
    assert.equal(setTokenJson.effective.tokenConfigured, true);
    assert.ok(setTokenJson.configured.token?.includes("..."));

    const setAdminKey = await runCli(
      ["config", "set", "admin-key", "admin-key-1234567890"],
      configPath
    );
    assert.equal(setAdminKey.code, 0, setAdminKey.stderr);
    const setAdminJson = JSON.parse(setAdminKey.stdout.trim()) as {
      configured: { adminKeyConfigured: boolean; adminKey: string | null };
      effective: { adminKeyConfigured: boolean };
    };
    assert.equal(setAdminJson.configured.adminKeyConfigured, true);
    assert.equal(setAdminJson.effective.adminKeyConfigured, true);
    assert.ok(setAdminJson.configured.adminKey?.includes("..."));

    const show = await runCli(["config", "show"], configPath);
    assert.equal(show.code, 0, show.stderr);
    const showJson = JSON.parse(show.stdout.trim()) as {
      configured: { baseUrl: string | null; tokenConfigured: boolean; adminKeyConfigured: boolean };
    };
    assert.equal(showJson.configured.baseUrl, "https://api.example.com");
    assert.equal(showJson.configured.tokenConfigured, true);
    assert.equal(showJson.configured.adminKeyConfigured, true);

    const unsetToken = await runCli(["config", "unset", "token"], configPath);
    assert.equal(unsetToken.code, 0, unsetToken.stderr);
    const unsetTokenJson = JSON.parse(unsetToken.stdout.trim()) as {
      configured: { tokenConfigured: boolean };
    };
    assert.equal(unsetTokenJson.configured.tokenConfigured, false);

    const unsetAdmin = await runCli(["config", "unset", "admin-key"], configPath);
    assert.equal(unsetAdmin.code, 0, unsetAdmin.stderr);
    const unsetAdminJson = JSON.parse(unsetAdmin.stdout.trim()) as {
      configured: { adminKeyConfigured: boolean };
    };
    assert.equal(unsetAdminJson.configured.adminKeyConfigured, false);

    const unsetAll = await runCli(["config", "unset", "all"], configPath);
    assert.equal(unsetAll.code, 0, unsetAll.stderr);
    const unsetAllJson = JSON.parse(unsetAll.stdout.trim()) as {
      exists: boolean;
      configured: { baseUrl: string | null };
    };
    assert.equal(unsetAllJson.exists, false);
    assert.equal(unsetAllJson.configured.baseUrl, null);
  } finally {
    cleanup();
  }
});

test("cli global runtime: reads base-url from persisted config", async () => {
  const { configPath, cleanup } = createConfigPath();
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: true, service: "config-test" }));
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });

  try {
    const serverAddress = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${serverAddress.port}`;

    const setResult = await runCli(["config", "set", "base-url", baseUrl], configPath);
    assert.equal(setResult.code, 0, setResult.stderr);

    const health = await runCli(["system", "health"], configPath);
    assert.equal(health.code, 0, health.stderr);
    assert.deepEqual(JSON.parse(health.stdout.trim()), { ok: true, service: "config-test" });
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
    cleanup();
  }
});

test("cli global runtime: command flag overrides persisted base-url", async () => {
  const { configPath, cleanup } = createConfigPath();
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: true, service: "override-test" }));
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });

  try {
    const serverAddress = server.address() as AddressInfo;
    const overrideBaseUrl = `http://127.0.0.1:${serverAddress.port}`;

    const setResult = await runCli(
      ["config", "set", "base-url", "http://127.0.0.1:1"],
      configPath
    );
    assert.equal(setResult.code, 0, setResult.stderr);

    const health = await runCli(
      ["--base-url", overrideBaseUrl, "system", "health"],
      configPath
    );
    assert.equal(health.code, 0, health.stderr);
    assert.deepEqual(JSON.parse(health.stdout.trim()), { ok: true, service: "override-test" });
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
    cleanup();
  }
});

test("cli global runtime: invalid persisted config returns CONFIG_ERROR", async () => {
  const { configPath, cleanup } = createConfigPath();
  try {
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          baseUrl: "ftp://invalid",
          timeoutMs: -1
        },
        null,
        2
      ),
      "utf8"
    );

    const result = await runCli(["system", "health"], configPath);
    assert.equal(result.code, 3);
    const errorJson = JSON.parse(result.stderr.trim()) as {
      type: string;
      command: string;
      message: string;
    };
    assert.equal(errorJson.type, "CONFIG_ERROR");
    assert.equal(errorJson.command, "system health");
    assert.match(errorJson.message, /invalid CLI config/i);
  } finally {
    cleanup();
  }
});
