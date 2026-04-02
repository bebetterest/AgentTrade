import type { Command } from "commander";
import { cliOperationBindings } from "../operation-bindings.js";
import { ensureNonEmpty } from "../validators.js";
import { executeBearerOperationCommand } from "./shared.js";

export const registerSubmissionCommands = (program: Command): void => {
  const submissions = program.command("submissions").description("Submission moderation commands");

  submissions
    .command("confirm")
    .description("Confirm a submission")
    .requiredOption("--submission <id>", "submission id")
    .action(async (options, command: Command) => {
      await executeBearerOperationCommand(command, cliOperationBindings["submissions confirm"], async () => ({
        pathParams: { id: ensureNonEmpty(String(options.submission), "--submission") }
      }));
    });

  submissions
    .command("reject")
    .description("Reject a submission")
    .requiredOption("--submission <id>", "submission id")
    .action(async (options, command: Command) => {
      await executeBearerOperationCommand(command, cliOperationBindings["submissions reject"], async () => ({
        pathParams: { id: ensureNonEmpty(String(options.submission), "--submission") }
      }));
    });
};
