import type { Command } from "commander";
import { cliOperationBindings } from "../operation-bindings.js";
import { resolveTextInput } from "../text-input.js";
import {
  ensureAddress,
  ensureFeedbackReportType,
  ensureNonEmpty,
  ensurePageLimit
} from "../validators.js";
import {
  addInputContractHelp,
  executeAdminOperationCommand,
  executeBearerOperationCommand,
  OPAQUE_CURSOR_HELP
} from "./shared.js";

export const registerFeedbackCommands = (program: Command): void => {
  const feedback = program.command("feedback").description("Bug and suggestion feedback commands");

  addInputContractHelp(
    feedback
      .command("submit")
      .description("Submit bug or suggestion feedback (token required)")
      .requiredOption("--type <type>", "BUG|SUGGESTION")
      .option("--title <title>", "feedback title")
      .option("--title-file <path>", "file containing feedback title")
      .option("--body <markdown>", "feedback body markdown")
      .option("--body-file <path>", "file containing feedback body markdown"),
    ["require one of --title / --title-file", "require one of --body / --body-file"]
  ).action(async (options, command: Command) => {
    await executeBearerOperationCommand(command, cliOperationBindings["feedback submit"], async () => {
      const title = resolveTextInput({
        inlineValue: options.title,
        filePath: options.titleFile,
        fieldName: "title"
      });
      const bodyMd = resolveTextInput({
        inlineValue: options.body,
        filePath: options.bodyFile,
        fieldName: "body"
      });
      return {
        body: {
          type: ensureFeedbackReportType(String(options.type), "--type"),
          title,
          bodyMd
        }
      };
    });
  });

  feedback
    .command("list")
    .description("List feedback reports (token + admin key required)")
    .option("--type <type>", "BUG|SUGGESTION")
    .option("--reporter <address>", "reporter address filter")
    .option("--cursor <cursor>", OPAQUE_CURSOR_HELP)
    .option("--limit <number>", "page size (1-100, default: 20)")
    .action(async (options, command: Command) => {
      await executeAdminOperationCommand(command, cliOperationBindings["feedback list"], async () => ({
        query: {
          type: typeof options.type === "string" ? ensureFeedbackReportType(options.type, "--type") : undefined,
          reporter:
            typeof options.reporter === "string"
              ? ensureAddress(options.reporter, "--reporter")
              : undefined,
          cursor: typeof options.cursor === "string" ? ensureNonEmpty(options.cursor, "--cursor") : undefined,
          limit: typeof options.limit === "string" ? ensurePageLimit(options.limit, "--limit") : undefined
        }
      }));
    });

  feedback
    .command("get")
    .description("Get feedback report details (token + admin key required)")
    .requiredOption("--id <id>", "feedback report id")
    .action(async (options, command: Command) => {
      await executeAdminOperationCommand(command, cliOperationBindings["feedback get"], async () => ({
        pathParams: { id: ensureNonEmpty(String(options.id), "--id") }
      }));
    });
};
