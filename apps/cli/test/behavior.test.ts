import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
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
const cliPackageVersion = (
  JSON.parse(readFileSync(resolve(repoRoot, "apps/cli/package.json"), "utf8")) as { version: string }
).version;
const testConfigPath = join(tmpdir(), `agentrade-cli-behavior-${process.pid}.json`);

const runCli = async (
  args: string[],
  env: NodeJS.ProcessEnv = {},
  stdinText?: string
): Promise<CliResult> => {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(cliBin, [cliEntry, ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        AGENTRADE_CLI_CONFIG_PATH: testConfigPath,
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
    child.stdin.end(stdinText ?? "");
    child.on("close", (code) => {
      resolvePromise({ code, stdout, stderr });
    });
  });
};

interface SpecWorkflowHints {
  phase: string;
  actorRoles: string[];
  prerequisiteCommands: string[];
  nextCommands: string[];
}

interface SpecEntityBinding {
  entity: string;
  relation: string;
  inputSources?: string[];
  outputPaths?: string[];
  note?: string;
}

interface SpecEntityHints {
  primaryEntity: string;
  bindings: SpecEntityBinding[];
}

interface SpecHandoffSelectionCondition {
  path: string;
  operator: string;
  value?: string | number | boolean;
}

interface SpecHandoffBinding {
  sourcePath?: string;
  sourceInput?: string;
  sourceLiteral?: string | number | boolean;
  targetInputs: string[];
  note?: string;
}

interface SpecHandoffHint {
  targetCommand: string;
  bindings: SpecHandoffBinding[];
  selectionMode?: string;
  selectionConditions?: SpecHandoffSelectionCondition[];
  note?: string;
}

interface DiscoveredSpecCommand {
  path: string;
  workflowHints?: SpecWorkflowHints;
  entityHints?: SpecEntityHints;
  handoffHints: SpecHandoffHint[];
}

interface SpecCommandEnvelope<TCommand extends { path: string }> {
  ok: boolean;
  data: {
    commands: TCommand[];
  };
}

const getSpecCommand = async <TCommand extends DiscoveredSpecCommand = DiscoveredSpecCommand>(
  commandPath: string
): Promise<TCommand> => {
  const result = await runCli(["spec", "--command", commandPath]);
  assert.equal(result.code, 0);

  const envelope = JSON.parse(result.stdout) as SpecCommandEnvelope<TCommand>;
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.commands.length, 1);
  assert.equal(envelope.data.commands[0]?.path, commandPath);

  return envelope.data.commands[0] as TCommand;
};

const assertHandoffTargets = (
  command: DiscoveredSpecCommand,
  expectedTargets: string[]
): void => {
  assert.deepEqual(
    [...command.handoffHints.map((hint) => hint.targetCommand)].sort(),
    [...expectedTargets].sort()
  );
};

const findHandoff = (
  command: DiscoveredSpecCommand,
  targetCommand: string,
  predicate?: (hint: SpecHandoffHint) => boolean
): SpecHandoffHint | undefined =>
  command.handoffHints.find(
    (hint) => hint.targetCommand === targetCommand && (predicate ? predicate(hint) : true)
  );

const assertSpecHandoff = (
  command: DiscoveredSpecCommand,
  targetCommand: string,
  expected: SpecHandoffHint,
  predicate?: (hint: SpecHandoffHint) => boolean
): void => {
  assert.deepEqual(findHandoff(command, targetCommand, predicate), expected);
};

const findEntityBinding = (
  command: DiscoveredSpecCommand,
  predicate: (binding: SpecEntityBinding) => boolean
): SpecEntityBinding | undefined => command.entityHints?.bindings.find(predicate);

const assertEntityBinding = (
  command: DiscoveredSpecCommand,
  predicate: (binding: SpecEntityBinding) => boolean,
  expected: SpecEntityBinding
): void => {
  assert.deepEqual(findEntityBinding(command, predicate), expected);
};

test("cli help includes global option and error contract guidance", async () => {
  const result = await runCli(["--help"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /CLI runtime setting precedence:/);
  assert.match(result.stdout, /agentrade config set\/show\/unset/);
  assert.match(result.stdout, /--base-url/);
  assert.match(result.stdout, /--token-file <path>/);
  assert.match(result.stdout, /--admin-key-file <path>/);
  assert.match(result.stdout, /prefer --token-file \/ --admin-key-file/i);
  assert.match(result.stdout, /accept '-' to read UTF-8 from stdin/i);
  assert.match(result.stdout, /Output contract:/);
  assert.match(result.stdout, /success: command execution writes stdout JSON with \{ok,command,data,warnings\?\}/);
  assert.match(result.stdout, /exception: --help and --version write plain text to stdout/i);
  assert.match(result.stdout, /Exit codes:/);
});

test("cli subcommand help is self-contained for agent execution", async () => {
  const taskCreateHelp = await runCli(["tasks", "create", "--help"]);
  assert.equal(taskCreateHelp.code, 0);
  assert.match(taskCreateHelp.stdout, /Create a task \(token required\)/);
  assert.match(taskCreateHelp.stdout, /Global Options:/);
  assert.match(taskCreateHelp.stdout, /--token-file <path>/);
  assert.match(taskCreateHelp.stdout, /deadline in ISO datetime format with timezone/i);
  assert.match(taskCreateHelp.stdout, /require one of --desc \/ --desc-file/i);
  assert.match(taskCreateHelp.stdout, /require one of --criteria \/ --criteria-file/i);
  assert.match(taskCreateHelp.stdout, /Output contract:/);
  assert.match(taskCreateHelp.stdout, /success: command execution writes stdout JSON with \{ok,command,data,warnings\?\}/);
  assert.match(taskCreateHelp.stdout, /exception: --help and --version write plain text to stdout/i);
  assert.match(taskCreateHelp.stdout, /Exit codes:/);

  const authVerifyHelp = await runCli(["auth", "verify", "--help"]);
  assert.equal(authVerifyHelp.code, 0);
  assert.match(authVerifyHelp.stdout, /require one of --message \/ --message-file/i);

  const authLoginHelp = await runCli(["auth", "login", "--help"]);
  assert.equal(authLoginHelp.code, 0);
  assert.match(authLoginHelp.stdout, /--private-key-file <path>/);
  assert.match(authLoginHelp.stdout, /persist token\s+by default/i);
  assert.match(authLoginHelp.stdout, /persisted wallet-private-key in CLI config/i);
  assert.match(authLoginHelp.stdout, /prefer --private-key-file over inline --private-key/i);
  assert.match(authLoginHelp.stdout, /pass --no-persist-token/i);

  const systemHealthHelp = await runCli(["system", "health", "--help"]);
  assert.equal(systemHealthHelp.code, 0);
  assert.match(systemHealthHelp.stdout, /Global Options:/);
  assert.match(systemHealthHelp.stdout, /--base-url <url>/);
  assert.match(systemHealthHelp.stdout, /success: command execution writes stdout JSON with \{ok,command,data,warnings\?\}/);

  const nestedHelp = await runCli(["help", "tasks", "create"]);
  assert.equal(nestedHelp.code, 0);
  assert.match(nestedHelp.stdout, /Usage: agentrade tasks create \[options\]/);
  assert.match(nestedHelp.stdout, /Global Options:/);
  assert.match(nestedHelp.stdout, /Exit codes:/);

  const groupNestedHelp = await runCli(["tasks", "help", "create"]);
  assert.equal(groupNestedHelp.code, 0);
  assert.match(groupNestedHelp.stdout, /Usage: agentrade tasks create \[options\]/);
  assert.match(groupNestedHelp.stdout, /Output contract:/);

  const nestedHelpWithGlobals = await runCli([
    "--pretty",
    "--base-url",
    "http://example.com",
    "help",
    "tasks",
    "create"
  ]);
  assert.equal(nestedHelpWithGlobals.code, 0);
  assert.match(nestedHelpWithGlobals.stdout, /Usage: agentrade tasks create \[options\]/);
  assert.match(nestedHelpWithGlobals.stdout, /prefer --token-file \/ --admin-key-file/i);

  for (const commandArgs of [
    ["tasks", "list"],
    ["submissions", "list"],
    ["disputes", "list"],
    ["agents", "list"]
  ]) {
    const help = await runCli([...commandArgs, "--help"]);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /default: latest/);
    assert.match(help.stdout, /default: desc/);
  }

  const tasksListHelp = await runCli(["tasks", "list", "--help"]);
  assert.equal(tasksListHelp.code, 0);
  assert.match(tasksListHelp.stdout, /opaque pagination cursor returned by previous\s+nextCursor/i);
  assert.match(tasksListHelp.stdout, /page size \(1-100, default: 20\)/);

  const profileUpdateHelp = await runCli(["agents", "profile", "update", "--help"]);
  assert.equal(profileUpdateHelp.code, 0);
  assert.match(profileUpdateHelp.stdout, /--clear-name/);
  assert.match(profileUpdateHelp.stdout, /--clear-bio/);
  assert.match(profileUpdateHelp.stdout, /require at least one of --name\/--name-file\/--clear-name or --bio\/--bio-file\/--clear-bio/i);
  assert.match(profileUpdateHelp.stdout, /deterministic field clearing/i);
  assert.match(profileUpdateHelp.stdout, /max 120 chars/);
  assert.match(profileUpdateHelp.stdout, /max 1000 chars/);

  const dashboardTrendsHelp = await runCli(["dashboard", "trends", "--help"]);
  assert.equal(dashboardTrendsHelp.code, 0);
  assert.match(dashboardTrendsHelp.stdout, /default: UTC/);
  assert.match(dashboardTrendsHelp.stdout, /default: 7d/);

  const activitiesListHelp = await runCli(["activities", "list", "--help"]);
  assert.equal(activitiesListHelp.code, 0);
  assert.match(activitiesListHelp.stdout, /ADMIN_AUDIT/);
  assert.match(activitiesListHelp.stdout, /default: desc/);

  const settingsUpdateHelp = await runCli(["system", "settings", "update", "--help"]);
  assert.equal(settingsUpdateHelp.code, 0);
  assert.match(settingsUpdateHelp.stdout, /token \+ admin key required/i);
  assert.match(settingsUpdateHelp.stdout, /--patch-file <path>/);
  assert.match(settingsUpdateHelp.stdout, /require one of --patch-json \/ --patch-file/i);
  assert.match(settingsUpdateHelp.stdout, /max 1000 chars/);

  const settingsHistoryHelp = await runCli(["system", "settings", "history", "--help"]);
  assert.equal(settingsHistoryHelp.code, 0);
  assert.match(settingsHistoryHelp.stdout, /opaque pagination cursor returned by previous\s+nextCursor/i);
  assert.match(settingsHistoryHelp.stdout, /page size \(1-100, default: 20\)/);

  const configSetHelp = await runCli(["config", "set", "--help"]);
  assert.equal(configSetHelp.code, 0);
  assert.match(configSetHelp.stdout, /--value-file <path>/);
  assert.match(configSetHelp.stdout, /require one of <value> \/ --value-file/i);
  assert.match(configSetHelp.stdout, /--value-file - reads UTF-8 from stdin/i);
  assert.match(configSetHelp.stdout, /encrypted at rest/i);
});

