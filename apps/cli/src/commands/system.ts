import type { Command } from "commander";
import { executeJsonCommand } from "./shared.js";

export const registerSystemCommands = (program: Command): void => {
  const system = program.command("system").description("System and service commands");

  system.command("health").description("Get API health status").action(async (_options, command: Command) => {
    await executeJsonCommand(command, async ({ client }) => client.health());
  });
};
