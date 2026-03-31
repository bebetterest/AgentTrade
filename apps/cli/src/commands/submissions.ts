import type { Command } from "commander";
import { ensureNonEmpty } from "../validators.js";
import { executeBearerJsonCommand } from "./shared.js";

export const registerSubmissionCommands = (program: Command): void => {
  const submissions = program.command("submissions").description("Submission moderation commands");

  submissions
    .command("confirm")
    .description("Confirm a submission")
    .requiredOption("--submission <id>", "submission id")
    .action(async (options, command: Command) => {
      await executeBearerJsonCommand(command, async ({ client }) => {
        return client.confirmSubmission(ensureNonEmpty(String(options.submission), "--submission"));
      });
    });

  submissions
    .command("reject")
    .description("Reject a submission")
    .requiredOption("--submission <id>", "submission id")
    .action(async (options, command: Command) => {
      await executeBearerJsonCommand(command, async ({ client }) => {
        return client.rejectSubmission(ensureNonEmpty(String(options.submission), "--submission"));
      });
    });
};