test("cli nested help rewrite does not hijack positional arguments named help", async () => {
  const configSetResult = await runCli(["config", "set", "help", "value"]);
  assert.equal(configSetResult.code, 2);
  assert.equal(configSetResult.stdout.trim(), "");
  const configSetError = JSON.parse(configSetResult.stderr.trim()) as {
    type: string;
    command: string;
    message: string;
  };
  assert.equal(configSetError.type, "VALIDATION_ERROR");
  assert.equal(configSetError.command, "config set");
  assert.match(configSetError.message, /invalid config key 'help'/i);

  const configUnsetResult = await runCli(["config", "unset", "help"]);
  assert.equal(configUnsetResult.code, 2);
  assert.equal(configUnsetResult.stdout.trim(), "");
  const configUnsetError = JSON.parse(configUnsetResult.stderr.trim()) as {
    type: string;
    command: string;
    message: string;
  };
  assert.equal(configUnsetError.type, "VALIDATION_ERROR");
  assert.equal(configUnsetError.command, "config unset");
  assert.match(configUnsetError.message, /invalid config key 'help'/i);
});

test("cli system settings update requires patch input with a validation error", async () => {
  const result = await runCli([
    "--base-url",
    "http://127.0.0.1:1",
    "--token",
    "token-1",
    "--admin-key",
    "admin-1",
    "system",
    "settings",
    "update",
    "--apply-to",
    "next"
  ]);

  assert.equal(result.code, 2);
  const errorJson = JSON.parse(result.stderr.trim()) as {
    type: string;
    command: string;
    message: string;
  };
  assert.equal(errorJson.type, "VALIDATION_ERROR");
  assert.equal(errorJson.command, "system settings update");
  assert.match(errorJson.message, /--patch-json or --patch-file is required/);
});

test("cli --version matches package version", async () => {
  const result = await runCli(["--version"]);
  assert.equal(result.code, 0);
  assert.equal(result.stdout.trim(), cliPackageVersion);
  assert.equal(result.stderr.trim(), "");
});

test("cli spec emits machine-readable discovery output without loading runtime config", async () => {
  const isolatedConfigPath = join(tmpdir(), `agentrade-cli-spec-${process.pid}-${Date.now()}.json`);
  const result = await runCli(["spec", "--command", "tasks create", "--pretty"], {
    AGENTRADE_CLI_CONFIG_PATH: isolatedConfigPath
  });

  assert.equal(result.code, 0);
  const envelope = JSON.parse(result.stdout) as {
    ok: boolean;
    command: string;
    data: {
      binary: string;
      version: string;
      commandQuery: string | null;
      commandCount: number;
      discovery: {
        preferredCommand: string;
      };
      globalOptions: Array<{ longFlag?: string }>;
      commands: Array<{
        path: string;
        auth: string;
        authRequirements: Array<{
          kind: string;
          sources: string[];
        }>;
        requestBindings: Array<{
          location: string;
          field: string;
          sources: string[];
          note?: string;
          required?: boolean;
          description?: string;
          schema?: {
            $ref?: string;
            type?: string;
            format?: string;
            enum?: string[];
            minimum?: number;
            example?: string;
          };
        }>;
        successFields: Array<{
          path: string;
          description: string;
          required?: boolean;
          sensitive?: boolean;
          schema?: {
            $ref?: string;
            type?: string;
            pattern?: string;
            items?: {
              $ref?: string;
              type?: string;
              pattern?: string;
              example?: string;
            };
            example?: string;
          };
        }>;
        failureHints: Array<{
          match: {
            type: string;
            httpStatus?: number;
            httpStatusClass?: string;
            apiError?: string;
            issuesKind?: string;
          };
          strategy: string;
          retryGate: string;
          summary: string;
          suggestedCommands: string[];
        }>;
        workflowHints: {
          phase: string;
          actorRoles: string[];
          prerequisiteCommands: string[];
          nextCommands: string[];
        };
        entityHints: {
          primaryEntity: string;
          bindings: Array<{
            entity: string;
            relation: string;
            inputSources?: string[];
            outputPaths?: string[];
            note?: string;
          }>;
        };
        handoffHints: Array<{
          targetCommand: string;
          bindings: Array<{
            sourcePath?: string;
            sourceInput?: string;
            targetInputs: string[];
            note?: string;
          }>;
          selectionMode?: string;
          selectionConditions?: Array<{
            path: string;
            operator: string;
            value?: string | number | boolean;
          }>;
          note?: string;
        }>;
        automationHints: {
          effect: string;
          retryMode: string;
          preflightCommands: string[];
          verificationCommands: string[];
        };
        executionMode: string;
        inputContract: string[];
        operation?: {
          method: string;
          pathTemplate: string;
        };
      }>;
    };
  };
  assert.equal(envelope.ok, true);
  assert.equal(envelope.command, "spec");
  assert.equal(envelope.data.binary, "agentrade");
  assert.equal(envelope.data.version, cliPackageVersion);
  assert.equal(envelope.data.commandQuery, "tasks create");
  assert.equal(envelope.data.commandCount, 1);
  assert.equal(envelope.data.discovery.preferredCommand, "agentrade spec");
  assert.equal(envelope.data.discovery.stdinFileAlias, "-");
  assert.equal(envelope.data.discovery.stdinSingleConsumerPerInvocation, true);
  assert.ok(envelope.data.globalOptions.some((option) => option.longFlag === "--token-file"));
  assert.ok(envelope.data.dualChannelInputs.every((item) => item.stdinAlias === "-"));
  assert.equal(envelope.data.commands.length, 1);
  assert.equal(envelope.data.commands[0]?.path, "tasks create");
  assert.equal(envelope.data.commands[0]?.auth, "bearer");
  assert.deepEqual(envelope.data.commands[0]?.authRequirements, [
    {
      kind: "token",
      sources: ["--token", "--token-file", "persistedConfig.token"]
    }
  ]);
  assert.equal(envelope.data.commands[0]?.requestBindings.length, 8);
  const deadlineBinding = envelope.data.commands[0]?.requestBindings.find(
    (binding) => binding.field === "deadlineUtc"
  );
  assert.deepEqual(deadlineBinding, {
    location: "body",
    field: "deadlineUtc",
    sources: ["--deadline"],
    required: true,
    schema: {
      type: "string",
      format: "date-time",
      example: "2026-04-02T08:00:00.000Z"
    }
  });
  const allowRepeatBinding = envelope.data.commands[0]?.requestBindings.find(
    (binding) => binding.field === "allowRepeatCompletionsBySameAgent"
  );
  assert.deepEqual(allowRepeatBinding, {
    location: "body",
    field: "allowRepeatCompletionsBySameAgent",
    sources: ["--allow-repeat"],
    note: "flag presence writes true; omission leaves false",
    required: true,
    schema: {
      type: "boolean"
    }
  });
  const taskIdField = envelope.data.commands[0]?.successFields.find((field) => field.path === "data.id");
  assert.deepEqual(taskIdField, {
    path: "data.id",
    description: "success response field `data.id`",
    required: true,
    schema: {
      type: "string"
    }
  });
  const completedAgentsField = envelope.data.commands[0]?.successFields.find(
    (field) => field.path === "data.completedAgents[]"
  );
  assert.deepEqual(completedAgentsField, {
    path: "data.completedAgents[]",
    description: "success response array `data.completedAgents[]`",
    required: true,
    schema: {
      type: "array",
      items: {
        type: "string",
        pattern: "^0x[a-fA-F0-9]{40}$",
        example: "0x1111111111111111111111111111111111111111"
      }
    }
  });
  assert.deepEqual(
    envelope.data.commands[0]?.failureHints.find(
      (hint) => hint.match.type === "API_ERROR" && hint.match.apiError === "INSUFFICIENT_BALANCE"
    ),
    {
      match: {
        type: "API_ERROR",
        apiError: "INSUFFICIENT_BALANCE"
      },
      strategy: "reReadState",
      retryGate: "afterStateVerification",
      summary: "reduce reward or slots, or top up AGC balance before retrying task creation",
      suggestedCommands: ["ledger get"]
    }
  );
  assert.deepEqual(envelope.data.commands[0]?.workflowHints, {
    phase: "publish",
    actorRoles: ["publisher"],
    prerequisiteCommands: ["system health", "ledger get"],
    nextCommands: ["tasks get", "tasks intentions"]
  });
  assert.deepEqual(envelope.data.commands[0]?.entityHints, {
    primaryEntity: "task",
    bindings: [
      {
        entity: "task",
        relation: "created",
        outputPaths: ["data.id"]
      },
      {
        entity: "agent",
        relation: "related",
        outputPaths: ["data.publisher"]
      }
    ]
  });
  assert.deepEqual(envelope.data.commands[0]?.handoffHints, [
    {
      targetCommand: "tasks get",
      bindings: [
        {
          sourcePath: "data.id",
          targetInputs: ["--task"]
        }
      ]
    },
    {
      targetCommand: "tasks intentions",
      bindings: [
        {
          sourcePath: "data.id",
          targetInputs: ["--task"]
        }
      ]
    },
    {
      targetCommand: "tasks submit",
      bindings: [
        {
          sourcePath: "data.id",
          targetInputs: ["--task"]
        }
      ],
      note: "submission also requires payload input and usually a prior intention"
    },
    {
      targetCommand: "tasks terminate",
      bindings: [
        {
          sourcePath: "data.id",
          targetInputs: ["--task"]
        }
      ]
    },
    {
      targetCommand: "activities list",
      bindings: [
        {
          sourcePath: "data.id",
          targetInputs: ["--task"]
        }
      ],
      note: "rerun the activity list scoped to the created task"
    },
    {
      targetCommand: "tasks list",
      bindings: [
        {
          sourcePath: "data.publisher",
          targetInputs: ["--publisher"]
        }
      ],
      note: "rerun the task list scoped to the publishing agent"
    },
    {
      targetCommand: "agents profile get",
      bindings: [
        {
          sourcePath: "data.publisher",
          targetInputs: ["--address"]
        }
      ]
    },
    {
      targetCommand: "agents stats",
      bindings: [
        {
          sourcePath: "data.publisher",
          targetInputs: ["--address"]
        }
      ]
    },
    {
      targetCommand: "ledger get",
      bindings: [
        {
          sourcePath: "data.publisher",
          targetInputs: ["--address"]
        }
      ]
    }
  ]);
  assert.deepEqual(envelope.data.commands[0]?.automationHints, {
    effect: "remoteWrite",
    retryMode: "manual",
    preflightCommands: ["ledger get"],
    verificationCommands: ["tasks list", "ledger get"]
  });
  assert.equal(envelope.data.commands[0]?.executionMode, "api");
  assert.deepEqual(envelope.data.commands[0]?.inputContract, [
    "require one of --desc / --desc-file",
    "require one of --criteria / --criteria-file"
  ]);
  assert.equal(envelope.data.commands[0]?.operation?.method, "POST");
  assert.equal(envelope.data.commands[0]?.operation?.pathTemplate, "/v2/tasks");
});

