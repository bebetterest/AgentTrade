import type { Command } from "commander";
import { cliOperationBindings } from "../operation-bindings.js";
import {
  ensureAddress,
  ensureNonEmpty,
  ensurePageLimit,
  ensureQueryOrder,
  ensureSubmissionListSort,
  ensureSubmissionStatus
} from "../validators.js";
import { resolveTextInput } from "../text-input.js";
import {
  OPAQUE_CURSOR_HELP,
  addInputContractHelp,
  executeBearerOperationCommand,
  executeOperationCommand
} from "./shared.js";

export const registerSubmissionCommands = (program: Command): void => {
  const submissions = program.command("submissions").description("Submission query and moderation commands");

  submissions
    .command("list")
    .description("List submissions")
    .option("--task <id>", "task id")
    .option("--agent <address>", "submission agent address")
    .option("--status <status>", "SUBMITTED|CONFIRMED|REJECTED")
    .option("--q <text>", "search by id/agent/payload")
    .option("--sort <key>", "latest|created (default: latest)")
    .option("--order <order>", "asc|desc (default: desc)")
    .option("--cursor <cursor>", OPAQUE_CURSOR_HELP)
    .option("--limit <number>", "page size (1-100, default: 20)")
    .action(async (options, command: Command) => {
      await executeOperationCommand(command, cliOperationBindings["submissions list"], async () => ({
        query: {
          taskId: typeof options.task === "string" ? ensureNonEmpty(options.task, "--task") : undefined,
          agent: typeof options.agent === "string" ? ensureAddress(options.agent, "--agent") : undefined,
          status: typeof options.status === "string" ? ensureSubmissionStatus(options.status) : undefined,
          q: typeof options.q === "string" ? ensureNonEmpty(options.q, "--q") : undefined,
          sort: typeof options.sort === "string" ? ensureSubmissionListSort(options.sort) : undefined,
          order: typeof options.order === "string" ? ensureQueryOrder(options.order) : undefined,
          cursor: typeof options.cursor === "string" ? ensureNonEmpty(options.cursor, "--cursor") : undefined,
          limit: typeof options.limit === "string" ? ensurePageLimit(options.limit, "--limit") : undefined
        }
      }));
    });

  submissions
    .command("get")
    .description("Get submission details")
    .requiredOption("--submission <id>", "submission id")
    .action(async (options, command: Command) => {
      await executeOperationCommand(command, cliOperationBindings["submissions get"], async () => ({
        pathParams: { id: ensureNonEmpty(String(options.submission), "--submission") }
      }));
    });

  submissions
    .command("confirm")
    .description("Confirm a submission (token required)")
    .requiredOption("--submission <id>", "submission id")
    .action(async (options, command: Command) => {
      await executeBearerOperationCommand(command, cliOperationBindings["submissions confirm"], async () => ({
        pathParams: { id: ensureNonEmpty(String(options.submission), "--submission") }
      }));
    });

  addInputContractHelp(
    submissions
      .command("reject")
      .description("Reject a submission (token required)")
      .requiredOption("--submission <id>", "submission id")
      .option("--reason <markdown>", "rejection reason markdown")
      .option("--reason-file <path>", "file containing rejection reason markdown"),
    ["require one of --reason / --reason-file"]
  ).action(async (options, command: Command) => {
      await executeBearerOperationCommand(command, cliOperationBindings["submissions reject"], async () => {
        const reasonMd = resolveTextInput({
          inlineValue: options.reason,
          filePath: options.reasonFile,
          fieldName: "reason"
        });
        return {
          pathParams: { id: ensureNonEmpty(String(options.submission), "--submission") },
          body: {
            reasonMd: String(reasonMd)
            }
          };
        });
  });
};
