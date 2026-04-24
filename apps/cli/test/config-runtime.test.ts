import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseCliSuccessEnvelope, unwrapCliSuccess } from "./success-envelope.js";

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
    const setBaseJson = unwrapCliSuccess<{
      action: string;
      key: string;
      configured: { baseUrl: string | null };
    }>(setBase.stdout);
    assert.equal(setBaseJson.action, "set");
    assert.equal(setBaseJson.key, "baseUrl");
    assert.equal(setBaseJson.configured.baseUrl, "https://api.example.com");

    const tokenValue = "token-1234567890";
    const tokenFile = join(dirname(configPath), "token.txt");
    writeFileSync(tokenFile, `\uFEFF${tokenValue}\n`, "utf8");

    const setToken = await runCli(["config", "set", "token", "--value-file", tokenFile], configPath);
    assert.equal(setToken.code, 0, setToken.stderr);
    const setTokenJson = unwrapCliSuccess<{
      configured: { tokenConfigured: boolean; token: string | null };
      effective: { tokenConfigured: boolean };
    }>(setToken.stdout);
    assert.equal(setTokenJson.configured.tokenConfigured, true);
    assert.equal(setTokenJson.effective.tokenConfigured, true);
    assert.equal(setTokenJson.configured.token, "***encrypted***");

    const adminKeyValue = "admin-key-1234567890";
    const setAdminKey = await runCli(
      ["config", "set", "admin-key", adminKeyValue],
      configPath
    );
    assert.equal(setAdminKey.code, 0, setAdminKey.stderr);
    const setAdminJson = unwrapCliSuccess<{
      configured: { adminKeyConfigured: boolean; adminKey: string | null };
      effective: { adminKeyConfigured: boolean };
    }>(setAdminKey.stdout);
    assert.equal(setAdminJson.configured.adminKeyConfigured, true);
    assert.equal(setAdminJson.effective.adminKeyConfigured, true);
    assert.equal(setAdminJson.configured.adminKey, "***encrypted***");

    const persistedConfigTextAfterSecrets = readFileSync(configPath, "utf8");
    assert.ok(!persistedConfigTextAfterSecrets.includes(tokenValue));
    assert.ok(!persistedConfigTextAfterSecrets.includes(adminKeyValue));
    assert.match(persistedConfigTextAfterSecrets, /"token":\s*"enc:v1:/);
    assert.match(persistedConfigTextAfterSecrets, /"adminKey":\s*"enc:v1:/);

    const walletAddress = "0x1111111111111111111111111111111111111111";
    const walletPrivateKey = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const walletPrivateKeyFile = join(dirname(configPath), "wallet-private-key.txt");
    writeFileSync(walletPrivateKeyFile, `\uFEFF${walletPrivateKey}\n`, "utf8");

    const setWalletAddress = await runCli(
      ["config", "set", "wallet-address", walletAddress],
      configPath
    );
    assert.equal(setWalletAddress.code, 0, setWalletAddress.stderr);
    const setWalletAddressJson = unwrapCliSuccess<{
      configured: { walletAddress: string | null; walletAddressConfigured: boolean };
      effective: { walletAddress: string | null; walletAddressConfigured: boolean };
    }>(setWalletAddress.stdout);
    assert.equal(setWalletAddressJson.configured.walletAddress, walletAddress);
    assert.equal(setWalletAddressJson.configured.walletAddressConfigured, true);
    assert.equal(setWalletAddressJson.effective.walletAddressConfigured, true);

    const setWalletPrivateKey = await runCli(
      ["config", "set", "wallet-private-key", "--value-file", walletPrivateKeyFile],
      configPath
    );
    assert.equal(setWalletPrivateKey.code, 0, setWalletPrivateKey.stderr);
    const setWalletPrivateKeyJson = unwrapCliSuccess<{
      configured: { walletPrivateKey: string | null; walletPrivateKeyConfigured: boolean };
      effective: { walletPrivateKeyConfigured: boolean };
    }>(setWalletPrivateKey.stdout);
    assert.equal(setWalletPrivateKeyJson.configured.walletPrivateKeyConfigured, true);
    assert.equal(setWalletPrivateKeyJson.effective.walletPrivateKeyConfigured, true);
    assert.equal(setWalletPrivateKeyJson.configured.walletPrivateKey, "***encrypted***");
    const persistedConfigText = readFileSync(configPath, "utf8");
    assert.ok(!persistedConfigText.includes(walletPrivateKey));
    assert.match(persistedConfigText, /"walletPrivateKey":\s*"enc:v1:/);

    const show = await runCli(["config", "show"], configPath);
    assert.equal(show.code, 0, show.stderr);
    const showJson = unwrapCliSuccess<{
      configured: {
        baseUrl: string | null;
        tokenConfigured: boolean;
        adminKeyConfigured: boolean;
        walletAddress: string | null;
        walletPrivateKeyConfigured: boolean;
      };
    }>(show.stdout);
    assert.equal(showJson.configured.baseUrl, "https://api.example.com");
    assert.equal(showJson.configured.tokenConfigured, true);
    assert.equal(showJson.configured.adminKeyConfigured, true);
    assert.equal(showJson.configured.walletAddress, walletAddress);
    assert.equal(showJson.configured.walletPrivateKeyConfigured, true);

    const unsetToken = await runCli(["config", "unset", "token"], configPath);
    assert.equal(unsetToken.code, 0, unsetToken.stderr);
    const unsetTokenJson = unwrapCliSuccess<{
      configured: { tokenConfigured: boolean };
    }>(unsetToken.stdout);
    assert.equal(unsetTokenJson.configured.tokenConfigured, false);

    const unsetAdmin = await runCli(["config", "unset", "admin-key"], configPath);
    assert.equal(unsetAdmin.code, 0, unsetAdmin.stderr);
    const unsetAdminJson = unwrapCliSuccess<{
      configured: { adminKeyConfigured: boolean };
    }>(unsetAdmin.stdout);
    assert.equal(unsetAdminJson.configured.adminKeyConfigured, false);

    const unsetWalletAddress = await runCli(["config", "unset", "wallet-address"], configPath);
    assert.equal(unsetWalletAddress.code, 0, unsetWalletAddress.stderr);
    const unsetWalletAddressJson = unwrapCliSuccess<{
      configured: { walletAddressConfigured: boolean };
    }>(unsetWalletAddress.stdout);
    assert.equal(unsetWalletAddressJson.configured.walletAddressConfigured, false);

    const unsetWalletPrivateKey = await runCli(["config", "unset", "wallet-private-key"], configPath);
    assert.equal(unsetWalletPrivateKey.code, 0, unsetWalletPrivateKey.stderr);
    const unsetWalletPrivateKeyJson = unwrapCliSuccess<{
      configured: { walletPrivateKeyConfigured: boolean };
    }>(unsetWalletPrivateKey.stdout);
    assert.equal(unsetWalletPrivateKeyJson.configured.walletPrivateKeyConfigured, false);

    const unsetAll = await runCli(["config", "unset", "all"], configPath);
    assert.equal(unsetAll.code, 0, unsetAll.stderr);
    const unsetAllJson = unwrapCliSuccess<{
      exists: boolean;
      configured: { baseUrl: string | null };
    }>(unsetAll.stdout);
    assert.equal(unsetAllJson.exists, false);
    assert.equal(unsetAllJson.configured.baseUrl, null);
  } finally {
    cleanup();
  }
});

