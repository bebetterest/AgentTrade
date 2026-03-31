import assert from "node:assert/strict";
import test from "node:test";
import { ApiClientError } from "@agentrade/sdk";
import { CliConfigError, CliValidationError } from "../src/errors.js";
import { normalizeCliError, shouldSuppressCommanderError } from "../src/output.js";

test("error contract: validation", () => {
  const result = normalizeCliError(new CliValidationError("bad flag"), "tasks create");
  assert.equal(result.exitCode, 2);
  assert.deepEqual(result.output, {
    type: "VALIDATION_ERROR",
    message: "bad flag",
    httpStatus: null,
    apiError: null,
    issues: null,
    retryable: false,
    command: "tasks create"
  });
});

test("error contract: config", () => {
  const result = normalizeCliError(new CliConfigError("missing token"), "tasks create");
  assert.equal(result.exitCode, 3);
  assert.equal(result.output.type, "CONFIG_ERROR");
  assert.equal(result.output.command, "tasks create");
});

test("error contract: api and network", () => {
  const apiResult = normalizeCliError(
    new ApiClientError("forbidden", {
      httpStatus: 403,
      apiError: "FORBIDDEN",
      retryable: false,
      issues: null
    }),
    "tasks terminate"
  );
  assert.equal(apiResult.exitCode, 4);
  assert.equal(apiResult.output.type, "API_ERROR");
  assert.equal(apiResult.output.httpStatus, 403);
  assert.equal(apiResult.output.apiError, "FORBIDDEN");

  const networkResult = normalizeCliError(
    new ApiClientError("socket hang up", {
      retryable: true
    }),
    "tasks list"
  );
  assert.equal(networkResult.exitCode, 5);
  assert.equal(networkResult.output.type, "NETWORK_ERROR");
  assert.equal(networkResult.output.retryable, true);
});

test("error contract: sdk missing credential maps to config", () => {
  const configResult = normalizeCliError(
    new ApiClientError("missing bearer token", {
      apiError: "MISSING_BEARER_TOKEN"
    }),
    "tasks accept"
  );
  assert.equal(configResult.exitCode, 3);
  assert.equal(configResult.output.type, "CONFIG_ERROR");
  assert.equal(configResult.output.apiError, "MISSING_BEARER_TOKEN");
});

test("error contract: unknown", () => {
  const result = normalizeCliError(new Error("boom"), "system health");
  assert.equal(result.exitCode, 10);
  assert.equal(result.output.type, "UNKNOWN_ERROR");
  assert.equal(result.output.command, "system health");
});

test("error contract: non-commander code-like errors are unknown", () => {
  const result = normalizeCliError({ message: "missing file", code: "ENOENT" }, "tasks submit");
  assert.equal(result.exitCode, 10);
  assert.equal(result.output.type, "UNKNOWN_ERROR");
  assert.equal(result.output.command, "tasks submit");
});

test("error contract: commandPath from error object has higher priority", () => {
  const result = normalizeCliError(
    {
      message: "bad payload",
      commandPath: "disputes open"
    },
    "tasks create"
  );
  assert.equal(result.output.command, "disputes open");
});

test("error contract: commander suppression", () => {
  assert.equal(shouldSuppressCommanderError({ code: "commander.helpDisplayed", exitCode: 0, message: "help" }), true);
  assert.equal(shouldSuppressCommanderError({ code: "commander.unknownOption", exitCode: 1, message: "bad" }), false);
  assert.equal(shouldSuppressCommanderError(new Error("boom")), false);
});
