import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Command } from "commander";
import { cliRuntimeDefaults } from "@agentrade/config";
import {
  CLI_DEFAULT_BASE_URL,
  CLI_DEFAULT_RETRIES,
  CLI_DEFAULT_TIMEOUT_MS
} from "../src/cli-config.js";
import { CliValidationError } from "../src/errors.js";
import { resolveGlobalOptions } from "../src/context.js";

const mockCommand = (options: Record<string, unknown>): Command => {
  return {
    optsWithGlobals: () => options
  } as unknown as Command;
};

test("context: cli defaults are sourced from shared config", () => {
  assert.equal(CLI_DEFAULT_BASE_URL, cliRuntimeDefaults.baseUrl);
  assert.equal(CLI_DEFAULT_TIMEOUT_MS, cliRuntimeDefaults.timeoutMs);
  assert.equal(CLI_DEFAULT_RETRIES, cliRuntimeDefaults.retries);
});

test("context: resolve global options from strings", () => {
  const options = resolveGlobalOptions(
    mockCommand({
      baseUrl: "https://api.example.com",
      token: "  token-1  ",
      adminKey: "  admin-1  ",
      timeoutMs: "2000",
      retries: "3",
      pretty: true
    })
  );

  assert.deepEqual(options, {
    baseUrl: "https://api.example.com",
    token: "token-1",
    adminKey: "admin-1",
    timeoutMs: 2000,
    retries: 3,
    pretty: true
  });
});

test("context: resolve global options from numeric commander values", () => {
  const options = resolveGlobalOptions(
    mockCommand({
      baseUrl: "http://localhost:3000",
      timeoutMs: 1500,
      retries: 0
    })
  );

  assert.equal(options.timeoutMs, 1500);
  assert.equal(options.retries, 0);
  assert.equal(options.pretty, false);
});

test("context: merge persisted config with CLI overrides", () => {
  const persisted = {
    baseUrl: "https://persisted.example.com",
    token: "persisted-token",
    adminKey: "persisted-admin-key",
    timeoutMs: 4000,
    retries: 4
  };

  const fromPersisted = resolveGlobalOptions(mockCommand({}), persisted);
  assert.equal(fromPersisted.baseUrl, persisted.baseUrl);
  assert.equal(fromPersisted.token, persisted.token);
  assert.equal(fromPersisted.adminKey, persisted.adminKey);
  assert.equal(fromPersisted.timeoutMs, persisted.timeoutMs);
  assert.equal(fromPersisted.retries, persisted.retries);

  const overridden = resolveGlobalOptions(
    mockCommand({
      baseUrl: "https://cli.example.com",
      token: "cli-token",
      adminKey: "cli-admin-key",
      timeoutMs: "7000",
      retries: "2"
    }),
    persisted
  );
  assert.equal(overridden.baseUrl, "https://cli.example.com");
  assert.equal(overridden.token, "cli-token");
  assert.equal(overridden.adminKey, "cli-admin-key");
  assert.equal(overridden.timeoutMs, 7000);
  assert.equal(overridden.retries, 2);
});

test("context: encrypted persisted creds are not eagerly decrypted during option resolution", () => {
  const options = resolveGlobalOptions(
    mockCommand({}),
    {
      baseUrl: "https://persisted.example.com",
      token: "enc:v1:not-a-real-token-payload",
      adminKey: "enc:v1:not-a-real-admin-payload"
    }
  );

  assert.equal(options.baseUrl, "https://persisted.example.com");
  assert.equal(options.token, undefined);
  assert.equal(options.adminKey, undefined);
});

test("context: token/admin key can be resolved from files", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "agentrade-cli-context-"));
  const tokenFile = join(tmpDir, "token.txt");
  const adminKeyFile = join(tmpDir, "admin-key.txt");
  writeFileSync(tokenFile, "\uFEFFtoken-from-file\n", "utf8");
  writeFileSync(adminKeyFile, "\uFEFFadmin-from-file\n", "utf8");

  const options = resolveGlobalOptions(
    mockCommand({
      baseUrl: "https://api.example.com",
      tokenFile,
      adminKeyFile
    })
  );

  assert.equal(options.token, "token-from-file");
  assert.equal(options.adminKey, "admin-from-file");
});

test("context: defaults apply when CLI and persisted config are empty", () => {
  const options = resolveGlobalOptions(mockCommand({}), {});
  assert.equal(options.baseUrl, CLI_DEFAULT_BASE_URL);
  assert.equal(options.timeoutMs, CLI_DEFAULT_TIMEOUT_MS);
  assert.equal(options.retries, CLI_DEFAULT_RETRIES);
  assert.equal(options.token, undefined);
  assert.equal(options.adminKey, undefined);
});

test("context: base url and numeric guards are validated", () => {
  assert.throws(
    () => resolveGlobalOptions(mockCommand({ baseUrl: "   " })),
    CliValidationError
  );
  assert.throws(
    () => resolveGlobalOptions(mockCommand({ baseUrl: "ftp://example.com" })),
    CliValidationError
  );
  assert.throws(
    () => resolveGlobalOptions(mockCommand({ baseUrl: "http://localhost:3000", timeoutMs: "0" })),
    CliValidationError
  );
  assert.throws(
    () => resolveGlobalOptions(mockCommand({ baseUrl: "http://localhost:3000", retries: "-1" })),
    CliValidationError
  );
  assert.throws(
    () =>
      resolveGlobalOptions(
        mockCommand({
          baseUrl: "http://localhost:3000",
          token: "token-inline",
          tokenFile: "/tmp/token.txt"
        })
      ),
    CliValidationError
  );
});
