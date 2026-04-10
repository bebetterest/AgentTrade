import { Command } from "commander";
import { loadCliRuntimeConfig } from "@agentrade/config";
import { registerAdminCommands } from "./commands/admin.js";
import { registerActivityCommands } from "./commands/activities.js";
import { registerAgentCommands } from "./commands/agents.js";
import { registerAuthCommands } from "./commands/auth.js";
import { registerCycleCommands } from "./commands/cycles.js";
import { registerDashboardCommands } from "./commands/dashboard.js";
import { registerDisputeCommands } from "./commands/disputes.js";
import { registerEconomyCommands } from "./commands/economy.js";
import { registerLedgerCommands } from "./commands/ledger.js";
import { registerSubmissionCommands } from "./commands/submissions.js";
import { registerSystemCommands } from "./commands/system.js";
import { registerTaskCommands } from "./commands/tasks.js";
import { printErrorJson, normalizeCliError, shouldSuppressCommanderError } from "./output.js";

const cliRuntime = loadCliRuntimeConfig();
const DEFAULT_BASE_URL = cliRuntime.apiBaseUrl;
const DEFAULT_TOKEN = cliRuntime.token;
const DEFAULT_ADMIN_KEY = cliRuntime.adminServiceKey;
const DEFAULT_TIMEOUT_MS = cliRuntime.timeoutMs;
const DEFAULT_RETRIES = cliRuntime.retries;
const GLOBAL_OPTIONS_WITH_VALUE = new Set([
  "--base-url",
  "--token",
  "--admin-key",
  "--timeout-ms",
  "--retries"
]);
const GLOBAL_BOOLEAN_OPTIONS = new Set(["--pretty"]);
const HELP_APPENDIX = `
Environment variable fallbacks:
  AGENTRADE_API_BASE_URL
  AGENTRADE_TOKEN
  AGENTRADE_ADMIN_SERVICE_KEY
  AGENTRADE_TIMEOUT_MS
  AGENTRADE_RETRIES

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
    .version("0.1.1")
    .option("--base-url <url>", "API base URL", DEFAULT_BASE_URL)
    .option("--token <token>", "bearer token for authenticated routes", DEFAULT_TOKEN)
    .option("--admin-key <key>", "admin service key for admin routes", DEFAULT_ADMIN_KEY)
    .option("--timeout-ms <ms>", "request timeout in milliseconds", DEFAULT_TIMEOUT_MS)
    .option("--retries <count>", "retry count for network/429/5xx errors", DEFAULT_RETRIES)
    .option("--pretty", "pretty-print JSON output", false)
    .showHelpAfterError(false)
    .configureOutput({
      writeErr: () => undefined
    })
    .addHelpText("after", HELP_APPENDIX)
    .exitOverride();

  registerAuthCommands(program);
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
  registerAdminCommands(program);

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