test("cli config command: plaintext wallet-private-key in persisted config fails fast", async () => {
  const { configPath, cleanup } = createConfigPath();

  try {
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          walletAddress: "0x1111111111111111111111111111111111111111",
          walletPrivateKey: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        },
        null,
        2
      ),
      "utf8"
    );

    const show = await runCli(["config", "show"], configPath);
    const combined = show.stderr.replace(/\s+/g, " ");
    assert.ok(
      /"type":"CONFIG_ERROR"/.test(combined) &&
        /"command":"config show"/.test(combined) &&
        combined.includes("plaintext walletPrivateKey is unsupported") &&
        combined.includes("remove the walletPrivateKey field or delete the CLI config file, then")
    );
  } finally {
    cleanup();
  }
});

test("cli auth login fails fast when persisted wallet-private-key is plaintext", async () => {
  const { configPath, cleanup } = createConfigPath();

  try {
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          walletAddress: "0x1111111111111111111111111111111111111111",
          walletPrivateKey: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        },
        null,
        2
      ),
      "utf8"
    );

    const login = await runCli(["auth", "login"], configPath);
    const combined = login.stderr.replace(/\s+/g, " ");
    assert.ok(
      /"type":"CONFIG_ERROR"/.test(combined) &&
        /"command":"auth login"/.test(combined) &&
        combined.includes("plaintext walletPrivateKey is unsupported") &&
        combined.includes("remove the walletPrivateKey field or delete the CLI config file, then")
    );
  } finally {
    cleanup();
  }
});

