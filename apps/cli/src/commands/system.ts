import type { Command } from "commander";
import { cliOperationBindings } from "../operation-bindings.js";
import { resolveFileBackedInput } from "../text-input.js";
import {
  ensureNonEmpty,
  ensurePageLimit,
  ensureRuntimeSettingsApplyTo,
  ensureRuntimeSettingsPatchJson,
  ensureTrimmedNonEmptyMaxLength
} from "../validators.js";
import {
  executeAdminOperationCommand,
  OPAQUE_CURSOR_HELP,
  addInputContractHelp,
  executeBearerOperationCommand,
  executeOperationCommand
} from "./shared.js";

export const registerSystemCommands = (program: Command): void => {
  const system = program.command("system").description("System and service commands");

  system.command("health").description("Get API health status").action(async (_options, command: Command) => {
    await executeOperationCommand(command, cliOperationBindings["system health"]);
  });

  system.command("metrics").description("Get API metrics (token required)").action(async (_options, command: Command) => {
    await executeBearerOperationCommand(command, cliOperationBindings["system metrics"]);
  });

  const settings = system.command("settings").description("Runtime settings commands");
  settings.command("get").description("Get runtime settings (token required)").action(async (_options, command: Command) => {
    await executeBearerOperationCommand(command, cliOperationBindings["system settings get"]);
  });
  addInputContractHelp(
    settings
      .command("update")
      .description("Update runtime settings patch (token + admin key required)")
      .requiredOption("--apply-to <target>", "current or next")
      .option("--patch-json <json>", "JSON patch object with editable runtime rule fields")
      .option("--patch-file <path>", "file containing runtime settings patch JSON")
      .option("--reason <reason>", "optional update reason (max 1000 chars)"),
    ["require one of --patch-json / --patch-file"]
  ).action(async (options, command: Command) => {
      const patchInput = resolveFileBackedInput({
        inlineValue: options.patchJson,
        filePath: options.patchFile,
        inlineFlag: "patch-json",
        fileFlag: "patch-file",
        normalize: (value) => value.replace(/^\uFEFF/, "")
      });

      await executeAdminOperationCommand(
        command,
        cliOperationBindings["system settings update"],
        async () => ({
          body: {
            applyTo: ensureRuntimeSettingsApplyTo(String(options.applyTo), "--apply-to"),
            patch: ensureRuntimeSettingsPatchJson(
              patchInput,
              options.patchFile ? "--patch-file" : "--patch-json"
            ),
            ...(options.reason
              ? { reason: ensureTrimmedNonEmptyMaxLength(String(options.reason), 1000, "--reason") }
              : {})
          }
        })
      );
  });
  settings
    .command("reset")
    .description("Reset runtime settings to environment defaults (token + admin key required)")
    .requiredOption("--apply-to <target>", "current or next")
    .option("--reason <reason>", "optional reset reason (max 1000 chars)")
    .action(async (options, command: Command) => {
      await executeAdminOperationCommand(
        command,
        cliOperationBindings["system settings reset"],
        async () => ({
          body: {
            applyTo: ensureRuntimeSettingsApplyTo(String(options.applyTo), "--apply-to"),
            ...(options.reason
              ? { reason: ensureTrimmedNonEmptyMaxLength(String(options.reason), 1000, "--reason") }
              : {})
          }
        })
      );
    });
  settings
    .command("history")
    .description("List runtime settings audit history (token required)")
    .option("--cursor <cursor>", OPAQUE_CURSOR_HELP)
    .option("--limit <n>", "page size (1-100, default: 20)")
    .action(async (options, command: Command) => {
      await executeBearerOperationCommand(
        command,
        cliOperationBindings["system settings history"],
        async () => ({
          query: {
            ...(options.cursor ? { cursor: ensureNonEmpty(String(options.cursor), "--cursor") } : {}),
            ...(options.limit ? { limit: ensurePageLimit(String(options.limit), "--limit") } : {})
          }
        })
      );
    });
};
