import type { Command } from "commander";
import { cliOperationBindings } from "../operation-bindings.js";
import { executeOperationCommand } from "./shared.js";

export const registerEconomyCommands = (program: Command): void => {
  const economy = program.command("economy").description("Runtime economy parameters");

  economy.command("params").description("Get economy and guardrail parameters").action(async (_options, command: Command) => {
    await executeOperationCommand(command, cliOperationBindings["economy params"]);
  });
};
