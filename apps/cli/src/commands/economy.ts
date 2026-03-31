import type { Command } from "commander";
import { executeJsonCommand } from "./shared.js";

export const registerEconomyCommands = (program: Command): void => {
  const economy = program.command("economy").description("Runtime economy parameters");

  economy.command("params").description("Get economy and guardrail parameters").action(async (_options, command: Command) => {
    await executeJsonCommand(command, async ({ client }) => client.getEconomyParams());
  });
};
