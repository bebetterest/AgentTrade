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
const skillRootEn = readFileSync(resolve(repoRoot, "apps/skill/SKILL.md"), "utf8");
const skillRootCn = readFileSync(resolve(repoRoot, "apps/skill/SKILL_cn.md"), "utf8");
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
  const hasActionHandler = (command: Command): boolean =>
    Boolean((command as Command & { _actionHandler?: unknown })._actionHandler);

  const visit = (command: Command, segments: string[]): void => {
    const children = command.commands;
    if (children.length === 0 || hasActionHandler(command)) {
      leaves.push({ path: segments.join(" "), command });
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

  assert.equal(commandPaths.length, 51);
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
    "feedback get",
    "feedback list",
    "feedback submit",
    "ledger get",
    "spec",
    "submissions confirm",
    "submissions get",
    "submissions list",
    "submissions reject",
    "system health",
    "system logs audits",
    "system logs requests",
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
    "tasks terminate",
    "todos",
    "todos action-required",
    "todos waiting"
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
  assert.match(docsOverviewEn, /credential\/text\/JSON\/value inputs accept `-`/i);
  assert.match(docsOverviewCn, /凭证\/文本\/JSON\/值输入都接受 `-`/);
  assert.match(docsOverviewEn, /only one stdin-backed input consumer/i);
  assert.match(docsOverviewCn, /只允许一个 stdin-backed 输入消费者/);
  assert.match(docsOverviewEn, /stdinFileAlias/);
  assert.match(docsOverviewCn, /stdinFileAlias/);
  assert.match(docsOverviewEn, /credentialFileInputsResolveBeforeCommandFileInputs/);
  assert.match(docsOverviewCn, /credentialFileInputsResolveBeforeCommandFileInputs/);
  assert.match(matrixEn, /accepts `-` to read UTF-8 from stdin/i);
  assert.match(matrixCn, /接受 `-` 表示从 stdin 读取 UTF-8/);
  assert.match(matrixEn, /credential\/text\/JSON\/value input.*accepts `-`/i);
  assert.match(matrixCn, /凭证\/文本\/JSON\/值输入.*接受 `-`/);
  assert.match(matrixEn, /Only one stdin-backed file input is allowed/i);
  assert.match(matrixCn, /只允许一个 stdin-backed 文件输入/);
  assert.match(matrixEn, /credentialFileInputsResolveBeforeCommandFileInputs/);
  assert.match(matrixCn, /credentialFileInputsResolveBeforeCommandFileInputs/);
});

test("secret input guidance stays file-backed in agent-facing docs", () => {
  const agentFacingDocs = [
    ["apps/skill/SKILL.md", skillRootEn],
    ["apps/skill/SKILL_cn.md", skillRootCn],
    ["apps/skill/references/workflow.md", readFileSync(resolve(repoRoot, "apps/skill/references/workflow.md"), "utf8")],
    ["apps/skill/references/workflow_cn.md", readFileSync(resolve(repoRoot, "apps/skill/references/workflow_cn.md"), "utf8")]
  ] as const;

  for (const [label, source] of agentFacingDocs) {
    assert.match(source, /config set token --value-file/, `missing token --value-file guidance in ${label}`);
    assert.match(source, /config set admin-key --value-file/, `missing admin-key --value-file guidance in ${label}`);
    assert.match(
      source,
      /config set wallet-private-key --value-file|--private-key-file/,
      `missing private-key file-backed guidance in ${label}`
    );
    assert.match(source, /--signature-file/, `missing signature-file guidance in ${label}`);
    assert.match(source, /65-byte/, `missing 65-byte signature guidance in ${label}`);
    assert.doesNotMatch(source, /config set token <token>/, `stale inline token persistence in ${label}`);
    assert.doesNotMatch(source, /config set admin-key <admin-service-key>/, `stale inline admin-key persistence in ${label}`);
    assert.doesNotMatch(source, /config set wallet-private-key <private-key>/, `stale inline wallet key persistence in ${label}`);
  }
});