test("cli config show warns on legacy plaintext token/admin-key without leaking them", async () => {
  const { configPath, cleanup } = createConfigPath();

  try {
    const legacyToken = "legacy-plaintext-token-1234567890";
    const legacyAdminKey = "legacy-plaintext-admin-key-1234567890";

    writeFileSync(
      configPath,
      JSON.stringify(
        {
          baseUrl: "https://api.example.com",
          token: legacyToken,
          adminKey: legacyAdminKey
        },
        null,
        2
      ),
      "utf8"
    );

    const show = await runCli(["config", "show"], configPath);
    assert.equal(show.code, 0, show.stderr);
    const showEnvelope = parseCliSuccessEnvelope<{
      configured: {
        token: string | null;
        adminKey: string | null;
        tokenConfigured: boolean;
        adminKeyConfigured: boolean;
      };
    }>(show.stdout);
    const showJson = showEnvelope.data;
    assert.equal(showJson.configured.token, "***configured***");
    assert.equal(showJson.configured.adminKey, "***configured***");
    assert.equal(showJson.configured.tokenConfigured, true);
    assert.equal(showJson.configured.adminKeyConfigured, true);
    assert.equal(showEnvelope.warnings?.length, 2);
    assert.deepEqual(
      showEnvelope.warnings?.map((warning) => warning.field).sort(),
      ["adminKey", "token"]
    );
    assert.ok(
      showEnvelope.warnings?.every(
        (warning) =>
          warning.code === "PLAINTEXT_PERSISTED_SECRET" &&
          warning.level === "WARNING" &&
          /not encrypted at rest/i.test(warning.message) &&
          /--value-file <path>/i.test(warning.message) &&
          /without exposing the secret in argv/i.test(warning.message)
      )
    );
    assert.doesNotMatch(show.stdout, /config set token <value>/);
    assert.doesNotMatch(show.stdout, /config set admin-key <value>/);
    assert.ok(!show.stdout.includes(legacyToken));
    assert.ok(!show.stdout.includes(legacyAdminKey));
  } finally {
    cleanup();
  }
});

test("cli global runtime: public reads ignore missing secret key for persisted creds", async () => {
  const { configPath, cleanup } = createConfigPath();
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: true, service: "lazy-secret-test" }));
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });

  try {
    const serverAddress = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${serverAddress.port}`;

    const setBaseUrl = await runCli(["config", "set", "base-url", baseUrl], configPath);
    assert.equal(setBaseUrl.code, 0, setBaseUrl.stderr);
    const setToken = await runCli(["config", "set", "token", "token-123"], configPath);
    assert.equal(setToken.code, 0, setToken.stderr);
    const setAdminKey = await runCli(["config", "set", "admin-key", "admin-key-123"], configPath);
    assert.equal(setAdminKey.code, 0, setAdminKey.stderr);

    rmSync(join(dirname(configPath), "wallet.key"), { force: true });

    const health = await runCli(["system", "health"], configPath);
    assert.equal(health.code, 0, health.stderr);
    assert.deepEqual(unwrapCliSuccess(health.stdout), {
      ok: true,
      service: "lazy-secret-test"
    });
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

test("cli global runtime: authenticated commands still fail when persisted secret key is missing", async () => {
  const { configPath, cleanup } = createConfigPath();

  try {
    const setToken = await runCli(["config", "set", "token", "token-123"], configPath);
    assert.equal(setToken.code, 0, setToken.stderr);

    rmSync(join(dirname(configPath), "wallet.key"), { force: true });

    const result = await runCli(["system", "metrics"], configPath);
    assert.equal(result.code, 3);
    const errorJson = JSON.parse(result.stderr.trim()) as {
      type: string;
      command: string;
      message: string;
    };
    assert.equal(errorJson.type, "CONFIG_ERROR");
    assert.equal(errorJson.command, "system metrics");
    assert.match(errorJson.message, /missing CLI secret key/i);
    assert.match(errorJson.message, /config set token --value-file <path>/i);
    assert.match(errorJson.message, /config set wallet-private-key --value-file <path>/i);
  } finally {
    cleanup();
  }
});

test("cli config command: write failures are structured config errors", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agentrade-cli-config-runtime-write-"));
  const parentFile = join(dir, "not-a-dir");
  const configPath = join(parentFile, "config.json");
  writeFileSync(parentFile, "not a directory", "utf8");

  try {
    const result = await runCli(["config", "set", "base-url", "https://api.example.com"], configPath);
    assert.equal(result.code, 3);
    const errorJson = JSON.parse(result.stderr.trim()) as {
      type: string;
      command: string;
      message: string;
    };
    assert.equal(errorJson.type, "CONFIG_ERROR");
    assert.equal(errorJson.command, "config set");
    assert.match(errorJson.message, /unable to create CLI config directory/i);
    assert.match(errorJson.message, /ENOTDIR|not a directory|EEXIST|file already exists/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
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
    assert.deepEqual(unwrapCliSuccess(health.stdout), { ok: true, service: "config-test" });
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
    assert.deepEqual(unwrapCliSuccess(health.stdout), { ok: true, service: "override-test" });
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
