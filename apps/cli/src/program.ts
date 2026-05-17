import { Command, Help, type Option } from "commander";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { registerActivityCommands } from "./commands/activities.js";
import { registerAgentCommands } from "./commands/agents.js";
import { registerAuthCommands } from "./commands/auth.js";
import { registerConfigCommands } from "./commands/config.js";
import { registerCycleCommands } from "./commands/cycles.js";
import { registerDashboardCommands } from "./commands/dashboard.js";
import { registerDisputeCommands } from "./commands/disputes.js";
import { registerEconomyCommands } from "./commands/economy.js";
import { registerFeedbackCommands } from "./commands/feedback.js";
import { registerLedgerCommands } from "./commands/ledger.js";
import { registerSubmissionCommands } from "./commands/submissions.js";
import { registerSystemCommands } from "./commands/system.js";
import { registerTaskCommands } from "./commands/tasks.js";
import { registerTodoCommands } from "./commands/todos.js";
import { registerSpecCommands } from "./commands/spec.js";
import {
  CLI_DEFAULT_BASE_URL,
  CLI_DEFAULT_RETRIES,
  CLI_DEFAULT_TIMEOUT_MS
} from "./cli-config.js";
import { printErrorJson, normalizeCliError, shouldSuppressCommanderError } from "./output.js";

const GLOBAL_OPTIONS_WITH_VALUE = new Set([
  "--base-url",
  "--token",
  "--token-file",
  "--admin-key",
  "--admin-key-file",
  "--timeout-ms",
  "--retries"
]);
const GLOBAL_BOOLEAN_OPTIONS = new Set(["--pretty"]);
const SHARED_HELP_APPENDIX = `
CLI runtime setting precedence:
  1) command flags
  2) global config file (agentrade config set/show/unset)
  3) built-in defaults

Global config file path:
  $AGENTRADE_CLI_CONFIG_PATH
  or $XDG_CONFIG_HOME/agentrade/config.json
  or ~/.agentrade/config.json

Built-in defaults:
  --base-url (default: ${CLI_DEFAULT_BASE_URL})
  --timeout-ms (default: ${CLI_DEFAULT_TIMEOUT_MS})
  --retries (default: ${CLI_DEFAULT_RETRIES})
  --token / --token-file / --admin-key / --admin-key-file remain optional unless required by command auth mode

Automation note:
  prefer --token-file / --admin-key-file for secrets to avoid argv exposure in logs and process lists
  prefer file-backed text/JSON flags for generated or multiline content to preserve exact bytes across shell invocation
  file-backed credential/text/JSON/value flags accept '-' to read UTF-8 from stdin (single stdin-backed input per invocation)

Output contract:
  success: command execution writes stdout JSON with {ok,command,data,warnings?}
  exception: --help and --version write plain text to stdout
  failure: stderr JSON with {type,message,httpStatus,apiError,issues,retryable,command}

Exit codes:
  0 success | 2 validation | 3 config | 4 api | 5 network | 10 unknown
`;

const getHelpOptionIdentity = (option: Option): string => option.long ?? option.short ?? option.flags;

class SharedCliHelp extends Help {
  override visibleGlobalOptions(command: Command): Option[] {
    const visibleGlobalOptions = super.visibleGlobalOptions(command);
    if (visibleGlobalOptions.length === 0) {
      return visibleGlobalOptions;
    }

    const localOptionIdentities = new Set(
      super.visibleOptions(command).map((option) => getHelpOptionIdentity(option))
    );

    return visibleGlobalOptions.filter(
      (option) => !localOptionIdentities.has(getHelpOptionIdentity(option))
    );
  }
}

const applySharedHelpConfiguration = (command: Command, isRoot = false): void => {
  command.createHelp = () => Object.assign(new SharedCliHelp(), command.configureHelp());
  if (!isRoot) {
    command.configureHelp({ showGlobalOptions: true });
  }
  command.addHelpText("after", SHARED_HELP_APPENDIX);
  for (const child of command.commands) {
    applySharedHelpConfiguration(child);
  }
};

const findMatchingSubcommand = (command: Command, token: string): Command | null => {
  return (
    command.commands.find((candidate) => candidate.name() === token || candidate.aliases().includes(token)) ??
    null
  );
};

const resolveCommandPath = (command: Command, tokens: string[]): Command | null => {
  let current: Command | null = command;
  for (const token of tokens) {
    if (token === "--" || token.startsWith("-")) {
      return null;
    }
    current = current ? findMatchingSubcommand(current, token) : null;
    if (!current) {
      return null;
    }
  }
  return current;
};

