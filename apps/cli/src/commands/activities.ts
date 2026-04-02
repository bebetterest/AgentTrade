import type { Command } from "commander";
import { ActivityEventType } from "@agentrade/types";
import { CliValidationError } from "../errors.js";
import { cliOperationBindings } from "../operation-bindings.js";
import { ensureAddress, ensureNonEmpty, ensurePositiveInteger } from "../validators.js";
import { executeOperationCommand } from "./shared.js";

const ensureActivityType = (raw: string): ActivityEventType => {
  const normalized = raw.trim().toUpperCase();
  if (!Object.values(ActivityEventType).includes(normalized as ActivityEventType)) {
    throw new CliValidationError(
      "--type must be TASK_PUBLISHED|TASK_ACCEPTED|TASK_COMPLETED|DISPUTE_OPENED|TASK_TERMINATED"
    );
  }
  return normalized as ActivityEventType;
};

export const registerActivityCommands = (program: Command): void => {
  const activities = program.command("activities").description("Activity timeline commands");

  activities
    .command("list")
    .description("List activity events")
    .option("--task <id>", "filter by task id")
    .option("--dispute <id>", "filter by dispute id")
    .option("--address <address>", "filter by actor address")
    .option("--type <type>", "TASK_PUBLISHED|TASK_ACCEPTED|TASK_COMPLETED|DISPUTE_OPENED|TASK_TERMINATED")
    .option("--order <order>", "asc|desc")
    .option("--cursor <offset>", "pagination cursor")
    .option("--limit <number>", "page size")
    .action(async (options, command: Command) => {
      await executeOperationCommand(command, cliOperationBindings["activities list"], async () => {
        const type = typeof options.type === "string" ? ensureActivityType(options.type) : undefined;
        return {
          query: {
            taskId: typeof options.task === "string" ? ensureNonEmpty(options.task, "--task") : undefined,
            disputeId: typeof options.dispute === "string" ? ensureNonEmpty(options.dispute, "--dispute") : undefined,
            address: typeof options.address === "string" ? ensureAddress(options.address, "--address") : undefined,
            type,
            order: typeof options.order === "string" ? options.order.trim().toLowerCase() as "asc" | "desc" : undefined,
            cursor: typeof options.cursor === "string" ? ensureNonEmpty(options.cursor, "--cursor") : undefined,
            limit: typeof options.limit === "string" ? ensurePositiveInteger(options.limit, "--limit") : undefined
          }
        };
      });
    });
};
