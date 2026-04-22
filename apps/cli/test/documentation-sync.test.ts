import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import type { Command } from "commander";
import { fileURLToPath } from "node:url";
import { getApiOperation } from "@agentrade/contracts";
import { ActivityEventType } from "@agentrade/types";
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

const assertCommandRowContains = (
  source: string,
  sourceLabel: string,
  commandPath: string,
  requiredFragments: string[]
): void => {
  const lookaheads = requiredFragments
    .map((fragment) => `(?=[^\\n]*${escapeRegExp(fragment)})`)
    .join("");
  const pattern = new RegExp(`\\|[^\\n]*\\\`${escapeRegExp(commandPath)}\\\`${lookaheads}[^\\n]*`);
  assert.match(source, pattern, `missing documented fragments for ${commandPath} in ${sourceLabel}`);
};

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
    "auth login",
    "auth register",
    "config set",
    "config show",
    "config unset"
  ]);

  assert.equal(commandPaths.length, 42);
  assert.deepEqual(commandPaths, [
    "activities list",
    "agents list",
    "agents profile get",
    "agents profile update",
    "agents stats",
    "auth challenge",
    "auth login",
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
    "disputes respond",
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

  assert.doesNotMatch(docsOverviewEn, /HTTP_ERROR/, "stale HTTP_ERROR alias found in docs/cli/overview.md");
  assert.doesNotMatch(docsOverviewCn, /HTTP_ERROR/, "stale HTTP_ERROR alias found in docs/cli/overview_cn.md");
});

test("pagination limit guard stays documented in docs and skill references", () => {
  assert.match(docsOverviewEn, /`--limit`.*`1-100`/);
  assert.match(docsOverviewCn, /`--limit`.*`1-100`/);
  assert.match(matrixEn, /`--limit` 1-100/);
  assert.match(matrixCn, /`--limit` 1-100/);
  assert.match(docsOverviewEn, /default `20`/);
  assert.match(docsOverviewCn, /默认 `20`/);
  assert.match(matrixEn, /default `20`/);
  assert.match(matrixCn, /默认 `20`/);
});

test("list sort and order defaults stay documented in docs and skill references", () => {
  for (const commandPath of ["tasks list", "submissions list", "disputes list", "agents list"]) {
    assertCommandRowContains(docsOverviewEn, "docs/cli/overview.md", commandPath, ["default `latest`", "default `desc`"]);
    assertCommandRowContains(docsOverviewCn, "docs/cli/overview_cn.md", commandPath, ["默认 `latest`", "默认 `desc`"]);
    assertCommandRowContains(matrixEn, "apps/skill/references/command-matrix.md", commandPath, [
      "default `latest`",
      "default `desc`"
    ]);
    assertCommandRowContains(matrixCn, "apps/skill/references/command-matrix_cn.md", commandPath, [
      "默认 `latest`",
      "默认 `desc`"
    ]);
  }

  assertCommandRowContains(docsOverviewEn, "docs/cli/overview.md", "activities list", ["default `desc`"]);
  assertCommandRowContains(docsOverviewCn, "docs/cli/overview_cn.md", "activities list", ["默认 `desc`"]);
  assertCommandRowContains(matrixEn, "apps/skill/references/command-matrix.md", "activities list", ["default `desc`"]);
  assertCommandRowContains(matrixCn, "apps/skill/references/command-matrix_cn.md", "activities list", ["默认 `desc`"]);
});

test("text length guards stay documented in docs and skill references", () => {
  assert.match(docsOverviewEn, /name <= 120/);
  assert.match(docsOverviewEn, /bio <= 1000/);
  assert.match(docsOverviewEn, /reason.*1000/);
  assert.match(docsOverviewCn, /name <= 120/);
  assert.match(docsOverviewCn, /bio <= 1000/);
  assert.match(docsOverviewCn, /reason.*1000/);
  assert.match(matrixEn, /name<=120/);
  assert.match(matrixEn, /bio<=1000/);
  assert.match(matrixEn, /reason<=1000/);
  assert.match(matrixCn, /name<=120/);
  assert.match(matrixCn, /bio<=1000/);
  assert.match(matrixCn, /reason<=1000/);
});

test("text file BOM normalization stays documented in docs and skill references", () => {
  assert.match(docsOverviewEn, /strip a leading UTF-8 BOM/);
  assert.match(docsOverviewCn, /剥离前导 UTF-8 BOM/);
  assert.match(matrixEn, /strip a leading UTF-8 BOM/);
  assert.match(matrixCn, /剥离前导 UTF-8 BOM/);
});

test("dashboard defaults stay documented in docs and skill references", () => {
  assert.match(docsOverviewEn, /dashboard summary.*default `UTC`/);
  assert.match(docsOverviewEn, /dashboard trends.*default `UTC`.*default `7d`/);
  assert.match(docsOverviewCn, /dashboard summary.*默认 `UTC`/);
  assert.match(docsOverviewCn, /dashboard trends.*默认 `UTC`.*默认 `7d`/);
  assert.match(matrixEn, /dashboard summary.*default `UTC`/);
  assert.match(matrixEn, /dashboard trends.*default `UTC`.*default `7d`/);
  assert.match(matrixCn, /dashboard summary.*默认 `UTC`/);
  assert.match(matrixCn, /dashboard trends.*默认 `UTC`.*默认 `7d`/);
});

test("activity type notes stay aligned with the shared enum", () => {
  for (const activityType of Object.values(ActivityEventType)) {
    const pattern = new RegExp(escapeRegExp(activityType));
    assert.match(docsOverviewEn, pattern, `missing ${activityType} in docs/cli/overview.md`);
    assert.match(docsOverviewCn, pattern, `missing ${activityType} in docs/cli/overview_cn.md`);
  }
});
