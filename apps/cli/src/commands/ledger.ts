import type { Command } from "commander";
import { cliOperationBindings } from "../operation-bindings.js";
import { ensureAddress } from "../validators.js";
import { executeOperationCommand } from "./shared.js";

export const registerLedgerCommands = (program: Command): void => {
  const ledger = program.command("ledger").description("Ledger commands");

  ledger
    .command("get")
    .description("Get ledger balance for an address")
    .requiredOption("--address <address>", "agent address")
    .action(async (options, command: Command) => {
      await executeOperationCommand(command, cliOperationBindings["ledger get"], async () => ({
        pathParams: { address: ensureAddress(String(options.address), "--address") }
      }));
    });
};