test("auth token stdout warnings stay documented", () => {
  assert.match(docsOverviewEn, /auth login.*warnings\[\]\.message/);
  assert.match(docsOverviewCn, /auth login.*warnings\[\]\.message/);
  assert.match(docsOverviewEn, /auth verify.*warnings\[\]\.message/);
  assert.match(docsOverviewCn, /auth verify.*warnings\[\]\.message/);
  assert.match(docsOverviewEn, /data\.token.*data\.auth\.token.*secret/i);
  assert.match(docsOverviewCn, /data\.token.*data\.auth\.token.*密钥/);
  assert.match(docsOverviewEn, /--signature-file/);
  assert.match(docsOverviewCn, /--signature-file/);
  assert.match(docsOverviewEn, /65-byte.*EIP-191/i);
  assert.match(docsOverviewCn, /65-byte.*EIP-191/i);
  assert.match(matrixEn, /auth login.*warnings\[\]\.message/);
  assert.match(matrixCn, /auth login.*warnings\[\]\.message/);
  assert.match(matrixEn, /auth verify.*warnings\[\]\.message/);
  assert.match(matrixCn, /auth verify.*warnings\[\]\.message/);
  assert.match(matrixEn, /data\.token.*data\.auth\.token.*secret/i);
  assert.match(matrixCn, /data\.token.*data\.auth\.token.*密钥/);
  assert.match(matrixEn, /--signature-file/);
  assert.match(matrixCn, /--signature-file/);
  assert.match(matrixEn, /65-byte.*EIP-191/i);
  assert.match(matrixCn, /65-byte.*EIP-191/i);
});

test("audit logging guidance requires redacted stdout and command records", () => {
  assert.match(docsOverviewEn, /redacted command string/i);
  assert.match(docsOverviewCn, /脱敏后的 command/);
  assert.match(docsOverviewEn, /redacted stdout\/stderr JSON summaries/i);
  assert.match(docsOverviewCn, /脱敏后的 stdout\/stderr JSON 摘要/);
  assert.match(docsOverviewEn, /Do not store raw stdout.*data\.token.*data\.auth\.token.*data\.wallet\.privateKey/i);
  assert.match(docsOverviewCn, /不要.*data\.token.*data\.auth\.token.*data\.wallet\.privateKey.*原始 stdout/);
  assert.match(errorHandlingEn, /redacted stdout JSON summary/i);
  assert.match(errorHandlingCn, /脱敏后的 stdout JSON 摘要/);
  assert.match(errorHandlingEn, /never include raw `data\.token`, `data\.auth\.token`, or `data\.wallet\.privateKey`/);
  assert.match(errorHandlingCn, /不得包含原始 `data\.token`、`data\.auth\.token` 或 `data\.wallet\.privateKey`/);
});

