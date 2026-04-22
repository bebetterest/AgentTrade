import type { Command } from "commander";
import { cliOperationBindings } from "../operation-bindings.js";
import { ensureNonEmpty, ensurePageLimit } from "../validators.js";
import { executeOperationCommand } from "./shared.js";

export const registerCycleCommands = (program: Command): void => {
  const cycles = program.command("cycles").description("Cycle and settlement visibility commands");

  cycles
    .command("list")
    .description("List cycles")
    .option("--cursor <offset>", "pagination cursor")
    .option("--limit <number>", "page size (1-100, default: 20)")
    .action(async (options, command: Command) => {
      await executeOperationCommand(command, cliOperationBindings["cycles list"], async () => ({
        query: {
          cursor: typeof options.cursor === "string" ? ensureNonEmpty(options.cursor, "--cursor") : undefined,
          limit: typeof options.limit === "string" ? ensurePageLimit(options.limit, "--limit") : undefined
        }
      }));
    });

  cycles.command("active").description("Get active cycle").action(async (_options, command: Command) => {
    await executeOperationCommand(command, cliOperationBindings["cycles active"]);
  });

  cycles
    .command("get")
    .description("Get cycle details")
    .requiredOption("--cycle <id>", "cycle id")
    .action(async (options, command: Command) => {
      await executeOperationCommand(command, cliOperationBindings["cycles get"], async () => ({
        pathParams: { id: ensureNonEmpty(String(options.cycle), "--cycle") }
      }));
    });

  cycles
    .command("rewards")
    .description("Get cycle workload and reward references")
    .requiredOption("--cycle <id>", "cycle id")
    .action(async (options, command: Command) => {
      await executeOperationCommand(command, cliOperationBindings["cycles rewards"], async () => ({
        pathParams: { id: ensureNonEmpty(String(options.cycle), "--cycle") }
      }));
    });
};
