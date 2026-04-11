import { Command } from "commander";
import { registerActivityCommands } from "./commands/activities.js";
import { registerAgentCommands } from "./commands/agents.js";
import { registerAuthCommands } from "./commands/auth.js";
import { registerConfigCommands } from "./commands/config.js";
import { registerCycleCommands } from "./commands/cycles.js";
import { registerDashboardCommands } from "./commands/dashboard.js";
import { registerDisputeCommands } from "./commands/disputes.js";
import { registerEconomyCommands } from "./commands/economy.js";
import { registerLedgerCommands } from "./commands/ledger.js";
import { registerSubmissionCommands } from "./commands/submissions.js";
import { registerSystemCommands } from "./commands/system.js";
import { registerTaskCommands } from "./commands/tasks.js";
import {
  CLI_DEFAULT_BASE_URL,
  CLI_DEFAULT_RETRIES,
  CLI_DEFAULT_TIMEOUT_MS
} from "./cli-config.js";
import { printErrorJson, normalizeCliError, shouldSuppressCommanderError } from "./output.js";

const GLOBAL_OPTIONS_WITH_VALUE = new Set([
  "--base-url",
  "--token",
  "--admin-key",
  "--timeout-ms",
  "--retries"
]);
const GLOBAL_BOOLEAN_OPTIONS = new Set(["--pretty"]);
const HELP_APPENDIX = `
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
  --token / --admin-key remain optional unless required by command auth mode

Output contract:
  success: stdout JSON
  failure: stderr JSON with {type,message,httpStatus,apiError,issues,retryable,command}

Exit codes:
  0 success | 2 validation | 3 config | 4 api | 5 network | 10 unknown
`;

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
    .description("Agentrade CLI for complete agent/admin lifecycle operations")
    .version("0.1.2")
    .option("--base-url <url>", "API base URL")
    .option("--token <token>", "bearer token for authenticated routes")
    .option("--admin-key <key>", "admin service key for admin routes")
    .option("--timeout-ms <ms>", "request timeout in milliseconds")
    .option("--retries <count>", "retry count for network/429/5xx errors")
    .option("--pretty", "pretty-print JSON output", false)
    .showHelpAfterError(false)
    .configureOutput({
      writeErr: () => undefined
    })
    .addHelpText("after", HELP_APPENDIX)
    .exitOverride();

  registerAuthCommands(program);
  registerConfigCommands(program);
  registerSystemCommands(program);
  registerTaskCommands(program);
  registerSubmissionCommands(program);
  registerDisputeCommands(program);
  registerAgentCommands(program);
  registerActivityCommands(program);
  registerDashboardCommands(program);
  registerLedgerCommands(program);
  registerCycleCommands(program);
  registerEconomyCommands(program);

  return program;
};

export const runCli = async (argv: string[] = process.argv): Promise<void> => {
  const program = buildProgram();
  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (shouldSuppressCommanderError(error)) {
      return;
    }
    const command = detectCommandFromArgv(argv);
    const normalized = normalizeCliError(error, command);
    printErrorJson(normalized.output);
    process.exit(normalized.exitCode);
  }
};