test("cli spec exposes structured success fields for API responses including arrays and sensitive fields", async () => {
  const tasksListResult = await runCli(["spec", "--command", "tasks list"]);
  assert.equal(tasksListResult.code, 0);
  const tasksListEnvelope = JSON.parse(tasksListResult.stdout) as {
    ok: boolean;
    data: {
      commands: Array<{
        path: string;
        executionMode: string;
        failureHints: Array<{
          match: {
            type: string;
            httpStatus?: number;
            httpStatusClass?: string;
            apiError?: string;
            issuesKind?: string;
          };
          strategy: string;
          retryGate: string;
          summary: string;
          suggestedCommands: string[];
        }>;
        workflowHints: {
          phase: string;
          actorRoles: string[];
          prerequisiteCommands: string[];
          nextCommands: string[];
        };
        entityHints: {
          primaryEntity: string;
          bindings: Array<{
            entity: string;
            relation: string;
            inputSources?: string[];
            outputPaths?: string[];
            note?: string;
          }>;
        };
        handoffHints: Array<{
          targetCommand: string;
          bindings: Array<{
            sourcePath?: string;
            sourceInput?: string;
            targetInputs: string[];
            note?: string;
          }>;
          selectionMode?: string;
          selectionConditions?: Array<{
            path: string;
            operator: string;
            value?: string | number | boolean;
          }>;
          note?: string;
        }>;
        automationHints: {
          effect: string;
          retryMode: string;
          preflightCommands: string[];
          verificationCommands: string[];
        };
        successFields: Array<{
          path: string;
          description: string;
          required?: boolean;
          sensitive?: boolean;
          schema?: {
            $ref?: string;
            type?: string;
            nullable?: boolean;
            items?: {
              $ref?: string;
            };
          };
        }>;
      }>;
    };
  };

  assert.equal(tasksListEnvelope.ok, true);
  assert.equal(tasksListEnvelope.data.commands[0]?.path, "tasks list");
  assert.equal(tasksListEnvelope.data.commands[0]?.executionMode, "api");
  assert.deepEqual(tasksListEnvelope.data.commands[0]?.automationHints, {
    effect: "read",
    retryMode: "retryableErrorsOnly",
    preflightCommands: [],
    verificationCommands: []
  });
  assert.deepEqual(
    tasksListEnvelope.data.commands[0]?.failureHints.find(
      (hint) => hint.match.type === "NETWORK_ERROR" && hint.match.issuesKind === "TIMEOUT"
    ),
    {
      match: {
        type: "NETWORK_ERROR",
        issuesKind: "TIMEOUT"
      },
      strategy: "boundedRetry",
      retryGate: "whenRetryable",
      summary: "increase timeout only if needed and retry timeouts under the command's retry policy",
      suggestedCommands: ["system health"]
    }
  );
  assert.deepEqual(tasksListEnvelope.data.commands[0]?.workflowHints, {
    phase: "discover",
    actorRoles: ["any"],
    prerequisiteCommands: [],
    nextCommands: ["tasks get", "tasks create", "tasks intend"]
  });
  assert.deepEqual(tasksListEnvelope.data.commands[0]?.entityHints, {
    primaryEntity: "task",
    bindings: [
      {
        entity: "task",
        relation: "listed",
        outputPaths: ["data.items[].id"]
      },
      {
        entity: "agent",
        relation: "related",
        inputSources: ["--publisher"],
        outputPaths: ["data.items[].publisher"]
      }
    ]
  });
  assert.deepEqual(tasksListEnvelope.data.commands[0]?.handoffHints, [
    {
      targetCommand: "tasks get",
      bindings: [
        {
          sourcePath: "data.items[].id",
          targetInputs: ["--task"]
        }
      ],
      selectionMode: "currentPageItem"
    },
    {
      targetCommand: "tasks intend",
      bindings: [
        {
          sourcePath: "data.items[].id",
          targetInputs: ["--task"]
        }
      ],
      selectionMode: "currentPageItem"
    },
    {
      targetCommand: "tasks submit",
      bindings: [
        {
          sourcePath: "data.items[].id",
          targetInputs: ["--task"]
        }
      ],
      selectionMode: "currentPageItem",
      note: "submission also requires payload input and usually a prior intention"
    },
    {
      targetCommand: "tasks terminate",
      bindings: [
        {
          sourcePath: "data.items[].id",
          targetInputs: ["--task"]
        }
      ],
      selectionMode: "currentPageItem"
    },
    {
      targetCommand: "submissions list",
      bindings: [
        {
          sourcePath: "data.items[].id",
          targetInputs: ["--task"]
        }
      ],
      selectionMode: "currentPageItem"
    },
    {
      targetCommand: "disputes list",
      bindings: [
        {
          sourcePath: "data.items[].id",
          targetInputs: ["--task"]
        }
      ],
      selectionMode: "currentPageItem"
    },
    {
      targetCommand: "activities list",
      bindings: [
        {
          sourcePath: "data.items[].id",
          targetInputs: ["--task"]
        }
      ],
      selectionMode: "currentPageItem",
      note: "rerun the activity list scoped to the selected task"
    },
    {
      targetCommand: "tasks list",
      bindings: [
        {
          sourcePath: "data.items[].publisher",
          targetInputs: ["--publisher"]
        }
      ],
      selectionMode: "currentPageItem",
      note: "rerun the task list scoped to the selected publisher"
    },
    {
      targetCommand: "agents profile get",
      bindings: [
        {
          sourcePath: "data.items[].publisher",
          targetInputs: ["--address"]
        }
      ],
      selectionMode: "currentPageItem"
    },
    {
      targetCommand: "agents stats",
      bindings: [
        {
          sourcePath: "data.items[].publisher",
          targetInputs: ["--address"]
        }
      ],
      selectionMode: "currentPageItem"
    },
    {
      targetCommand: "ledger get",
      bindings: [
        {
          sourcePath: "data.items[].publisher",
          targetInputs: ["--address"]
        }
      ],
      selectionMode: "currentPageItem"
    }
  ]);
  assert.deepEqual(
    tasksListEnvelope.data.commands[0]?.successFields.find((field) => field.path === "data.items[]"),
    {
      path: "data.items[]",
      description: "success response array `data.items[]`",
      required: true,
      schema: {
        type: "array",
        items: {
          $ref: "#/components/schemas/Task"
        }
      }
    }
  );
  assert.deepEqual(
    tasksListEnvelope.data.commands[0]?.successFields.find((field) => field.path === "data.items[].id"),
    {
      path: "data.items[].id",
      description: "success response field `data.items[].id`",
      required: true,
      schema: {
        type: "string"
      }
    }
  );
  assert.deepEqual(
    tasksListEnvelope.data.commands[0]?.successFields.find(
      (field) => field.path === "data.nextCursor"
    ),
    {
      path: "data.nextCursor",
      description: "success response field `data.nextCursor`",
      required: true,
      schema: {
        type: "string",
        nullable: true
      }
    }
  );

  const authVerifyResult = await runCli(["spec", "--command", "auth verify"]);
  assert.equal(authVerifyResult.code, 0);
  const authVerifyEnvelope = JSON.parse(authVerifyResult.stdout) as {
    ok: boolean;
    data: {
      commands: Array<{
        successFields: Array<{
          path: string;
          description: string;
          required?: boolean;
          sensitive?: boolean;
          schema?: {
            type?: string;
          };
        }>;
      }>;
    };
  };

  assert.equal(authVerifyEnvelope.ok, true);
  assert.deepEqual(
    authVerifyEnvelope.data.commands[0]?.successFields.find((field) => field.path === "data.token"),
    {
      path: "data.token",
      description: "success response field `data.token`",
      required: true,
      sensitive: true,
      schema: {
        type: "string"
      }
    }
  );
});

test("cli spec exposes auth bootstrap handoff bindings", async () => {
  const [authChallenge, authVerify] = await Promise.all([
    getSpecCommand("auth challenge"),
    getSpecCommand("auth verify")
  ]);

  assert.deepEqual(authChallenge.handoffHints, [
    {
      targetCommand: "auth verify",
      bindings: [
        {
          sourceInput: "--address",
          targetInputs: ["--address"]
        },
        {
          sourcePath: "data.nonce",
          targetInputs: ["--nonce"]
        },
        {
          sourcePath: "data.message",
          targetInputs: ["--message", "--message-file"],
          note: "pass the returned SIWE message inline or through a file"
        }
      ],
      note: "auth verify still needs a signature over the exact challenge message"
    }
  ]);

  assert.deepEqual(authVerify.workflowHints, {
    phase: "bootstrap",
    actorRoles: ["anonymous"],
    prerequisiteCommands: ["auth challenge"],
    nextCommands: ["config show", "config set", "tasks list", "tasks create"]
  });
  assert.deepEqual(authVerify.handoffHints, [
    {
      targetCommand: "tasks create",
      bindings: [
        {
          sourcePath: "data.token",
          targetInputs: ["--token", "--token-file"],
          note: "pass the verified bearer token inline or through a file"
        }
      ],
      note: "task publication still requires title, description, criteria, deadline, slots, and reward inputs"
    },
    {
      targetCommand: "config set",
      bindings: [
        {
          sourceLiteral: "token",
          targetInputs: ["<key>"]
        },
        {
          sourcePath: "data.token",
          targetInputs: ["[value]"],
          note: "persist the verified token inline only when argv secret exposure is acceptable"
        }
      ],
      note: "config set writes the verified bearer token into local CLI config"
    }
  ]);
});

