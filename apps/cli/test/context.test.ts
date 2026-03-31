import assert from "node:assert/strict";
import test from "node:test";
import type { Command } from "commander";
import { CliConfigError, CliValidationError } from "../src/errors.js";
import { resolveGlobalOptions } from "../src/context.js";

const mockCommand = (options: Record<string, unknown>): Command => {
  return {
    optsWithGlobals: () => options
  } as unknown as Command;
};

test("context: resolve global options from strings", () => {
  const options = resolveGlobalOptions(
    mockCommand({
      baseUrl: "https://api.example.com",
      token: "token-1",
      adminKey: "admin-1",
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

test("context: base url and numeric guards are validated", () => {
  assert.throws(
    () => resolveGlobalOptions(mockCommand({ baseUrl: "   " })),
    CliConfigError
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
});
