import type { Command } from "commander";
import type { Dispute } from "@agentrade/types";
import { ensureAddress, ensureNonEmpty, ensurePositiveInteger, ensureVoteChoice } from "../validators.js";
import { resolveTextInput } from "../text-input.js";
import { executeBearerJsonCommand, executeJsonCommand } from "./shared.js";

export const registerDisputeCommands = (program: Command): void => {
  const disputes = program.command("disputes").description("Dispute and supervision commands");

  disputes
    .command("list")
    .description("List disputes")
    .option("--task <id>", "task id")
    .option("--opener <address>", "opener address")
    .option("--status <status>", "OPEN|RESOLVED_COMPLETED|RESOLVED_NOT_COMPLETED")
    .option("--q <text>", "search by ids/opener")
    .option("--sort <key>", "latest|created")
    .option("--order <order>", "asc|desc")
    .option("--cursor <offset>", "pagination cursor")
    .option("--limit <number>", "page size")
    .action(async (options, command: Command) => {
      await executeJsonCommand(command, async ({ client }) =>
        client.getDisputes({
          taskId: typeof options.task === "string" ? ensureNonEmpty(options.task, "--task") : undefined,
          opener: typeof options.opener === "string" ? ensureAddress(options.opener, "--opener") : undefined,
          status: typeof options.status === "string" ? options.status.trim().toUpperCase() as Dispute["status"] : undefined,
          q: typeof options.q === "string" ? ensureNonEmpty(options.q, "--q") : undefined,
          sort: typeof options.sort === "string" ? options.sort.trim().toLowerCase() as "latest" | "created" : undefined,
          order: typeof options.order === "string" ? options.order.trim().toLowerCase() as "asc" | "desc" : undefined,
          cursor: typeof options.cursor === "string" ? ensureNonEmpty(options.cursor, "--cursor") : undefined,
          limit: typeof options.limit === "string" ? ensurePositiveInteger(options.limit, "--limit") : undefined
        })
      );
    });

  disputes
    .command("get")
    .description("Get dispute details")
    .requiredOption("--dispute <id>", "dispute id")
    .action(async (options, command: Command) => {
      await executeJsonCommand(command, async ({ client }) => {
        return client.getDispute(ensureNonEmpty(String(options.dispute), "--dispute"));
      });
    });

  disputes
    .command("open")
    .description("Open a dispute")
    .requiredOption("--task <id>", "task id")
    .requiredOption("--submission <id>", "submission id")
    .option("--reason <markdown>", "reason markdown")
    .option("--reason-file <path>", "file containing dispute reason markdown")
    .action(async (options, command: Command) => {
      await executeBearerJsonCommand(command, async ({ client }) => {
        const reasonMd = resolveTextInput({
          inlineValue: options.reason,
          filePath: options.reasonFile,
          fieldName: "reason"
        });
        return client.openDispute({
          taskId: ensureNonEmpty(String(options.task), "--task"),
          submissionId: ensureNonEmpty(String(options.submission), "--submission"),
          reasonMd: String(reasonMd)
        });
      });
    });

  disputes
    .command("vote")
    .description("Vote on a dispute")
    .requiredOption("--dispute <id>", "dispute id")
    .requiredOption("--vote <choice>", "COMPLETED or NOT_COMPLETED")
    .action(async (options, command: Command) => {
      await executeBearerJsonCommand(command, async ({ client }) => {
        return client.voteDispute(ensureNonEmpty(String(options.dispute), "--dispute"), {
          vote: ensureVoteChoice(String(options.vote))
        });
      });
    });
};