test("cli spec exposes discovery and agent directory handoff bindings", async () => {
  const [
    activitiesList,
    agentsList,
    agentsProfileGet,
    agentsStats,
    ledgerGet,
    cyclesRewards,
    dashboardSummary,
    specCommand
  ] = await Promise.all([
    getSpecCommand("activities list"),
    getSpecCommand("agents list"),
    getSpecCommand("agents profile get"),
    getSpecCommand("agents stats"),
    getSpecCommand("ledger get"),
    getSpecCommand("cycles rewards"),
    getSpecCommand("dashboard summary"),
    getSpecCommand("spec")
  ]);

  assert.deepEqual(activitiesList.workflowHints, {
    phase: "discover",
    actorRoles: ["any"],
    prerequisiteCommands: [],
    nextCommands: ["tasks get", "submissions list", "disputes get"]
  });
  assertSpecHandoff(activitiesList, "submissions list", {
    targetCommand: "submissions list",
    bindings: [
      {
        sourcePath: "data.items[].taskId",
        targetInputs: ["--task"]
      }
    ],
    selectionMode: "currentPageItem",
    selectionConditions: [
      {
        path: "data.items[].taskId",
        operator: "nonNull"
      }
    ]
  });
  assertSpecHandoff(
    activitiesList,
    "activities list",
    {
      targetCommand: "activities list",
      bindings: [
        {
          sourcePath: "data.items[].actor",
          targetInputs: ["--address"]
        }
      ],
      selectionMode: "currentPageItem",
      note: "rerun the activity list scoped to the selected actor"
    },
    (hint) => hint.bindings[0]?.targetInputs[0] === "--address"
  );
  assertSpecHandoff(activitiesList, "ledger get", {
    targetCommand: "ledger get",
    bindings: [
      {
        sourcePath: "data.items[].actor",
        targetInputs: ["--address"]
      }
    ],
    selectionMode: "currentPageItem"
  });

  assertHandoffTargets(agentsList, [
    "agents profile get",
    "agents stats",
    "ledger get",
    "tasks list",
    "submissions list",
    "disputes list",
    "activities list"
  ]);
  assertSpecHandoff(agentsList, "tasks list", {
    targetCommand: "tasks list",
    bindings: [
      {
        sourcePath: "data.items[].address",
        targetInputs: ["--publisher"]
      }
    ],
    selectionMode: "currentPageItem",
    note: "rerun the task list scoped to the selected agent as publisher"
  });
  assertSpecHandoff(agentsList, "activities list", {
    targetCommand: "activities list",
    bindings: [
      {
        sourcePath: "data.items[].address",
        targetInputs: ["--address"]
      }
    ],
    selectionMode: "currentPageItem",
    note: "rerun the activity list scoped to the selected agent"
  });

  assertSpecHandoff(agentsProfileGet, "tasks list", {
    targetCommand: "tasks list",
    bindings: [
      {
        sourcePath: "data.address",
        targetInputs: ["--publisher"]
      }
    ],
    note: "rerun the task list scoped to this agent as publisher"
  });
  assertSpecHandoff(agentsProfileGet, "activities list", {
    targetCommand: "activities list",
    bindings: [
      {
        sourcePath: "data.address",
        targetInputs: ["--address"]
      }
    ],
    note: "rerun the activity list scoped to this agent"
  });

  assertSpecHandoff(agentsStats, "submissions list", {
    targetCommand: "submissions list",
    bindings: [
      {
        sourceInput: "--address",
        targetInputs: ["--agent"]
      }
    ],
    note: "rerun the submission list scoped to this agent"
  });
  assertSpecHandoff(agentsStats, "disputes list", {
    targetCommand: "disputes list",
    bindings: [
      {
        sourceInput: "--address",
        targetInputs: ["--opener"]
      }
    ],
    note: "rerun the dispute list scoped to this agent as opener"
  });

  assertSpecHandoff(ledgerGet, "tasks list", {
    targetCommand: "tasks list",
    bindings: [
      {
        sourcePath: "data.address",
        targetInputs: ["--publisher"]
      }
    ],
    note: "rerun the task list scoped to this agent as publisher"
  });
  assertSpecHandoff(ledgerGet, "activities list", {
    targetCommand: "activities list",
    bindings: [
      {
        sourcePath: "data.address",
        targetInputs: ["--address"]
      }
    ],
    note: "rerun the activity list scoped to this agent"
  });

  assertEntityBinding(
    cyclesRewards,
    (binding) => binding.entity === "dispute",
    {
      entity: "dispute",
      relation: "related",
      outputPaths: ["data.workloads[].disputeId"],
      note: "only when the cycle workload is attached to a dispute"
    }
  );
  assertSpecHandoff(cyclesRewards, "disputes get", {
    targetCommand: "disputes get",
    bindings: [
      {
        sourcePath: "data.workloads[].disputeId",
        targetInputs: ["--dispute"]
      }
    ],
    selectionMode: "currentPageItem",
    selectionConditions: [
      {
        path: "data.workloads[].disputeId",
        operator: "nonNull"
      }
    ]
  });
  assertSpecHandoff(cyclesRewards, "agents stats", {
    targetCommand: "agents stats",
    bindings: [
      {
        sourcePath: "data.distributions[].agent",
        targetInputs: ["--address"]
      }
    ],
    selectionMode: "currentPageItem"
  });

  assert.deepEqual(dashboardSummary.workflowHints, {
    phase: "discover",
    actorRoles: ["any"],
    prerequisiteCommands: [],
    nextCommands: ["dashboard trends", "cycles get", "tasks list"]
  });
  assertSpecHandoff(dashboardSummary, "cycles get", {
    targetCommand: "cycles get",
    bindings: [
      {
        sourcePath: "data.activeCycleId",
        targetInputs: ["--cycle"]
      }
    ],
    selectionMode: "currentResult",
    selectionConditions: [
      {
        path: "data.activeCycleId",
        operator: "nonNull"
      }
    ]
  });
  assertSpecHandoff(dashboardSummary, "dashboard trends", {
    targetCommand: "dashboard trends",
    bindings: [
      {
        sourcePath: "data.timezone",
        targetInputs: ["--tz"]
      }
    ]
  });

  assert.deepEqual(specCommand.handoffHints, [
    {
      targetCommand: "spec",
      bindings: [
        {
          sourcePath: "data.commands[].path",
          targetInputs: ["--command"]
        }
      ],
      selectionMode: "currentPageItem",
      note: "reuse a returned leaf path or group prefix to request a narrower discovery slice"
    }
  ]);
});

test("cli spec exposes task lifecycle handoff bindings", async () => {
  const [tasksGet, tasksIntend, tasksIntentions, tasksSubmit, tasksTerminate] = await Promise.all([
    getSpecCommand("tasks get"),
    getSpecCommand("tasks intend"),
    getSpecCommand("tasks intentions"),
    getSpecCommand("tasks submit"),
    getSpecCommand("tasks terminate")
  ]);

  assertHandoffTargets(tasksGet, [
    "tasks intend",
    "tasks intentions",
    "tasks submit",
    "tasks terminate",
    "submissions list",
    "disputes list",
    "tasks list",
    "activities list",
    "agents profile get",
    "agents stats",
    "ledger get"
  ]);
  assertSpecHandoff(tasksGet, "agents profile get", {
    targetCommand: "agents profile get",
    bindings: [
      {
        sourcePath: "data.publisher",
        targetInputs: ["--address"]
      }
    ]
  });
  assertSpecHandoff(tasksGet, "tasks list", {
    targetCommand: "tasks list",
    bindings: [
      {
        sourcePath: "data.publisher",
        targetInputs: ["--publisher"]
      }
    ],
    note: "rerun the task list scoped to this publisher"
  });
  assertSpecHandoff(tasksGet, "activities list", {
    targetCommand: "activities list",
    bindings: [
      {
        sourcePath: "data.id",
        targetInputs: ["--task"]
      }
    ],
    note: "rerun the activity list scoped to this task"
  });

  assert.deepEqual(tasksIntend.entityHints, {
    primaryEntity: "taskIntention",
    bindings: [
      {
        entity: "task",
        relation: "target",
        inputSources: ["--task"],
        outputPaths: ["data.taskId"]
      },
      {
        entity: "taskIntention",
        relation: "created",
        outputPaths: ["data.id"]
      },
      {
        entity: "agent",
        relation: "related",
        outputPaths: ["data.agent"]
      }
    ]
  });
  assertSpecHandoff(tasksIntend, "submissions list", {
    targetCommand: "submissions list",
    bindings: [
      {
        sourcePath: "data.agent",
        targetInputs: ["--agent"]
      }
    ],
    note: "rerun the submission list scoped to the intending agent"
  });
  assertSpecHandoff(tasksIntend, "activities list", {
    targetCommand: "activities list",
    bindings: [
      {
        sourcePath: "data.taskId",
        targetInputs: ["--task"]
      }
    ],
    note: "rerun the activity list scoped to the intended task"
  });

  assert.deepEqual(tasksIntentions.entityHints, {
    primaryEntity: "taskIntention",
    bindings: [
      {
        entity: "task",
        relation: "target",
        inputSources: ["--task"]
      },
      {
        entity: "taskIntention",
        relation: "listed",
        outputPaths: ["data.items[].id"]
      },
      {
        entity: "agent",
        relation: "related",
        outputPaths: ["data.items[].agent"]
      }
    ]
  });
  assertSpecHandoff(tasksIntentions, "ledger get", {
    targetCommand: "ledger get",
    bindings: [
      {
        sourcePath: "data.items[].agent",
        targetInputs: ["--address"]
      }
    ],
    selectionMode: "currentPageItem"
  });
  assertSpecHandoff(tasksIntentions, "activities list", {
    targetCommand: "activities list",
    bindings: [
      {
        sourcePath: "data.items[].taskId",
        targetInputs: ["--task"]
      }
    ],
    selectionMode: "currentPageItem",
    note: "rerun the activity list scoped to the selected intention task"
  });

  assert.deepEqual(tasksSubmit.entityHints, {
    primaryEntity: "submission",
    bindings: [
      {
        entity: "task",
        relation: "target",
        inputSources: ["--task"],
        outputPaths: ["data.taskId"]
      },
      {
        entity: "submission",
        relation: "created",
        outputPaths: ["data.id"]
      },
      {
        entity: "agent",
        relation: "related",
        outputPaths: ["data.agent"]
      }
    ]
  });
  assertSpecHandoff(tasksSubmit, "disputes open", {
    targetCommand: "disputes open",
    bindings: [
      {
        sourcePath: "data.taskId",
        targetInputs: ["--task"]
      },
      {
        sourcePath: "data.id",
        targetInputs: ["--submission"]
      }
    ],
    note: "dispute opening still requires --reason or --reason-file"
  });
  assertSpecHandoff(tasksSubmit, "submissions list", {
    targetCommand: "submissions list",
    bindings: [
      {
        sourcePath: "data.agent",
        targetInputs: ["--agent"]
      }
    ],
    note: "rerun the submission list scoped to the submitting agent"
  });
  assertSpecHandoff(tasksSubmit, "activities list", {
    targetCommand: "activities list",
    bindings: [
      {
        sourcePath: "data.taskId",
        targetInputs: ["--task"]
      }
    ],
    note: "rerun the activity list scoped to the submitted task"
  });

  assert.deepEqual(tasksTerminate.entityHints, {
    primaryEntity: "task",
    bindings: [
      {
        entity: "task",
        relation: "target",
        inputSources: ["--task"],
        outputPaths: ["data.id"]
      },
      {
        entity: "agent",
        relation: "related",
        outputPaths: ["data.publisher"]
      }
    ]
  });
  assertSpecHandoff(tasksTerminate, "tasks list", {
    targetCommand: "tasks list",
    bindings: [
      {
        sourcePath: "data.publisher",
        targetInputs: ["--publisher"]
      }
    ],
    note: "rerun the task list scoped to the terminating publisher"
  });
  assertSpecHandoff(tasksTerminate, "activities list", {
    targetCommand: "activities list",
    bindings: [
      {
        sourcePath: "data.id",
        targetInputs: ["--task"]
      }
    ],
    note: "rerun the activity list scoped to the terminated task"
  });
});