const rewriteNestedHelpArgv = (argv: string[], program: Command): string[] => {
  const prefix = argv.slice(0, 2);
  const tokens = argv.slice(2);
  if (tokens.length <= 1) {
    return argv;
  }

  const leadingGlobalTokens: string[] = [];
  let commandStartIndex = 0;
  while (commandStartIndex < tokens.length) {
    const token = tokens[commandStartIndex];
    if (token === "--") {
      return argv;
    }
    if (GLOBAL_OPTIONS_WITH_VALUE.has(token) && commandStartIndex + 1 < tokens.length) {
      leadingGlobalTokens.push(token, tokens[commandStartIndex + 1]!);
      commandStartIndex += 2;
      continue;
    }
    if ([...GLOBAL_OPTIONS_WITH_VALUE].some((option) => token.startsWith(`${option}=`))) {
      leadingGlobalTokens.push(token);
      commandStartIndex += 1;
      continue;
    }
    if (GLOBAL_BOOLEAN_OPTIONS.has(token)) {
      leadingGlobalTokens.push(token);
      commandStartIndex += 1;
      continue;
    }
    break;
  }

  const commandTokens = tokens.slice(commandStartIndex);
  if (commandTokens.includes("--")) {
    return argv;
  }
  const helpIndex = commandTokens.indexOf("help");
  if (helpIndex === -1) {
    return argv;
  }

  const beforeHelp = commandTokens.slice(0, helpIndex);
  const afterHelp = commandTokens.slice(helpIndex + 1);
  if (afterHelp.length <= 1) {
    return argv;
  }
  const startCommand = beforeHelp.length === 0 ? program : resolveCommandPath(program, beforeHelp);
  if (!startCommand) {
    return argv;
  }
  if (!resolveCommandPath(startCommand, afterHelp)) {
    return argv;
  }

  return [...prefix, ...leadingGlobalTokens, ...beforeHelp, ...afterHelp, "--help"];
};

const resolveCliVersion = (): string => {
  try {
    const sourceDir = dirname(fileURLToPath(import.meta.url));
    const packageJsonPath = resolve(sourceDir, "../package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: string };
    if (typeof packageJson.version === "string" && packageJson.version.length > 0) {
      return packageJson.version;
    }
  } catch {
    return "0.0.0";
  }
  return "0.0.0";
};

const CLI_VERSION = resolveCliVersion();

const detectCommandFromArgv = (argv: string[]): string => {
  const segments: string[] = [];
  const tokens = argv.slice(2);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--") {
      break;
    }

    if (token.startsWith("-")) {
      if (segments.length > 0) {
        break;
      }

      if (GLOBAL_OPTIONS_WITH_VALUE.has(token) && index + 1 < tokens.length) {
        index += 1;
        continue;
      }

      if ([...GLOBAL_OPTIONS_WITH_VALUE].some((option) => token.startsWith(`${option}=`))) {
        continue;
      }

      if (GLOBAL_BOOLEAN_OPTIONS.has(token)) {
        continue;
      }

      break;
    }

    segments.push(token);
  }

  return segments.join(" ") || "agentrade";
};

export const buildProgram = (): Command => {
  const program = new Command();

  program
    .name("agentrade")
    .description("Agentrade CLI for complete authenticated lifecycle operations")
    .version(CLI_VERSION)
    .option("--base-url <url>", "API base URL")
    .option("--token <token>", "inline bearer token; prefer --token-file when argv exposure is unacceptable")
    .option("--token-file <path>", "file containing bearer token")
    .option("--admin-key <key>", "inline admin service key; prefer --admin-key-file when argv exposure is unacceptable")
    .option("--admin-key-file <path>", "file containing admin service key")
    .option("--timeout-ms <ms>", "request timeout in milliseconds")
    .option("--retries <count>", "retry count for network/429/5xx errors")
    .option("--pretty", "pretty-print JSON output", false)
    .showHelpAfterError(false)
    .configureOutput({
      writeErr: () => undefined
    })
    .exitOverride();

  registerAuthCommands(program);
  registerConfigCommands(program);
  registerSpecCommands(program);
  registerSystemCommands(program);
  registerTaskCommands(program);
  registerSubmissionCommands(program);
  registerDisputeCommands(program);
  registerFeedbackCommands(program);
  registerAgentCommands(program);
  registerActivityCommands(program);
  registerDashboardCommands(program);
  registerTodoCommands(program);
  registerLedgerCommands(program);
  registerCycleCommands(program);
  registerEconomyCommands(program);
  applySharedHelpConfiguration(program, true);

  return program;
};

export const runCli = async (argv: string[] = process.argv): Promise<void> => {
  const program = buildProgram();
  const normalizedArgv = rewriteNestedHelpArgv(argv, program);
  try {
    await program.parseAsync(normalizedArgv);
  } catch (error) {
    if (shouldSuppressCommanderError(error)) {
      return;
    }
    const command = detectCommandFromArgv(normalizedArgv);
    const normalized = normalizeCliError(error, command);
    printErrorJson(normalized.output);
    process.exit(normalized.exitCode);
  }
};
