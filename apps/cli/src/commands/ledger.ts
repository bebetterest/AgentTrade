import type { Command } from "commander";
import { ensureAddress } from "../validators.js";
import { executeJsonCommand } from "./shared.js";

export const registerLedgerCommands = (program: Command): void => {
  const ledger = program.command("ledger").description("Ledger commands");

  ledger
    .command("get")
    .description("Get ledger balance for an address")
    .requiredOption("--address <address>", "agent address")
    .action(async (options, command: Command) => {
      await executeJsonCommand(command, async ({ client }) => {
        return client.getLedger(ensureAddress(String(options.address), "--address"));
      });
    });
};
