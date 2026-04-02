import type { Command } from "commander";
import { cliOperationBindings } from "../operation-bindings.js";
import { executeOperationCommand } from "./shared.js";

export const registerSystemCommands = (program: Command): void => {
  const system = program.command("system").description("System and service commands");

  system.command("health").description("Get API health status").action(async (_options, command: Command) => {
    await executeOperationCommand(command, cliOperationBindings["system health"]);
  });
};
