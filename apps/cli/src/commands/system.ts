import type { Command } from "commander";
import { cliOperationBindings } from "../operation-bindings.js";
import {
  ensureNonEmpty,
  ensurePositiveInteger,
  ensureRuntimeSettingsApplyTo,
  ensureRuntimeSettingsPatchJson
} from "../validators.js";
import { executeAdminOperationCommand, executeOperationCommand } from "./shared.js";

export const registerSystemCommands = (program: Command): void => {
  const system = program.command("system").description("System and service commands");

  system.command("health").description("Get API health status").action(async (_options, command: Command) => {
    await executeOperationCommand(command, cliOperationBindings["system health"]);
  });

  system.command("metrics").description("Get API metrics (admin key required)").action(async (_options, command: Command) => {
    await executeAdminOperationCommand(command, cliOperationBindings["system metrics"]);
  });

  const settings = system.command("settings").description("Runtime settings commands");
  settings.command("get").description("Get runtime settings").action(async (_options, command: Command) => {
    await executeAdminOperationCommand(command, cliOperationBindings["system settings get"]);
  });
  settings
    .command("update")
    .description("Update runtime settings patch")
    .requiredOption("--apply-to <target>", "current or next")
    .requiredOption("--patch-json <json>", "JSON patch object with editable runtime rule fields")
    .option("--reason <reason>", "optional update reason")
    .action(async (options, command: Command) => {
      await executeAdminOperationCommand(
        command,
        cliOperationBindings["system settings update"],
        async () => ({
          body: {
            applyTo: ensureRuntimeSettingsApplyTo(String(options.applyTo), "--apply-to"),
            patch: ensureRuntimeSettingsPatchJson(String(options.patchJson), "--patch-json"),
            ...(options.reason ? { reason: ensureNonEmpty(String(options.reason), "--reason") } : {})
          }
        })
      );
    });
  settings
    .command("reset")
    .description("Reset runtime settings to environment defaults")
    .requiredOption("--apply-to <target>", "current or next")
    .option("--reason <reason>", "optional reset reason")
    .action(async (options, command: Command) => {
      await executeAdminOperationCommand(
        command,
        cliOperationBindings["system settings reset"],
        async () => ({
          body: {
            applyTo: ensureRuntimeSettingsApplyTo(String(options.applyTo), "--apply-to"),
            ...(options.reason ? { reason: ensureNonEmpty(String(options.reason), "--reason") } : {})
          }
        })
      );
    });
  settings
    .command("history")
    .description("List runtime settings audit history")
    .option("--cursor <cursor>", "pagination cursor")
    .option("--limit <n>", "page size (1-100)")
    .action(async (options, command: Command) => {
      await executeAdminOperationCommand(
        command,
        cliOperationBindings["system settings history"],
        async () => ({
          query: {
            ...(options.cursor ? { cursor: ensureNonEmpty(String(options.cursor), "--cursor") } : {}),
            ...(options.limit ? { limit: ensurePositiveInteger(String(options.limit), "--limit") } : {})
          }
        })
      );
    });
};