test("spec auth requirement discovery stays documented in docs and skill references", () => {
  assert.match(docsOverviewEn, /authRequirements\[\]/);
  assert.match(docsOverviewCn, /authRequirements\[\]/);
  assert.match(docsOverviewEn, /preferredSources\[\]/);
  assert.match(docsOverviewCn, /preferredSources\[\]/);
  assert.match(docsOverviewEn, /argvSecretSources\[\]/);
  assert.match(docsOverviewCn, /argvSecretSources\[\]/);
  assert.match(docsOverviewEn, /fileBackedSources\[\]/);
  assert.match(docsOverviewCn, /fileBackedSources\[\]/);
  assert.match(docsOverviewEn, /persistedSources\[\]/);
  assert.match(docsOverviewCn, /persistedSources\[\]/);
  assert.match(docsOverviewEn, /persistedConfig\.token/);
  assert.match(docsOverviewCn, /persistedConfig\.token/);
  assert.match(docsOverviewEn, /persistedConfig\.adminKey/);
  assert.match(docsOverviewCn, /persistedConfig\.adminKey/);
  assert.match(matrixEn, /commands\[\]\.authRequirements\[\]/);
  assert.match(matrixCn, /commands\[\]\.authRequirements\[\]/);
  assert.match(matrixEn, /preferredSources\[\]/);
  assert.match(matrixCn, /preferredSources\[\]/);
  assert.match(matrixEn, /argvSecretSources\[\]/);
  assert.match(matrixCn, /argvSecretSources\[\]/);
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
  assert.match(docsOverviewEn, /agentExecution/);
  assert.match(docsOverviewCn, /agentExecution/);
  assert.match(docsOverviewEn, /humanOutOfLoop=true/);
  assert.match(docsOverviewCn, /humanOutOfLoop=true/);
  assert.match(docsOverviewEn, /interactivePrompts=false/);
  assert.match(docsOverviewCn, /interactivePrompts=false/);
  assert.match(docsOverviewEn, /humanApprovalRequiredForLifecycleWrites=false/);
  assert.match(docsOverviewCn, /humanApprovalRequiredForLifecycleWrites=false/);
  assert.match(docsOverviewEn, /not human approval/i);
  assert.match(docsOverviewCn, /不是人类审批/);
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
  assert.match(docsOverviewEn, /isNull/);
  assert.match(docsOverviewCn, /isNull/);
  assert.match(docsOverviewEn, /`in`/);
  assert.match(docsOverviewCn, /`in`/);
  assert.match(docsOverviewEn, /targetInputs\[\]/);
  assert.match(docsOverviewCn, /targetInputs\[\]/);
  assert.match(docsOverviewEn, /argvValueContainsSecret/);
  assert.match(docsOverviewCn, /argvValueContainsSecret/);
  assert.match(docsOverviewEn, /preferredFileFlag/);
  assert.match(docsOverviewCn, /preferredFileFlag/);
  assert.match(docsOverviewEn, /fileBackedSecretFor/);
  assert.match(docsOverviewCn, /fileBackedSecretFor/);
  assert.match(docsOverviewEn, /revealsSensitiveOutput/);
  assert.match(docsOverviewCn, /revealsSensitiveOutput/);
  assert.match(docsOverviewEn, /sensitiveOutputPaths\[\]/);
  assert.match(docsOverviewCn, /sensitiveOutputPaths\[\]/);
  assert.match(docsOverviewEn, /preferredInput=file/);
  assert.match(docsOverviewCn, /preferredInput=file/);
  assert.match(docsOverviewEn, /--show-private-key.*data\.wallet\.privateKey/s);
  assert.match(docsOverviewCn, /--show-private-key.*data\.wallet\.privateKey/s);
  assert.match(docsOverviewEn, /--signature.*argvValueContainsSecret|--signature-file/s);
  assert.match(docsOverviewCn, /--signature.*argvValueContainsSecret|--signature-file/s);
  assert.match(docsOverviewEn, /--message.*--title.*--desc.*--criteria.*--payload.*--patch-json.*--reason.*--name.*--bio/s);
  assert.match(docsOverviewCn, /--message.*--title.*--desc.*--criteria.*--payload.*--patch-json.*--reason.*--name.*--bio/s);
  assert.match(docsOverviewEn, /--message-file.*before `--message`/);
  assert.match(docsOverviewCn, /--message-file.*排在 `--message` 前面/);
  assert.match(docsOverviewEn, /Shared help text.*file-backed text\/JSON flags/i);
  assert.match(docsOverviewCn, /共享 help 文本.*生成型.*text\/JSON/);
  assert.match(docsOverviewEn, /configKeyHints\[\]/);
  assert.match(docsOverviewCn, /configKeyHints\[\]/);
  assert.match(docsOverviewEn, /argvValueContainsSecretWhenInline/);
  assert.match(docsOverviewCn, /argvValueContainsSecretWhenInline/);
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
  assert.match(matrixEn, /isNull/);
  assert.match(matrixCn, /isNull/);
  assert.match(matrixEn, /`in`/);
  assert.match(matrixCn, /`in`/);
  assert.match(matrixEn, /commands\[\]\.automationHints/);
  assert.match(matrixCn, /commands\[\]\.automationHints/);
  assert.match(matrixEn, /agentExecution/);
  assert.match(matrixCn, /agentExecution/);
  assert.match(matrixEn, /human-out-of-loop/);
  assert.match(matrixCn, /human-out-of-loop/);
  assert.match(matrixEn, /not a human approval gate/);
  assert.match(matrixCn, /不是人类审批门/);
  assert.match(matrixEn, /options\[\]\.argvValueContainsSecret/);
  assert.match(matrixCn, /options\[\]\.argvValueContainsSecret/);
  assert.match(matrixEn, /options\[\]\.preferredFileFlag/);
  assert.match(matrixCn, /options\[\]\.preferredFileFlag/);
  assert.match(matrixEn, /options\[\]\.fileBackedSecretFor/);
  assert.match(matrixCn, /options\[\]\.fileBackedSecretFor/);
  assert.match(matrixEn, /options\[\]\.revealsSensitiveOutput/);
  assert.match(matrixCn, /options\[\]\.revealsSensitiveOutput/);
  assert.match(matrixEn, /--show-private-key.*data\.wallet\.privateKey/s);
  assert.match(matrixCn, /--show-private-key.*data\.wallet\.privateKey/s);
  assert.match(matrixEn, /--signature-file/);
  assert.match(matrixCn, /--signature-file/);
  assert.match(matrixEn, /--message.*--desc.*--criteria.*--payload.*--patch-json.*--reason.*--name.*--bio/s);
  assert.match(matrixCn, /--message.*--desc.*--criteria.*--payload.*--patch-json.*--reason.*--name.*--bio/s);
  assert.match(matrixEn, /--message-file.*before `--message`/);
  assert.match(matrixCn, /--message-file.*排在 `--message` 前面/);
  assert.match(matrixEn, /Shared help text.*file-backed text\/JSON flags/i);
  assert.match(matrixCn, /共享 help 文本.*生成型\/多行/);
  assert.match(matrixEn, /commands\[\]\.configKeyHints\[\]/);
  assert.match(matrixCn, /commands\[\]\.configKeyHints\[\]/);
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
  assertCommandRowContains(docsOverviewEn, "docs/cli/overview.md", "system settings update", ["--reason-file"]);
  assertCommandRowContains(docsOverviewEn, "docs/cli/overview.md", "system settings reset", ["--reason-file"]);
  assert.match(docsOverviewCn, /name <= 120/);
  assert.match(docsOverviewCn, /bio <= 1000/);
  assert.match(docsOverviewCn, /reason.*1000/);
  assertCommandRowContains(docsOverviewCn, "docs/cli/overview_cn.md", "system settings update", ["--reason-file"]);
  assertCommandRowContains(docsOverviewCn, "docs/cli/overview_cn.md", "system settings reset", ["--reason-file"]);
  assert.match(matrixEn, /name<=120/);
  assert.match(matrixEn, /bio<=1000/);
  assert.match(matrixEn, /reason<=1000/);
  assertCommandRowContains(matrixEn, "apps/skill/references/command-matrix.md", "system settings update", ["--reason-file"]);
  assertCommandRowContains(matrixEn, "apps/skill/references/command-matrix.md", "system settings reset", ["--reason-file"]);
  assert.match(matrixCn, /name<=120/);
  assert.match(matrixCn, /bio<=1000/);
  assert.match(matrixCn, /reason<=1000/);
  assertCommandRowContains(matrixCn, "apps/skill/references/command-matrix_cn.md", "system settings update", ["--reason-file"]);
  assertCommandRowContains(matrixCn, "apps/skill/references/command-matrix_cn.md", "system settings reset", ["--reason-file"]);
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
