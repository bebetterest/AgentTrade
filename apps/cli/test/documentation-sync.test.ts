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
import { cliRequestBindings } from "../src/request-bindings.js";

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
    "config unset",
    "spec"
  ]);

  assert.equal(commandPaths.length, 43);
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
    "spec",
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
  assert.deepEqual(Object.keys(cliRequestBindings).sort(), commandPaths);

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

test("success envelope stays documented in docs and skill references", () => {
  assert.match(docsOverviewEn, /\{ ok, command, data, warnings\? \}/);
  assert.match(docsOverviewCn, /\{ ok, command, data, warnings\? \}/);
  assert.match(matrixEn, /\{ ok, command, data, warnings\? \}/);
  assert.match(matrixCn, /\{ ok, command, data, warnings\? \}/);
  assert.match(docsOverviewEn, /--help.*--version.*plain text/);
  assert.match(docsOverviewCn, /--help.*--version.*纯文本/);
  assert.match(matrixEn, /--help.*--version.*plain text/);
  assert.match(matrixCn, /--help.*--version.*纯文本/);
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

test("stdin alias contract stays documented in docs and skill references", () => {
  assert.match(docsOverviewEn, /accept `-` to read UTF-8 from stdin/i);
  assert.match(docsOverviewCn, /接受 `-` 表示从 stdin 读取 UTF-8/);
  assert.match(docsOverviewEn, /only one stdin-backed input consumer/i);
  assert.match(docsOverviewCn, /只允许一个 stdin-backed 输入消费者/);
  assert.match(docsOverviewEn, /stdinFileAlias/);
  assert.match(docsOverviewCn, /stdinFileAlias/);
  assert.match(matrixEn, /accepts `-` to read UTF-8 from stdin/i);
  assert.match(matrixCn, /接受 `-` 表示从 stdin 读取 UTF-8/);
  assert.match(matrixEn, /Only one stdin-backed file input is allowed/i);
  assert.match(matrixCn, /只允许一个 stdin-backed 文件输入/);
});

test("spec auth requirement discovery stays documented in docs and skill references", () => {
  assert.match(docsOverviewEn, /authRequirements\[\]/);
  assert.match(docsOverviewCn, /authRequirements\[\]/);
  assert.match(docsOverviewEn, /persistedConfig\.token/);
  assert.match(docsOverviewCn, /persistedConfig\.token/);
  assert.match(docsOverviewEn, /persistedConfig\.adminKey/);
  assert.match(docsOverviewCn, /persistedConfig\.adminKey/);
  assert.match(matrixEn, /commands\[\]\.authRequirements\[\]/);
  assert.match(matrixCn, /commands\[\]\.authRequirements\[\]/);
});

test("spec local and composite execution discovery stays documented in docs and skill references", () => {
  assert.match(docsOverviewEn, /executionSteps\[\]/);
  assert.match(docsOverviewCn, /executionSteps\[\]/);
  assert.match(docsOverviewEn, /sideEffects\[\]/);
  assert.match(docsOverviewCn, /sideEffects\[\]/);
  assert.match(docsOverviewEn, /inputSources\[\]/);
  assert.match(docsOverviewCn, /inputSources\[\]/);
  assert.match(docsOverviewEn, /outputs\[\]/);
  assert.match(docsOverviewCn, /outputs\[\]/);
  assert.match(docsOverviewEn, /successFields\[\]/);
  assert.match(docsOverviewCn, /successFields\[\]/);
  assert.match(docsOverviewEn, /especially important for `executionMode=local\|composite` commands/i);
  assert.match(docsOverviewCn, /对 `executionMode=local\|composite` 命令尤其重要/);
  assert.match(matrixEn, /commands\[\]\.executionSteps\[\]/);
  assert.match(matrixCn, /commands\[\]\.executionSteps\[\]/);
  assert.match(matrixEn, /commands\[\]\.sideEffects\[\]/);
  assert.match(matrixCn, /commands\[\]\.sideEffects\[\]/);
  assert.match(matrixEn, /commands\[\]\.successFields\[\]/);
  assert.match(matrixCn, /commands\[\]\.successFields\[\]/);
  assert.match(docsOverviewEn, /successFields\[\].*response schema/i);
  assert.match(docsOverviewCn, /successFields\[\].*响应 schema/);
  assert.match(docsOverviewEn, /field-level `required` and `schema` metadata/i);
  assert.match(docsOverviewCn, /字段级 `required` 与 `schema` 元数据/);
  assert.match(matrixEn, /successFields\[\].*response schema/i);
  assert.match(matrixCn, /successFields\[\].*响应 schema/);
  assert.match(docsOverviewEn, /automationHints/);
  assert.match(docsOverviewCn, /automationHints/);
  assert.match(docsOverviewEn, /failureHints\[\]/);
  assert.match(docsOverviewCn, /failureHints\[\]/);
  assert.match(docsOverviewEn, /workflowHints/);
  assert.match(docsOverviewCn, /workflowHints/);
  assert.match(docsOverviewEn, /entityHints/);
  assert.match(docsOverviewCn, /entityHints/);
  assert.match(docsOverviewEn, /handoffHints\[\]/);
  assert.match(docsOverviewCn, /handoffHints\[\]/);
  assert.match(docsOverviewEn, /retryMode/);
  assert.match(docsOverviewCn, /retryMode/);
  assert.match(docsOverviewEn, /httpStatusClass/);
  assert.match(docsOverviewCn, /httpStatusClass/);
  assert.match(docsOverviewEn, /issuesKind/);
  assert.match(docsOverviewCn, /issuesKind/);
  assert.match(docsOverviewEn, /actorRoles\[\]/);
  assert.match(docsOverviewCn, /actorRoles\[\]/);
  assert.match(docsOverviewEn, /primaryEntity/);
  assert.match(docsOverviewCn, /primaryEntity/);
  assert.match(docsOverviewEn, /bindings\[\]/);
  assert.match(docsOverviewCn, /bindings\[\]/);
  assert.match(docsOverviewEn, /outputPaths\[\]/);
  assert.match(docsOverviewCn, /outputPaths\[\]/);
  assert.match(docsOverviewEn, /targetCommand/);
  assert.match(docsOverviewCn, /targetCommand/);
  assert.match(docsOverviewEn, /sourcePath/);
  assert.match(docsOverviewCn, /sourcePath/);
  assert.match(docsOverviewEn, /sourceInput/);
  assert.match(docsOverviewCn, /sourceInput/);
  assert.match(docsOverviewEn, /sourceLiteral/);
  assert.match(docsOverviewCn, /sourceLiteral/);
  assert.match(docsOverviewEn, /selectionMode/);
  assert.match(docsOverviewCn, /selectionMode/);
  assert.match(docsOverviewEn, /selectionConditions\[\]/);
  assert.match(docsOverviewCn, /selectionConditions\[\]/);
  assert.match(docsOverviewEn, /currentPageItem/);
  assert.match(docsOverviewCn, /currentPageItem/);
  assert.match(docsOverviewEn, /currentResult/);
  assert.match(docsOverviewCn, /currentResult/);
  assert.match(docsOverviewEn, /nonNull/);
  assert.match(docsOverviewCn, /nonNull/);
  assert.match(docsOverviewEn, /equals/);
  assert.match(docsOverviewCn, /equals/);
  assert.match(docsOverviewEn, /targetInputs\[\]/);
  assert.match(docsOverviewCn, /targetInputs\[\]/);
  assert.match(docsOverviewEn, /prerequisiteCommands\[\]/);
  assert.match(docsOverviewCn, /prerequisiteCommands\[\]/);
  assert.match(docsOverviewEn, /nextCommands\[\]/);
  assert.match(docsOverviewCn, /nextCommands\[\]/);
  assert.match(docsOverviewEn, /preflightCommands\[\]/);
  assert.match(docsOverviewCn, /preflightCommands\[\]/);
  assert.match(docsOverviewEn, /verificationCommands\[\]/);
  assert.match(docsOverviewCn, /verificationCommands\[\]/);
  assert.match(matrixEn, /commands\[\]\.failureHints\[\]/);
  assert.match(matrixCn, /commands\[\]\.failureHints\[\]/);
  assert.match(matrixEn, /commands\[\]\.workflowHints/);
  assert.match(matrixCn, /commands\[\]\.workflowHints/);
  assert.match(matrixEn, /commands\[\]\.entityHints/);
  assert.match(matrixCn, /commands\[\]\.entityHints/);
  assert.match(matrixEn, /commands\[\]\.handoffHints\[\]/);
  assert.match(matrixCn, /commands\[\]\.handoffHints\[\]/);
  assert.match(matrixEn, /sourceInput/);
  assert.match(matrixCn, /sourceInput/);
  assert.match(matrixEn, /sourceLiteral/);
  assert.match(matrixCn, /sourceLiteral/);
  assert.match(matrixEn, /selectionMode/);
  assert.match(matrixCn, /selectionMode/);
  assert.match(matrixEn, /selectionConditions\[\]/);
  assert.match(matrixCn, /selectionConditions\[\]/);
  assert.match(matrixEn, /currentPageItem/);
  assert.match(matrixCn, /currentPageItem/);
  assert.match(matrixEn, /currentResult/);
  assert.match(matrixCn, /currentResult/);
  assert.match(matrixEn, /nonNull/);
  assert.match(matrixCn, /nonNull/);
  assert.match(matrixEn, /equals/);
  assert.match(matrixCn, /equals/);
  assert.match(matrixEn, /commands\[\]\.automationHints/);
  assert.match(matrixCn, /commands\[\]\.automationHints/);
});

test("request binding discovery stays documented in docs and skill references", () => {
  assert.match(docsOverviewEn, /requestBindings\[\]/);
  assert.match(docsOverviewCn, /requestBindings\[\]/);
  assert.match(docsOverviewEn, /maps CLI inputs to underlying API request fields/i);
  assert.match(docsOverviewCn, /映射 CLI 输入与底层 API 请求字段/);
  assert.match(docsOverviewEn, /field-level `required` and `schema` metadata/i);
  assert.match(docsOverviewCn, /字段级别的 `required` 与 `schema` 元数据/);
  assert.match(docsOverviewEn, /requestBindings\[\]\.schema/);
  assert.match(docsOverviewCn, /requestBindings\[\]\.schema/);
  assert.match(matrixEn, /requestBindings\[\]/);
  assert.match(matrixCn, /requestBindings\[\]/);
  assert.match(matrixEn, /field-level `required` and `schema` metadata/i);
  assert.match(matrixCn, /字段级别的 `required` 与 `schema` 元数据/);
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
  assert.match(docsOverviewEn, /trims trailing whitespace\/newlines after BOM removal/);
  assert.match(docsOverviewCn, /trim 结尾空白\/换行/);
  assert.match(matrixEn, /trims trailing whitespace\/newlines after BOM removal/);
  assert.match(matrixCn, /trim 结尾空白\/换行/);
});

test("config masking and warnings stay documented in docs and skill references", () => {
  assert.match(docsOverviewEn, /optional top-level `warnings\[\]`/);
  assert.match(docsOverviewCn, /可选顶层 `warnings\[\]`/);
  assert.match(matrixEn, /optional top-level `warnings\[\]`/);
  assert.match(matrixCn, /可选顶层 `warnings\[\]`/);

  assert.match(docsOverviewEn, /\*\*\*encrypted\*\*\*/);
  assert.match(docsOverviewEn, /\*\*\*configured\*\*\*/);
  assert.match(docsOverviewCn, /\*\*\*encrypted\*\*\*/);
  assert.match(docsOverviewCn, /\*\*\*configured\*\*\*/);
  assert.match(matrixEn, /\*\*\*encrypted\*\*\*/);
  assert.match(matrixEn, /\*\*\*configured\*\*\*/);
  assert.match(matrixCn, /\*\*\*encrypted\*\*\*/);
  assert.match(matrixCn, /\*\*\*configured\*\*\*/);
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
