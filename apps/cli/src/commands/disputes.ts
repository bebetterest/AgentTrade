import type { Command } from "commander";
import type { Dispute } from "@agentrade/types";
import { CliValidationError } from "../errors.js";
import { cliOperationBindings } from "../operation-bindings.js";
import { ensureAddress, ensureNonEmpty, ensurePositiveInteger, ensureVoteChoice } from "../validators.js";
import { resolveTextInput } from "../text-input.js";
import { executeBearerOperationCommand, executeOperationCommand } from "./shared.js";

const ensureDisputeStatus = (raw: string): Dispute["status"] => {
  const normalized = raw.trim().toUpperCase();
  if (normalized !== "OPEN" && normalized !== "RESOLVED_COMPLETED") {
    throw new CliValidationError("--status must be OPEN|RESOLVED_COMPLETED");
  }
  return normalized as Dispute["status"];
};

export const registerDisputeCommands = (program: Command): void => {
  const disputes = program.command("disputes").description("Dispute and supervision commands");

  disputes
    .command("list")
    .description("List disputes")
    .option("--task <id>", "task id")
    .option("--opener <address>", "opener address")
    .option("--status <status>", "OPEN|RESOLVED_COMPLETED")
    .option("--q <text>", "search by ids/opener/reason")
    .option("--sort <key>", "latest|created")
    .option("--order <order>", "asc|desc")
    .option("--cursor <offset>", "pagination cursor")
    .option("--limit <number>", "page size")
    .action(async (options, command: Command) => {
      await executeOperationCommand(command, cliOperationBindings["disputes list"], async () => ({
        query: {
          taskId: typeof options.task === "string" ? ensureNonEmpty(options.task, "--task") : undefined,
          opener: typeof options.opener === "string" ? ensureAddress(options.opener, "--opener") : undefined,
          status: typeof options.status === "string" ? ensureDisputeStatus(options.status) : undefined,
          q: typeof options.q === "string" ? ensureNonEmpty(options.q, "--q") : undefined,
          sort: typeof options.sort === "string" ? options.sort.trim().toLowerCase() as "latest" | "created" : undefined,
          order: typeof options.order === "string" ? options.order.trim().toLowerCase() as "asc" | "desc" : undefined,
          cursor: typeof options.cursor === "string" ? ensureNonEmpty(options.cursor, "--cursor") : undefined,
          limit: typeof options.limit === "string" ? ensurePositiveInteger(options.limit, "--limit") : undefined
        }
      }));
    });

  disputes
    .command("get")
    .description("Get dispute details")
    .requiredOption("--dispute <id>", "dispute id")
    .action(async (options, command: Command) => {
      await executeOperationCommand(command, cliOperationBindings["disputes get"], async () => ({
        pathParams: { id: ensureNonEmpty(String(options.dispute), "--dispute") }
      }));
    });

  disputes
    .command("open")
    .description("Open a dispute")
    .requiredOption("--task <id>", "task id")
    .requiredOption("--submission <id>", "submission id")
    .option("--reason <markdown>", "reason markdown")
    .option("--reason-file <path>", "file containing dispute reason markdown")
    .action(async (options, command: Command) => {
      await executeBearerOperationCommand(command, cliOperationBindings["disputes open"], async () => {
        const reasonMd = resolveTextInput({
          inlineValue: options.reason,
          filePath: options.reasonFile,
          fieldName: "reason"
        });
        return {
          body: {
            taskId: ensureNonEmpty(String(options.task), "--task"),
            submissionId: ensureNonEmpty(String(options.submission), "--submission"),
            reasonMd: String(reasonMd)
          }
        };
      });
    });

  disputes
    .command("vote")
    .description("Vote on a dispute")
    .requiredOption("--dispute <id>", "dispute id")
    .requiredOption("--vote <choice>", "COMPLETED or NOT_COMPLETED")
    .action(async (options, command: Command) => {
      await executeBearerOperationCommand(command, cliOperationBindings["disputes vote"], async () => ({
        pathParams: { id: ensureNonEmpty(String(options.dispute), "--dispute") },
        body: {
          vote: ensureVoteChoice(String(options.vote))
        }
      }));
    });
};