test("cli spec exposes submission lifecycle handoff bindings", async () => {
  const [submissionsGet, submissionsList, submissionsConfirm, submissionsReject] = await Promise.all([
    getSpecCommand("submissions get"),
    getSpecCommand("submissions list"),
    getSpecCommand("submissions confirm"),
    getSpecCommand("submissions reject")
  ]);

  assertSpecHandoff(submissionsGet, "submissions list", {
    targetCommand: "submissions list",
    bindings: [
      {
        sourcePath: "data.agent",
        targetInputs: ["--agent"]
      }
    ],
    note: "rerun the submission list scoped to this agent"
  });
  assertSpecHandoff(submissionsGet, "activities list", {
    targetCommand: "activities list",
    bindings: [
      {
        sourcePath: "data.taskId",
        targetInputs: ["--task"]
      }
    ],
    note: "rerun the activity list scoped to this submission's task"
  });

  assert.deepEqual(submissionsList.entityHints, {
    primaryEntity: "submission",
    bindings: [
      {
        entity: "submission",
        relation: "listed",
        outputPaths: ["data.items[].id"]
      },
      {
        entity: "task",
        relation: "related",
        inputSources: ["--task"],
        outputPaths: ["data.items[].taskId"]
      },
      {
        entity: "agent",
        relation: "related",
        inputSources: ["--agent"],
        outputPaths: ["data.items[].agent"]
      }
    ]
  });
  assertHandoffTargets(submissionsList, [
    "submissions get",
    "submissions confirm",
    "submissions reject",
    "disputes open",
    "tasks get",
    "activities list",
    "submissions list",
    "agents profile get",
    "agents stats",
    "ledger get"
  ]);
  assertSpecHandoff(submissionsList, "submissions confirm", {
    targetCommand: "submissions confirm",
    bindings: [
      {
        sourcePath: "data.items[].id",
        targetInputs: ["--submission"]
      }
    ],
    selectionMode: "currentPageItem",
    selectionConditions: [
      {
        path: "data.items[].status",
        operator: "equals",
        value: "SUBMITTED"
      }
    ]
  });
  assertSpecHandoff(submissionsList, "disputes open", {
    targetCommand: "disputes open",
    bindings: [
      {
        sourcePath: "data.items[].taskId",
        targetInputs: ["--task"]
      },
      {
        sourcePath: "data.items[].id",
        targetInputs: ["--submission"]
      }
    ],
    selectionMode: "currentPageItem",
    selectionConditions: [
      {
        path: "data.items[].status",
        operator: "equals",
        value: "REJECTED"
      }
    ],
    note: "dispute opening still requires --reason or --reason-file"
  });
  assertSpecHandoff(
    submissionsList,
    "submissions list",
    {
      targetCommand: "submissions list",
      bindings: [
        {
          sourcePath: "data.items[].agent",
          targetInputs: ["--agent"]
        }
      ],
      selectionMode: "currentPageItem",
      note: "rerun the submission list scoped to the selected agent"
    },
    (hint) => hint.bindings[0]?.targetInputs[0] === "--agent"
  );
  assertSpecHandoff(submissionsList, "agents profile get", {
    targetCommand: "agents profile get",
    bindings: [
      {
        sourcePath: "data.items[].agent",
        targetInputs: ["--address"]
      }
    ],
    selectionMode: "currentPageItem"
  });
  assertSpecHandoff(submissionsList, "activities list", {
    targetCommand: "activities list",
    bindings: [
      {
        sourcePath: "data.items[].taskId",
        targetInputs: ["--task"]
      }
    ],
    selectionMode: "currentPageItem",
    note: "rerun the activity list scoped to the selected submission task"
  });

  assertEntityBinding(
    submissionsConfirm,
    (binding) => binding.entity === "agent",
    {
      entity: "agent",
      relation: "related",
      outputPaths: ["data.agent"]
    }
  );
  assertSpecHandoff(submissionsConfirm, "submissions list", {
    targetCommand: "submissions list",
    bindings: [
      {
        sourcePath: "data.agent",
        targetInputs: ["--agent"]
      }
    ],
    note: "rerun the submission list scoped to the confirmed agent"
  });
  assertSpecHandoff(submissionsConfirm, "activities list", {
    targetCommand: "activities list",
    bindings: [
      {
        sourcePath: "data.taskId",
        targetInputs: ["--task"]
      }
    ],
    note: "rerun the activity list scoped to the confirmed submission task"
  });

  assertEntityBinding(
    submissionsReject,
    (binding) => binding.entity === "agent",
    {
      entity: "agent",
      relation: "related",
      outputPaths: ["data.agent"]
    }
  );
  assertSpecHandoff(submissionsReject, "disputes open", {
    targetCommand: "disputes open",
    bindings: [
      {
        sourcePath: "data.taskId",
        targetInputs: ["--task"]
      },
      {
        sourcePath: "data.id",
        targetInputs: ["--submission"]
      }
    ],
    note: "dispute opening still requires --reason or --reason-file"
  });
  assertSpecHandoff(submissionsReject, "activities list", {
    targetCommand: "activities list",
    bindings: [
      {
        sourcePath: "data.taskId",
        targetInputs: ["--task"]
      }
    ],
    note: "rerun the activity list scoped to the rejected submission task"
  });
});

test("cli spec exposes dispute lifecycle handoff bindings", async () => {
  const [disputesGet, disputesList, disputesVote, disputesOpen, disputesRespond] = await Promise.all([
    getSpecCommand("disputes get"),
    getSpecCommand("disputes list"),
    getSpecCommand("disputes vote"),
    getSpecCommand("disputes open"),
    getSpecCommand("disputes respond")
  ]);

  assertSpecHandoff(
    disputesGet,
    "agents stats",
    {
      targetCommand: "agents stats",
      bindings: [
        {
          sourcePath: "data.opener",
          targetInputs: ["--address"]
        }
      ]
    },
    (hint) => hint.bindings[0]?.sourcePath === "data.opener"
  );
  assertSpecHandoff(
    disputesGet,
    "agents stats",
    {
      targetCommand: "agents stats",
      bindings: [
        {
          sourcePath: "data.resolution.winnerAddress",
          targetInputs: ["--address"]
        }
      ],
      selectionMode: "currentResult",
      selectionConditions: [
        {
          path: "data.resolution.winnerAddress",
          operator: "nonNull"
        }
      ]
    },
    (hint) => hint.bindings[0]?.sourcePath === "data.resolution.winnerAddress"
  );
  assertSpecHandoff(disputesGet, "disputes list", {
    targetCommand: "disputes list",
    bindings: [
      {
        sourcePath: "data.opener",
        targetInputs: ["--opener"]
      }
    ],
    note: "rerun the dispute list scoped to the opening agent"
  });
  assertSpecHandoff(disputesGet, "activities list", {
    targetCommand: "activities list",
    bindings: [
      {
        sourcePath: "data.id",
        targetInputs: ["--dispute"]
      }
    ],
    note: "rerun the activity list scoped to this dispute"
  });

  assert.deepEqual(disputesList.entityHints, {
    primaryEntity: "dispute",
    bindings: [
      {
        entity: "dispute",
        relation: "listed",
        outputPaths: ["data.items[].id"]
      },
      {
        entity: "task",
        relation: "related",
        inputSources: ["--task"],
        outputPaths: ["data.items[].taskId"]
      },
      {
        entity: "agent",
        relation: "related",
        inputSources: ["--opener"],
        outputPaths: ["data.items[].opener"]
      },
      {
        entity: "agent",
        relation: "related",
        outputPaths: ["data.items[].resolution.winnerAddress"],
        note: "only when the listed dispute is resolved and records a winner address"
      }
    ]
  });
  assertSpecHandoff(
    disputesList,
    "disputes list",
    {
      targetCommand: "disputes list",
      bindings: [
        {
          sourcePath: "data.items[].opener",
          targetInputs: ["--opener"]
        }
      ],
      selectionMode: "currentPageItem",
      note: "rerun the dispute list scoped to the selected opener"
    },
    (hint) => hint.bindings[0]?.targetInputs[0] === "--opener"
  );
  assertSpecHandoff(
    disputesList,
    "agents profile get",
    {
      targetCommand: "agents profile get",
      bindings: [
        {
          sourcePath: "data.items[].resolution.winnerAddress",
          targetInputs: ["--address"]
        }
      ],
      selectionMode: "currentPageItem",
      selectionConditions: [
        {
          path: "data.items[].resolution.winnerAddress",
          operator: "nonNull"
        }
      ]
    },
    (hint) => hint.bindings[0]?.sourcePath === "data.items[].resolution.winnerAddress"
  );
  assertSpecHandoff(
    disputesList,
    "agents stats",
    {
      targetCommand: "agents stats",
      bindings: [
        {
          sourcePath: "data.items[].resolution.winnerAddress",
          targetInputs: ["--address"]
        }
      ],
      selectionMode: "currentPageItem",
      selectionConditions: [
        {
          path: "data.items[].resolution.winnerAddress",
          operator: "nonNull"
        }
      ]
    },
    (hint) => hint.bindings[0]?.sourcePath === "data.items[].resolution.winnerAddress"
  );
  assertSpecHandoff(disputesList, "activities list", {
    targetCommand: "activities list",
    bindings: [
      {
        sourcePath: "data.items[].id",
        targetInputs: ["--dispute"]
      }
    ],
    selectionMode: "currentPageItem",
    note: "rerun the activity list scoped to the selected dispute"
  });

  assertEntityBinding(
    disputesVote,
    (binding) =>
      binding.entity === "agent" && binding.outputPaths?.includes("data.workload.agent") === true,
    {
      entity: "agent",
      relation: "related",
      outputPaths: ["data.vote.agent", "data.workload.agent"]
    }
  );
  assertSpecHandoff(disputesVote, "agents stats", {
    targetCommand: "agents stats",
    bindings: [
      {
        sourcePath: "data.workload.agent",
        targetInputs: ["--address"]
      }
    ]
  });
  assertSpecHandoff(disputesVote, "activities list", {
    targetCommand: "activities list",
    bindings: [
      {
        sourcePath: "data.vote.disputeId",
        targetInputs: ["--dispute"]
      }
    ],
    note: "rerun the activity list scoped to this dispute"
  });

  assertEntityBinding(
    disputesOpen,
    (binding) => binding.entity === "agent",
    {
      entity: "agent",
      relation: "related",
      outputPaths: ["data.opener"]
    }
  );
  assertSpecHandoff(disputesOpen, "disputes list", {
    targetCommand: "disputes list",
    bindings: [
      {
        sourcePath: "data.opener",
        targetInputs: ["--opener"]
      }
    ],
    note: "rerun the dispute list scoped to the opening agent"
  });
  assertSpecHandoff(disputesOpen, "activities list", {
    targetCommand: "activities list",
    bindings: [
      {
        sourcePath: "data.id",
        targetInputs: ["--dispute"]
      }
    ],
    note: "rerun the activity list scoped to this dispute"
  });

  assertEntityBinding(
    disputesRespond,
    (binding) => binding.outputPaths?.includes("data.counterpartyResponder") === true,
    {
      entity: "agent",
      relation: "related",
      outputPaths: ["data.counterpartyResponder"],
      note: "only after the counterparty reason is accepted and recorded"
    }
  );
  assertSpecHandoff(
    disputesRespond,
    "agents stats",
    {
      targetCommand: "agents stats",
      bindings: [
        {
          sourcePath: "data.counterpartyResponder",
          targetInputs: ["--address"]
        }
      ],
      selectionMode: "currentResult",
      selectionConditions: [
        {
          path: "data.counterpartyResponder",
          operator: "nonNull"
        }
      ]
    },
    (hint) => hint.bindings[0]?.sourcePath === "data.counterpartyResponder"
  );
  assertSpecHandoff(disputesRespond, "activities list", {
    targetCommand: "activities list",
    bindings: [
      {
        sourcePath: "data.id",
        targetInputs: ["--dispute"]
      }
    ],
    note: "rerun the activity list scoped to this dispute"
  });
});

