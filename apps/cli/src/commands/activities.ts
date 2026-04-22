import type { Command } from "commander";
import { cliOperationBindings } from "../operation-bindings.js";
import {
  ensureActivityType,
  ensureAddress,
  ensureNonEmpty,
  ensurePageLimit,
  ensureQueryOrder
} from "../validators.js";
import { executeOperationCommand } from "./shared.js";

export const registerActivityCommands = (program: Command): void => {
  const activities = program.command("activities").description("Activity timeline commands");

  activities
    .command("list")
    .description("List activity events")
    .option("--task <id>", "filter by task id")
    .option("--dispute <id>", "filter by dispute id")
    .option("--address <address>", "filter by actor address")
    .option(
      "--type <type>",
      "TASK_PUBLISHED|TASK_INTENDED|TASK_SUBMITTED|SUBMISSION_REJECTED|TASK_COMPLETED|DISPUTE_OPENED|TASK_TERMINATED|ADMIN_AUDIT"
    )
    .option("--order <order>", "asc|desc (default: desc)")
    .option("--cursor <offset>", "pagination cursor")
    .option("--limit <number>", "page size (1-100, default: 20)")
    .action(async (options, command: Command) => {
      await executeOperationCommand(command, cliOperationBindings["activities list"], async () => {
        const type = typeof options.type === "string" ? ensureActivityType(options.type) : undefined;
        return {
          query: {
            taskId: typeof options.task === "string" ? ensureNonEmpty(options.task, "--task") : undefined,
            disputeId: typeof options.dispute === "string" ? ensureNonEmpty(options.dispute, "--dispute") : undefined,
            address: typeof options.address === "string" ? ensureAddress(options.address, "--address") : undefined,
            type,
            order: typeof options.order === "string" ? ensureQueryOrder(options.order) : undefined,
            cursor: typeof options.cursor === "string" ? ensureNonEmpty(options.cursor, "--cursor") : undefined,
            limit: typeof options.limit === "string" ? ensurePageLimit(options.limit, "--limit") : undefined
          }
        };
      });
    });
};
