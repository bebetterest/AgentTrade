import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import type { Command } from "commander";
import { fileURLToPath } from "node:url";
import { getApiOperation } from "@agentrade/contracts";
import { buildProgram } from "../src/program.js";
import { cliOperationBindings } from "../src/operation-bindings.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../../..");

const docsOverviewEn = readFileSync(resolve(repoRoot, "docs/cli/overview.md"), "utf8");
const docsOverviewCn = readFileSync(resolve(repoRoot, "docs/cli/overview_cn.md"), "utf8");
const matrixEn = readFileSync(resolve(repoRoot, "apps/skill/references/command-matrix.md"), "utf8");
const matrixCn = readFileSync(resolve(repoRoot, "apps/skill/references/command-matrix_cn.md"), "utf8");
const errorHandlingEn = readFileSync(resolve(repoRoot, "apps/skill/references/error-handling.md"), "utf8");
const errorHandlingCn = readFileSync(resolve(repoRoot, "apps/skill/references/error-handling_cn.md"), "utf8");

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const collectLeafCommands = (root: Command): Array<{ path: string; command: Command }> => {
  const leaves: Array<{ path: string; command: Command }> = [];

  const visit = (command: Command, segments: string[]): void => {
    const children = command.commands;
    if (children.length === 0) {
      leaves.push({ path: segments.join(" "), command });
      return;
    }

    for (const child of children) {
      visit(child, [...segments, child.name()]);
    }
  };

  for (const child of root.commands) {
    visit(child, [child.name()]);
  }

  return leaves;
};

test("cli command surface and docs matrix stay in sync", () => {
  const program = buildProgram();
  const leaves = collectLeafCommands(program);
  const commandPaths = leaves.map((item) => item.path).sort();
  const localCompositeCommands = new Set([
    "auth register",
    "config set",
    "config show",
    "config unset"
  ]);

  assert.equal(commandPaths.length, 40);
  assert.deepEqual(commandPaths, [
    "activities list",
    "agents list",
    "agents profile get",
    "agents profile update",
    "agents stats",
    "auth challenge",
    "auth register",
    "auth verify",
    "config set",
    "config show",
    "config unset",
    "cycles active",
    "cycles get",
    "cycles list",
    "cycles rewards",
    "dashboard summary",
    "dashboard trends",
    "disputes get",
    "disputes list",
    "disputes open",
    "disputes vote",
    "economy params",
    "ledger get",
    "submissions confirm",
    "submissions get",
    "submissions list",
    "submissions reject",
    "system health",
    "system metrics",
    "system settings get",
    "system settings history",
    "system settings reset",
    "system settings update",
    "tasks create",
    "tasks get",
    "tasks intend",
    "tasks intentions",
    "tasks list",
    "tasks submit",
    "tasks terminate"
  ]);

  const contractBackedCommandPaths = commandPaths.filter((path) => !localCompositeCommands.has(path));
  assert.deepEqual(Object.keys(cliOperationBindings).sort(), contractBackedCommandPaths);

  for (const item of leaves) {
    const commandPattern = new RegExp(`\`${escapeRegExp(item.path)}\``);
    assert.match(docsOverviewEn, commandPattern, `missing in docs/cli/overview.md: ${item.path}`);
    assert.match(docsOverviewCn, commandPattern, `missing in docs/cli/overview_cn.md: ${item.path}`);
    assert.match(matrixEn, commandPattern, `missing in command-matrix.md: ${item.path}`);
    assert.match(matrixCn, commandPattern, `missing in command-matrix_cn.md: ${item.path}`);

    assert.ok(item.command.description().trim().length > 0, `missing command description: ${item.path}`);
    for (const option of item.command.options) {
      const flags = option.flags;
      if (flags.includes("--help") || flags.includes("-h")) {
        continue;
      }
      assert.ok(option.description.trim().length > 0, `missing option description: ${item.path} ${flags}`);
    }
  }

  for (const [commandPath, operationId] of Object.entries(cliOperationBindings)) {
    const operation = getApiOperation(operationId);
    const routePattern = new RegExp(
      `\\|[^\\n]*\\\`${escapeRegExp(commandPath)}\\\`[^\\n]*\\\`${escapeRegExp(`${operation.method} ${operation.pathTemplate}`)}\\\``
    );
    assert.equal(operation.version, "v2", `cli binding must target v2: ${commandPath}`);
    assert.match(
      matrixEn,
      routePattern,
      `missing contract route in command-matrix.md: ${commandPath} -> ${operation.method} ${operation.pathTemplate}`
    );
    assert.match(
      matrixCn,
      routePattern,
      `missing contract route in command-matrix_cn.md: ${commandPath} -> ${operation.method} ${operation.pathTemplate}`
    );
  }
});

test("error contracts stay mirrored in docs and skill references", () => {
  const requiredTypes = [
    "VALIDATION_ERROR",
    "CONFIG_ERROR",
    "API_ERROR",
    "NETWORK_ERROR",
    "UNKNOWN_ERROR"
  ];

  for (const errorType of requiredTypes) {
    const pattern = new RegExp(escapeRegExp(errorType));
    assert.match(docsOverviewEn, pattern, `missing ${errorType} in docs/cli/overview.md`);
    assert.match(errorHandlingEn, pattern, `missing ${errorType} in error-handling.md`);
  }

  const requiredExitCodes = ["0", "2", "3", "4", "5", "10"];
  for (const code of requiredExitCodes) {
    const pattern = new RegExp(`\\b${escapeRegExp(code)}\\b`);
    assert.match(docsOverviewEn, pattern, `missing exit code ${code} in docs/cli/overview.md`);
    assert.match(docsOverviewCn, pattern, `missing exit code ${code} in docs/cli/overview_cn.md`);
  }

  assert.match(errorHandlingCn, /VALIDATION_ERROR|参数\/输入\/通道护栏/);
  assert.match(errorHandlingCn, /CONFIG_ERROR|配置/);
  assert.match(errorHandlingCn, /API_ERROR/);
  assert.match(errorHandlingCn, /NETWORK_ERROR/);
  assert.match(errorHandlingCn, /UNKNOWN_ERROR/);
});
