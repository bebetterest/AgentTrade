import type { Command } from "commander";
import { cliOperationBindings } from "../operation-bindings.js";
import {
  ensureAddress,
  ensureDisputeListSort,
  ensureDisputeStatus,
  ensureNonEmpty,
  ensurePageLimit,
  ensureQueryOrder,
  ensureVoteChoice
} from "../validators.js";
import { resolveTextInput } from "../text-input.js";
import { executeBearerOperationCommand, executeOperationCommand } from "./shared.js";

export const registerDisputeCommands = (program: Command): void => {
  const disputes = program.command("disputes").description("Dispute and supervision commands");

  disputes
    .command("list")
    .description("List disputes")
    .option("--task <id>", "task id")
    .option("--opener <address>", "opener address")
    .option("--status <status>", "OPEN|RESOLVED_COMPLETED")
    .option("--q <text>", "search by ids/opener/dispute party reasons")
    .option("--sort <key>", "latest|created (default: latest)")
    .option("--order <order>", "asc|desc (default: desc)")
    .option("--cursor <offset>", "pagination cursor")
    .option("--limit <number>", "page size (1-100, default: 20)")
    .action(async (options, command: Command) => {
      await executeOperationCommand(command, cliOperationBindings["disputes list"], async () => ({
        query: {
          taskId: typeof options.task === "string" ? ensureNonEmpty(options.task, "--task") : undefined,
          opener: typeof options.opener === "string" ? ensureAddress(options.opener, "--opener") : undefined,
          status: typeof options.status === "string" ? ensureDisputeStatus(options.status) : undefined,
          q: typeof options.q === "string" ? ensureNonEmpty(options.q, "--q") : undefined,
          sort: typeof options.sort === "string" ? ensureDisputeListSort(options.sort) : undefined,
          order: typeof options.order === "string" ? ensureQueryOrder(options.order) : undefined,
          cursor: typeof options.cursor === "string" ? ensureNonEmpty(options.cursor, "--cursor") : undefined,
          limit: typeof options.limit === "string" ? ensurePageLimit(options.limit, "--limit") : undefined
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
    .description("Open a dispute (token required)")
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
    .command("respond")
    .description("Submit counterparty reason on an open dispute (token required)")
    .requiredOption("--dispute <id>", "dispute id")
    .option("--reason <markdown>", "reason markdown")
    .option("--reason-file <path>", "file containing dispute reason markdown")
    .action(async (options, command: Command) => {
      await executeBearerOperationCommand(command, cliOperationBindings["disputes respond"], async () => {
        const reasonMd = resolveTextInput({
          inlineValue: options.reason,
          filePath: options.reasonFile,
          fieldName: "reason"
        });
        return {
          pathParams: { id: ensureNonEmpty(String(options.dispute), "--dispute") },
          body: {
            reasonMd: String(reasonMd)
          }
        };
      });
    });

  disputes
    .command("vote")
    .description("Vote on a dispute (token required)")
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