test("cli config set accepts --value-file - from stdin", async () => {
  const isolatedConfigPath = join(tmpdir(), `agentrade-cli-stdin-config-${process.pid}-${Date.now()}.json`);
  const result = await runCli(
    ["config", "set", "base-url", "--value-file", "-"],
    { AGENTRADE_CLI_CONFIG_PATH: isolatedConfigPath },
    "http://localhost:3000\n"
  );
  assert.equal(result.code, 0);
  const envelope = JSON.parse(result.stdout) as {
    ok: boolean;
    command: string;
    data: {
      action: string;
      key: string;
      configured: { baseUrl: string | null };
      effective: { baseUrl: string };
    };
  };
  assert.equal(envelope.ok, true);
  assert.equal(envelope.command, "config set");
  assert.equal(envelope.data.action, "set");
  assert.equal(envelope.data.key, "baseUrl");
  assert.equal(envelope.data.configured.baseUrl, "http://localhost:3000");
  assert.equal(envelope.data.effective.baseUrl, "http://localhost:3000");
});

test("cli spec sorts prefix matches, omits discovery-only globals, and preserves documented defaults", async () => {
  const result = await runCli(["spec", "--command", "tasks"]);
  assert.equal(result.code, 0);
  const envelope = JSON.parse(result.stdout) as {
    ok: boolean;
    data: {
      globalOptions: Array<{ longFlag?: string }>;
      commands: Array<{
        path: string;
        options: Array<{ longFlag?: string; defaultValue?: unknown }>;
      }>;
    };
  };

  assert.equal(envelope.ok, true);
  assert.ok(!envelope.data.globalOptions.some((option) => option.longFlag === "--version"));
  assert.deepEqual(
    envelope.data.commands.map((command) => command.path),
    [
      "tasks create",
      "tasks get",
      "tasks intend",
      "tasks intentions",
      "tasks list",
      "tasks submit",
      "tasks terminate"
    ]
  );

  const tasksList = envelope.data.commands.find((command) => command.path === "tasks list");
  assert.equal(
    tasksList?.options.find((option) => option.longFlag === "--limit")?.defaultValue,
    "20"
  );
});

test("cli spec exposes structured auth requirement sources for privileged commands", async () => {
  const result = await runCli(["spec", "--command", "system settings update"]);
  assert.equal(result.code, 0);
  const envelope = JSON.parse(result.stdout) as {
    ok: boolean;
    data: {
      commands: Array<{
        path: string;
        auth: string;
        authRequirements: Array<{
          kind: string;
          sources: string[];
        }>;
        requestBindings: Array<{
          location: string;
          field: string;
          sources: string[];
          required?: boolean;
          description?: string;
          schema?: {
            type?: string;
            enum?: string[];
            minLength?: number;
            maxLength?: number;
            $ref?: string;
          };
        }>;
      }>;
    };
  };

  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.commands.length, 1);
  assert.equal(envelope.data.commands[0]?.path, "system settings update");
  assert.equal(envelope.data.commands[0]?.auth, "bearer_admin");
  assert.deepEqual(envelope.data.commands[0]?.authRequirements, [
    {
      kind: "token",
      sources: ["--token", "--token-file", "persistedConfig.token"]
    },
    {
      kind: "adminKey",
      sources: ["--admin-key", "--admin-key-file", "persistedConfig.adminKey"]
    }
  ]);
  assert.deepEqual(envelope.data.commands[0]?.requestBindings, [
    {
      location: "body",
      field: "applyTo",
      sources: ["--apply-to"],
      required: true,
      schema: {
        type: "string",
        enum: ["current", "next"]
      }
    },
    {
      location: "body",
      field: "patch",
      sources: ["--patch-json", "--patch-file"],
      required: true,
      schema: {
        $ref: "#/components/schemas/RuntimeEditableRulesPatch"
      }
    },
    {
      location: "body",
      field: "reason",
      sources: ["--reason"],
      required: false,
      schema: {
        type: "string",
        minLength: 1,
        maxLength: 1000
      }
    }
  ]);
});

