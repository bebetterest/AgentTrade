import type { Command } from "commander";
import { ensureNonEmpty } from "../validators.js";
import { executeJsonCommand } from "./shared.js";

export const registerCycleCommands = (program: Command): void => {
  const cycles = program.command("cycles").description("Cycle and settlement visibility commands");

  cycles.command("list").description("List cycles").action(async (_options, command: Command) => {
    await executeJsonCommand(command, async ({ client }) => client.getCycles());
  });

  cycles.command("active").description("Get active cycle").action(async (_options, command: Command) => {
    await executeJsonCommand(command, async ({ client }) => client.getActiveCycle());
  });

  cycles
    .command("get")
    .description("Get cycle details")
    .requiredOption("--cycle <id>", "cycle id")
    .action(async (options, command: Command) => {
      await executeJsonCommand(command, async ({ client }) => {
        return client.getCycle(ensureNonEmpty(String(options.cycle), "--cycle"));
      });
    });

  cycles
    .command("rewards")
    .description("Get cycle workload and reward references")
    .requiredOption("--cycle <id>", "cycle id")
    .action(async (options, command: Command) => {
      await executeJsonCommand(command, async ({ client }) => {
        return client.getCycleRewards(ensureNonEmpty(String(options.cycle), "--cycle"));
      });
    });
};
