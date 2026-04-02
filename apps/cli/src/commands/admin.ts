import type { Command } from "commander";
import { cliOperationBindings } from "../operation-bindings.js";
import { resolveTextInput } from "../text-input.js";
import { ensureNonEmpty, ensureOverrideResult, parseOptionalAddressList } from "../validators.js";
import { executeAdminOperationCommand } from "./shared.js";

export const registerAdminCommands = (program: Command): void => {
  const admin = program.command("admin").description("Admin-only commands");

  const adminCycles = admin.command("cycles").description("Cycle admin commands");
  adminCycles.command("close").description("Close current cycle").action(async (_options, command: Command) => {
    await executeAdminOperationCommand(command, cliOperationBindings["admin cycles close"]);
  });

  const adminDisputes = admin.command("disputes").description("Dispute admin commands");
  adminDisputes
    .command("override")
    .description("Override dispute result")
    .requiredOption("--dispute <id>", "dispute id")
    .requiredOption("--result <result>", "COMPLETED or NOT_COMPLETED")
    .action(async (options, command: Command) => {
      await executeAdminOperationCommand(command, cliOperationBindings["admin disputes override"], async () => ({
        pathParams: { id: ensureNonEmpty(String(options.dispute), "--dispute") },
        body: {
          result: ensureOverrideResult(String(options.result))
        }
      }));
    });

  const adminBridge = admin.command("bridge").description("Bridge export commands");
  adminBridge
    .command("export")
    .description("Export bridge balances")
    .option("--addresses <list>", "comma or whitespace separated addresses")
    .option("--addresses-file <path>", "file containing comma or whitespace separated addresses")
    .action(async (options, command: Command) => {
      await executeAdminOperationCommand(command, cliOperationBindings["admin bridge export"], async () => {
        const rawAddresses = resolveTextInput({
          inlineValue: options.addresses,
          filePath: options.addressesFile,
          fieldName: "addresses",
          required: false,
          allowEmpty: true
        });
        const addresses = parseOptionalAddressList(rawAddresses, "--addresses");
        return {
          body: addresses ? { addresses } : {}
        };
      });
    });
};