test("cli spec exposes structured execution steps and side effects for composite and local commands", async () => {
  const authLoginResult = await runCli(["spec", "--command", "auth login"]);
  assert.equal(authLoginResult.code, 0);
  const authLoginEnvelope = JSON.parse(authLoginResult.stdout) as {
    ok: boolean;
    data: {
      commands: Array<{
        path: string;
        executionMode: string;
        operations?: Array<{ operationId: string }>;
        executionSteps: Array<{
          kind: string;
          summary: string;
          operationId?: string;
          condition?: string;
          inputSources?: string[];
          outputs?: string[];
        }>;
        sideEffects: Array<{
          target: string;
          action: string;
          summary: string;
          fields?: string[];
          condition?: string;
        }>;
        failureHints: Array<{
          match: {
            type: string;
            httpStatus?: number;
            apiError?: string;
            issuesKind?: string;
          };
          strategy: string;
          retryGate: string;
          summary: string;
          suggestedCommands: string[];
        }>;
        workflowHints: {
          phase: string;
          actorRoles: string[];
          prerequisiteCommands: string[];
          nextCommands: string[];
        };
        entityHints: {
          primaryEntity: string;
          bindings: Array<{
            entity: string;
            relation: string;
            inputSources?: string[];
            outputPaths?: string[];
          }>;
        };
        handoffHints: Array<{
          targetCommand: string;
          bindings: Array<{
            sourcePath?: string;
            sourceInput?: string;
            targetInputs: string[];
            note?: string;
          }>;
          selectionMode?: string;
          selectionConditions?: Array<{
            path: string;
            operator: string;
            value?: string | number | boolean;
          }>;
          note?: string;
        }>;
        automationHints: {
          effect: string;
          retryMode: string;
          preflightCommands: string[];
          verificationCommands: string[];
        };
        successFields: Array<{
          path: string;
          description: string;
          sensitive?: boolean;
          condition?: string;
        }>;
      }>;
    };
  };

  assert.equal(authLoginEnvelope.ok, true);
  assert.equal(authLoginEnvelope.data.commands.length, 1);
  assert.equal(authLoginEnvelope.data.commands[0]?.path, "auth login");
  assert.equal(authLoginEnvelope.data.commands[0]?.executionMode, "composite");
  assert.deepEqual(
    authLoginEnvelope.data.commands[0]?.operations?.map((item) => item.operationId),
    ["authChallengeV2", "authVerifyV2"]
  );
  assert.deepEqual(authLoginEnvelope.data.commands[0]?.executionSteps, [
    {
      kind: "local",
      summary:
        "resolve wallet private key from --private-key/--private-key-file or persisted CLI config, then derive and validate the effective address",
      inputSources: [
        "--address",
        "--private-key",
        "--private-key-file",
        "persistedConfig.walletPrivateKey",
        "persistedConfig.walletAddress"
      ],
      outputs: ["resolvedPrivateKey", "resolvedAddress"]
    },
    {
      kind: "apiOperation",
      operationId: "authChallengeV2",
      summary: "request a SIWE challenge for the resolved address",
      inputSources: ["resolvedAddress"],
      outputs: ["challenge.nonce", "challenge.message"]
    },
    {
      kind: "local",
      summary: "sign the returned challenge message with the resolved private key",
      inputSources: ["resolvedPrivateKey", "challenge.message"],
      outputs: ["signature"]
    },
    {
      kind: "apiOperation",
      operationId: "authVerifyV2",
      summary: "verify the signature and receive a bearer token",
      inputSources: ["resolvedAddress", "challenge.nonce", "challenge.message", "signature"],
      outputs: ["data.auth.token", "data.auth.expiresIn"]
    },
    {
      kind: "local",
      summary: "persist the returned token to local CLI config",
      condition: "skipped when --no-persist-token is set",
      inputSources: ["data.auth.token", "--no-persist-token"],
      outputs: ["data.persistence.tokenPersisted"]
    }
  ]);
  assert.deepEqual(authLoginEnvelope.data.commands[0]?.sideEffects, [
    {
      target: "persistedConfig",
      action: "write",
      summary: "writes the encrypted bearer token to persisted CLI config",
      fields: ["token"],
      condition: "only when --no-persist-token is not set"
    },
    {
      target: "secretKeyFile",
      action: "write",
      summary: "creates the local encryption key file used for persisted secrets if it does not already exist",
      condition: "only when token persistence occurs and encrypted secret key material is not present yet"
    }
  ]);
  assert.deepEqual(authLoginEnvelope.data.commands[0]?.automationHints, {
    effect: "compositeWrite",
    retryMode: "manual",
    preflightCommands: ["config show"],
    verificationCommands: ["config show"]
  });
  assert.deepEqual(
    authLoginEnvelope.data.commands[0]?.failureHints.find(
      (hint) => hint.match.type === "API_ERROR" && hint.match.apiError === "INVALID_SIGNATURE"
    ),
    {
      match: {
        type: "API_ERROR",
        apiError: "INVALID_SIGNATURE"
      },
      strategy: "fixInputs",
      retryGate: "afterInputRepair",
      summary: "verify that the effective wallet address matches the private key before rerunning login",
      suggestedCommands: ["config show"]
    }
  );
  assert.deepEqual(authLoginEnvelope.data.commands[0]?.workflowHints, {
    phase: "bootstrap",
    actorRoles: ["anonymous"],
    prerequisiteCommands: ["config show"],
    nextCommands: ["config show", "tasks list", "tasks create"]
  });
  assert.deepEqual(authLoginEnvelope.data.commands[0]?.entityHints, {
    primaryEntity: "authSession",
    bindings: [
      {
        entity: "agent",
        relation: "resolved",
        inputSources: [
          "--address",
          "--private-key",
          "--private-key-file",
          "persistedConfig.walletAddress",
          "persistedConfig.walletPrivateKey"
        ],
        outputPaths: ["data.wallet.address"]
      },
      {
        entity: "authSession",
        relation: "created",
        outputPaths: ["data.auth.token"]
      }
    ]
  });
  assert.deepEqual(authLoginEnvelope.data.commands[0]?.handoffHints, [
    {
      targetCommand: "agents profile get",
      bindings: [
        {
          sourcePath: "data.wallet.address",
          targetInputs: ["--address"]
        }
      ]
    },
    {
      targetCommand: "agents stats",
      bindings: [
        {
          sourcePath: "data.wallet.address",
          targetInputs: ["--address"]
        }
      ]
    },
    {
      targetCommand: "tasks create",
      bindings: [
        {
          sourcePath: "data.auth.token",
          targetInputs: ["--token", "--token-file"],
          note: "pass the verified bearer token inline or through a file"
        }
      ],
      note: "task publication still requires title, description, criteria, deadline, slots, and reward inputs"
    },
    {
      targetCommand: "config set",
      bindings: [
        {
          sourceLiteral: "token",
          targetInputs: ["<key>"]
        },
        {
          sourcePath: "data.auth.token",
          targetInputs: ["[value]"],
          note: "persist the verified token inline only when argv secret exposure is acceptable"
        }
      ],
      note: "config set writes the verified bearer token into local CLI config"
    },
    {
      targetCommand: "ledger get",
      bindings: [
        {
          sourcePath: "data.wallet.address",
          targetInputs: ["--address"]
        }
      ]
    },
    {
      targetCommand: "tasks list",
      bindings: [
        {
          sourcePath: "data.wallet.address",
          targetInputs: ["--publisher"]
        }
      ],
      note: "rerun the task list scoped to the authenticated agent as publisher"
    },
    {
      targetCommand: "submissions list",
      bindings: [
        {
          sourcePath: "data.wallet.address",
          targetInputs: ["--agent"]
        }
      ],
      note: "rerun the submission list scoped to the authenticated agent"
    },
    {
      targetCommand: "disputes list",
      bindings: [
        {
          sourcePath: "data.wallet.address",
          targetInputs: ["--opener"]
        }
      ],
      note: "rerun the dispute list scoped to the authenticated agent as opener"
    },
    {
      targetCommand: "activities list",
      bindings: [
        {
          sourcePath: "data.wallet.address",
          targetInputs: ["--address"]
        }
      ],
      note: "rerun the activity list scoped to the authenticated agent"
    }
  ]);
  assert.deepEqual(authLoginEnvelope.data.commands[0]?.successFields, [
    {
      path: "data.wallet.address",
      description: "resolved wallet address used for challenge and verification"
    },
    {
      path: "data.auth.token",
      description: "verified bearer token returned by auth verify",
      sensitive: true
    },
    {
      path: "data.auth.expiresIn",
      description: "token lifetime returned by auth verify"
    },
    {
      path: "data.persistence.tokenPersisted",
      description: "whether the verified token was persisted to local CLI config"
    },
    {
      path: "data.persistence.walletSource",
      description: "whether the wallet private key came from flags or persisted config"
    }
  ]);

  const configSetResult = await runCli(["spec", "--command", "config set"]);
  assert.equal(configSetResult.code, 0);
  const configSetEnvelope = JSON.parse(configSetResult.stdout) as {
    ok: boolean;
    data: {
      commands: Array<{
        path: string;
        executionMode: string;
        executionSteps: Array<{
          kind: string;
          summary: string;
          inputSources?: string[];
          outputs?: string[];
          condition?: string;
        }>;
        sideEffects: Array<{
          target: string;
          action: string;
          summary: string;
          condition?: string;
        }>;
        failureHints: Array<{
          match: {
            type: string;
          };
          strategy: string;
          retryGate: string;
          summary: string;
          suggestedCommands: string[];
        }>;
        workflowHints: {
          phase: string;
          actorRoles: string[];
          prerequisiteCommands: string[];
          nextCommands: string[];
        };
        entityHints: {
          primaryEntity: string;
          bindings: Array<{
            entity: string;
            relation: string;
            inputSources?: string[];
            outputPaths?: string[];
          }>;
        };
        handoffHints: Array<{
          targetCommand: string;
          bindings: Array<{
            sourcePath?: string;
            sourceInput?: string;
            targetInputs: string[];
            note?: string;
          }>;
          selectionMode?: string;
          selectionConditions?: Array<{
            path: string;
            operator: string;
            value?: string | number | boolean;
          }>;
          note?: string;
        }>;
        automationHints: {
          effect: string;
          retryMode: string;
          preflightCommands: string[];
          verificationCommands: string[];
        };
        successFields: Array<{
          path: string;
          description: string;
          condition?: string;
        }>;
      }>;
    };
  };

  assert.equal(configSetEnvelope.ok, true);
  assert.equal(configSetEnvelope.data.commands.length, 1);
  assert.equal(configSetEnvelope.data.commands[0]?.path, "config set");
  assert.equal(configSetEnvelope.data.commands[0]?.executionMode, "local");
  assert.deepEqual(configSetEnvelope.data.commands[0]?.executionSteps, [
    {
      kind: "local",
      summary: "resolve the config key alias and resolve the value from <value>, --value-file, or --value-file -",
      inputSources: ["<key>", "<value>", "--value-file", "stdin(-)"],
      outputs: ["resolvedConfigKey", "rawConfigValue"]
    },
    {
      kind: "local",
      summary: "validate and normalize the typed value for the selected config key",
      inputSources: ["resolvedConfigKey", "rawConfigValue"],
      outputs: ["normalizedConfigValue"]
    },
    {
      kind: "local",
      summary: "encrypt token/admin-key/wallet-private-key values before writing them at rest",
      condition: "only for persisted secret keys",
      inputSources: ["resolvedConfigKey", "normalizedConfigValue"],
      outputs: ["encryptedPersistedSecret"]
    },
    {
      kind: "local",
      summary: "write the updated config snapshot to the resolved CLI config path",
      inputSources: [
        "resolvedConfigKey",
        "normalizedConfigValue",
        "$AGENTRADE_CLI_CONFIG_PATH",
        "$XDG_CONFIG_HOME",
        "homedir"
      ],
      outputs: ["data.path", "data.exists", "data.configured", "data.effective"]
    }
  ]);
  assert.deepEqual(configSetEnvelope.data.commands[0]?.sideEffects, [
    {
      target: "persistedConfig",
      action: "write",
      summary: "writes the selected config field into persisted CLI config"
    },
    {
      target: "configFile",
      action: "write",
      summary: "writes or updates the JSON config file at the resolved CLI config path"
    },
    {
      target: "secretKeyFile",
      action: "write",
      summary: "creates the local encryption key file used for persisted secrets if it does not already exist",
      condition: "only when setting token, admin-key, or wallet-private-key"
    }
  ]);
  assert.deepEqual(configSetEnvelope.data.commands[0]?.automationHints, {
    effect: "localWrite",
    retryMode: "retryableAfterVerification",
    preflightCommands: ["config show"],
    verificationCommands: ["config show"]
  });
  assert.deepEqual(
    configSetEnvelope.data.commands[0]?.failureHints.find(
      (hint) => hint.match.type === "VALIDATION_ERROR"
    ),
    {
      match: {
        type: "VALIDATION_ERROR"
      },
      strategy: "fixInputs",
      retryGate: "afterInputRepair",
      summary: "repair local config keys, values, or file/stdin inputs before rerunning",
      suggestedCommands: ["config show"]
    }
  );
  assert.deepEqual(configSetEnvelope.data.commands[0]?.workflowHints, {
    phase: "config",
    actorRoles: ["any"],
    prerequisiteCommands: ["config show"],
    nextCommands: ["config show"]
  });
  assert.deepEqual(configSetEnvelope.data.commands[0]?.entityHints, {
    primaryEntity: "config",
    bindings: [
      {
        entity: "config",
        relation: "target",
        inputSources: ["<key>"],
        outputPaths: ["data.key", "data.path"]
      }
    ]
  });
  assert.deepEqual(configSetEnvelope.data.commands[0]?.handoffHints, []);
  assert.deepEqual(configSetEnvelope.data.commands[0]?.successFields, [
    {
      path: "data.action",
      description: "local config mutation action identifier"
    },
    {
      path: "data.key",
      description: "normalized persisted config key that was written"
    },
    {
      path: "data.path",
      description: "resolved path of the CLI config file"
    },
    {
      path: "data.exists",
      description: "whether the config file exists after the write"
    },
    {
      path: "data.configured",
      description: "persisted config snapshot after the write, with persisted secrets masked"
    },
    {
      path: "data.effective",
      description: "effective runtime values after overlaying persisted config on built-in defaults"
    },
    {
      path: "warnings[]",
      description: "non-fatal warnings such as legacy plaintext persisted secret notices",
      condition: "only when warnings are present"
    }
  ]);

  const configShowResult = await runCli(["spec", "--command", "config show"]);
  assert.equal(configShowResult.code, 0);
  const configShowEnvelope = JSON.parse(configShowResult.stdout) as {
    ok: boolean;
    data: {
      commands: Array<{
        path: string;
        executionMode: string;
        entityHints: {
          primaryEntity: string;
          bindings: Array<{
            entity: string;
            relation: string;
            inputSources?: string[];
            outputPaths?: string[];
            note?: string;
          }>;
        };
        handoffHints: Array<{
          targetCommand: string;
          bindings: Array<{
            sourcePath?: string;
            sourceInput?: string;
            targetInputs: string[];
            note?: string;
          }>;
          selectionMode?: string;
          selectionConditions?: Array<{
            path: string;
            operator: string;
            value?: string | number | boolean;
          }>;
          note?: string;
        }>;
        successFields: Array<{
          path: string;
          description: string;
          condition?: string;
        }>;
      }>;
    };
  };

  assert.equal(configShowEnvelope.ok, true);
  assert.equal(configShowEnvelope.data.commands[0]?.path, "config show");
  assert.equal(configShowEnvelope.data.commands[0]?.executionMode, "local");
  assert.deepEqual(
    configShowEnvelope.data.commands[0]?.entityHints.bindings.find(
      (binding) => binding.entity === "agent"
    ),
    {
      entity: "agent",
      relation: "related",
      outputPaths: ["data.effective.walletAddress"],
      note: "only when the effective CLI config includes a wallet address"
    }
  );
  assert.deepEqual(
    configShowEnvelope.data.commands[0]?.handoffHints.find(
      (hint) => hint.targetCommand === "agents profile get"
    ),
    {
      targetCommand: "agents profile get",
      bindings: [
        {
          sourcePath: "data.effective.walletAddress",
          targetInputs: ["--address"]
        }
      ],
      selectionMode: "currentResult",
      selectionConditions: [
        {
          path: "data.effective.walletAddress",
          operator: "nonNull"
        }
      ]
    }
  );
  assert.deepEqual(
    configShowEnvelope.data.commands[0]?.handoffHints.find(
      (hint) => hint.targetCommand === "tasks list"
    ),
    {
      targetCommand: "tasks list",
      bindings: [
        {
          sourcePath: "data.effective.walletAddress",
          targetInputs: ["--publisher"]
        }
      ],
      selectionMode: "currentResult",
      selectionConditions: [
        {
          path: "data.effective.walletAddress",
          operator: "nonNull"
        }
      ],
      note: "rerun the task list scoped to the effective wallet address as publisher"
    }
  );
  assert.deepEqual(
    configShowEnvelope.data.commands[0]?.successFields.find(
      (field) => field.path === "data.effective.walletAddress"
    ),
    {
      path: "data.effective.walletAddress",
      description: "effective wallet address currently available to CLI-authenticated flows",
      condition: "only when wallet address is configured"
    }
  );
});

test("cli spec rejects unknown command queries with a validation error", async () => {
  const result = await runCli(["spec", "--command", "unknown command"]);
  assert.equal(result.code, 2);
  const errorJson = JSON.parse(result.stderr.trim()) as {
    type: string;
    command: string;
    message: string;
  };
  assert.equal(errorJson.type, "VALIDATION_ERROR");
  assert.equal(errorJson.command, "spec");
  assert.match(errorJson.message, /unknown command query 'unknown command'/i);
});

test("cli fallback command detection keeps command path when global options are before command", async () => {
  const result = await runCli([
    "--pretty",
    "--base-url",
    "http://127.0.0.1:1",
    "tasks",
    "get"
  ]);

  assert.equal(result.code, 2);
  const errorJson = JSON.parse(result.stderr.trim()) as {
    type: string;
    command: string;
  };
  assert.equal(errorJson.type, "VALIDATION_ERROR");
  assert.equal(errorJson.command, "tasks get");
});

test("cli auth verify blocks empty nonce/signature before network request", async () => {
  const address = "0x1111111111111111111111111111111111111111";

  const emptyNonce = await runCli([
    "--base-url",
    "http://127.0.0.1:1",
    "auth",
    "verify",
    "--address",
    address,
    "--nonce",
    "   ",
    "--signature",
    "sig",
    "--message",
    "message"
  ]);
  assert.equal(emptyNonce.code, 2);
  const emptyNonceError = JSON.parse(emptyNonce.stderr.trim()) as {
    type: string;
    command: string;
    message: string;
  };
  assert.equal(emptyNonceError.type, "VALIDATION_ERROR");
  assert.equal(emptyNonceError.command, "auth verify");
  assert.match(emptyNonceError.message, /--nonce must be non-empty/);

  const emptySignature = await runCli([
    "--base-url",
    "http://127.0.0.1:1",
    "auth",
    "verify",
    "--address",
    address,
    "--nonce",
    "nonce-1",
    "--signature",
    " ",
    "--message",
    "message"
  ]);
  assert.equal(emptySignature.code, 2);
  const emptySignatureError = JSON.parse(emptySignature.stderr.trim()) as {
    type: string;
    command: string;
    message: string;
  };
  assert.equal(emptySignatureError.type, "VALIDATION_ERROR");
  assert.equal(emptySignatureError.command, "auth verify");
  assert.match(emptySignatureError.message, /--signature must be non-empty/);
});

test("cli auth login requires local wallet private key when no override is provided", async () => {
  const isolatedConfigPath = join(tmpdir(), `agentrade-cli-login-missing-${process.pid}-${Date.now()}.json`);
  const result = await runCli(
    ["--base-url", "http://127.0.0.1:1", "auth", "login"],
    { AGENTRADE_CLI_CONFIG_PATH: isolatedConfigPath }
  );
  assert.equal(result.code, 3);
  const errorJson = JSON.parse(result.stderr.trim()) as {
    type: string;
    command: string;
    message: string;
  };
  assert.equal(errorJson.type, "CONFIG_ERROR");
  assert.equal(errorJson.command, "auth login");
  assert.match(errorJson.message, /missing wallet private key/i);
  assert.match(errorJson.message, /config set wallet-private-key/i);
});

test("cli auth login blocks mismatched --address and --private-key before network request", async () => {
  const result = await runCli([
    "--base-url",
    "http://127.0.0.1:1",
    "auth",
    "login",
    "--address",
    "0x1111111111111111111111111111111111111111",
    "--private-key",
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  ]);
  assert.equal(result.code, 2);
  const errorJson = JSON.parse(result.stderr.trim()) as {
    type: string;
    command: string;
    message: string;
  };
  assert.equal(errorJson.type, "VALIDATION_ERROR");
  assert.equal(errorJson.command, "auth login");
  assert.match(errorJson.message, /does not match the resolved private key address/i);
});

test("cli tasks create blocks invalid timezone before network request", async () => {
  const result = await runCli(
    [
      "--base-url",
      "http://127.0.0.1:1",
      "--token",
      "token-1",
      "tasks",
      "create",
      "--title",
      "tz-check",
      "--desc",
      "desc",
      "--criteria",
      "criteria",
      "--deadline",
      "2027-01-01T00:00:00.000Z",
      "--tz",
      "Mars/Base",
      "--slots",
      "1",
      "--reward",
      "1"
    ]
  );
  assert.equal(result.code, 2);
  const errorJson = JSON.parse(result.stderr.trim()) as {
    type: string;
    command: string;
    message: string;
  };
  assert.equal(errorJson.type, "VALIDATION_ERROR");
  assert.equal(errorJson.command, "tasks create");
  assert.match(errorJson.message, /--tz must be a valid IANA timezone/);
});

test("cli tasks list blocks invalid status enum before network request", async () => {
  const result = await runCli([
    "--base-url",
    "http://127.0.0.1:1",
    "tasks",
    "list",
    "--status",
    "DONE"
  ]);
  assert.equal(result.code, 2);
  const errorJson = JSON.parse(result.stderr.trim()) as {
    type: string;
    command: string;
    message: string;
  };
  assert.equal(errorJson.type, "VALIDATION_ERROR");
  assert.equal(errorJson.command, "tasks list");
  assert.match(errorJson.message, /--status must be OPEN\|IN_PROGRESS\|TERMINATED\|CLOSED/);
});

test("cli tasks list blocks limit above pagination cap before network request", async () => {
  const result = await runCli([
    "--base-url",
    "http://127.0.0.1:1",
    "tasks",
    "list",
    "--limit",
    "101"
  ]);
  assert.equal(result.code, 2);
  const errorJson = JSON.parse(result.stderr.trim()) as {
    type: string;
    command: string;
    message: string;
  };
  assert.equal(errorJson.type, "VALIDATION_ERROR");
  assert.equal(errorJson.command, "tasks list");
  assert.match(errorJson.message, /--limit must be <= 100/);
});

test("cli agents profile update blocks overlong name before network request", async () => {
  const result = await runCli([
    "--base-url",
    "http://127.0.0.1:1",
    "--token",
    "token-1",
    "agents",
    "profile",
    "update",
    "--address",
    "0x1111111111111111111111111111111111111111",
    "--name",
    "x".repeat(121)
  ]);
  assert.equal(result.code, 2);
  const errorJson = JSON.parse(result.stderr.trim()) as {
    type: string;
    command: string;
    message: string;
  };
  assert.equal(errorJson.type, "VALIDATION_ERROR");
  assert.equal(errorJson.command, "agents profile update");
  assert.match(errorJson.message, /--name must be <= 120 characters/);
});

test("cli agents profile update rejects blank text and requires explicit clear flags", async () => {
  const blankName = await runCli([
    "--base-url",
    "http://127.0.0.1:1",
    "--token",
    "token-1",
    "agents",
    "profile",
    "update",
    "--address",
    "0x1111111111111111111111111111111111111111",
    "--name",
    "   "
  ]);
  assert.equal(blankName.code, 2);
  const blankNameError = JSON.parse(blankName.stderr.trim()) as {
    type: string;
    command: string;
    message: string;
  };
  assert.equal(blankNameError.type, "VALIDATION_ERROR");
  assert.equal(blankNameError.command, "agents profile update");
  assert.match(blankNameError.message, /--name must be non-empty/);

  const conflictingClear = await runCli([
    "--base-url",
    "http://127.0.0.1:1",
    "--token",
    "token-1",
    "agents",
    "profile",
    "update",
    "--address",
    "0x1111111111111111111111111111111111111111",
    "--clear-bio",
    "--bio",
    "bio-inline"
  ]);
  assert.equal(conflictingClear.code, 2);
  const conflictingClearError = JSON.parse(conflictingClear.stderr.trim()) as {
    type: string;
    command: string;
    message: string;
  };
  assert.equal(conflictingClearError.type, "VALIDATION_ERROR");
  assert.equal(conflictingClearError.command, "agents profile update");
  assert.match(conflictingClearError.message, /--clear-bio is mutually exclusive with --bio\/--bio-file/);
});

test("cli stdin alias allows only one file-backed input per invocation", async () => {
  const result = await runCli(
    [
      "--base-url",
      "http://127.0.0.1:1",
      "--token",
      "token-1",
      "tasks",
      "create",
      "--title",
      "stdin-conflict",
      "--desc-file",
      "-",
      "--criteria-file",
      "-",
      "--deadline",
      "2027-01-01T00:00:00.000Z",
      "--tz",
      "UTC",
      "--slots",
      "1",
      "--reward",
      "1"
    ],
    {},
    "stdin-body"
  );
  assert.equal(result.code, 2);
  const errorJson = JSON.parse(result.stderr.trim()) as {
    type: string;
    command: string;
    message: string;
  };
  assert.equal(errorJson.type, "VALIDATION_ERROR");
  assert.equal(errorJson.command, "tasks create");
  assert.match(errorJson.message, /stdin is already reserved by --desc-file/i);
});

test("cli system settings reset blocks overlong reason before network request", async () => {
  const result = await runCli([
    "--base-url",
    "http://127.0.0.1:1",
    "--token",
    "token-1",
    "--admin-key",
    "admin-1",
    "system",
    "settings",
    "reset",
    "--apply-to",
    "current",
    "--reason",
    "x".repeat(1001)
  ]);
  assert.equal(result.code, 2);
  const errorJson = JSON.parse(result.stderr.trim()) as {
    type: string;
    command: string;
    message: string;
  };
  assert.equal(errorJson.type, "VALIDATION_ERROR");
  assert.equal(errorJson.command, "system settings reset");
  assert.match(errorJson.message, /--reason must be <= 1000 characters/);
});

test("cli disputes list blocks removed status enum before network request", async () => {
  const result = await runCli([
    "--base-url",
    "http://127.0.0.1:1",
    "disputes",
    "list",
    "--status",
    "RESOLVED_NOT_COMPLETED"
  ]);
  assert.equal(result.code, 2);
  const errorJson = JSON.parse(result.stderr.trim()) as {
    type: string;
    command: string;
    message: string;
  };
  assert.equal(errorJson.type, "VALIDATION_ERROR");
  assert.equal(errorJson.command, "disputes list");
  assert.match(errorJson.message, /--status must be OPEN\|RESOLVED_COMPLETED/);
});

test("cli activities list accepts TASK_SUBMITTED, SUBMISSION_REJECTED, and ADMIN_AUDIT enum values", async () => {
  for (const activityType of ["TASK_SUBMITTED", "SUBMISSION_REJECTED", "ADMIN_AUDIT"] as const) {
    const result = await runCli([
      "--base-url",
      "http://127.0.0.1:1",
      "activities",
      "list",
      "--type",
      activityType
    ]);
    assert.equal(result.code, 5);
    const errorJson = JSON.parse(result.stderr.trim()) as {
      type: string;
      command: string;
    };
    assert.equal(errorJson.type, "NETWORK_ERROR");
    assert.equal(errorJson.command, "activities list");
  }
});
