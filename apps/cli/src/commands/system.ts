import type { Command } from "commander";
import { cliOperationBindings } from "../operation-bindings.js";
import { resolveFileBackedInput, resolveTextInput } from "../text-input.js";
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

  const logs = system.command("logs").description("Server log query commands");
  logs
    .command("requests")
    .description("List server request logs (token + admin key required)")
    .option("--cursor <cursor>", OPAQUE_CURSOR_HELP)
    .option("--limit <n>", "page size (1-100, default: 20)")
    .option("--from <iso>", "inclusive start time (ISO datetime)")
    .option("--to <iso>", "inclusive end time (ISO datetime)")
    .option("--request-id <id>", "request id filter")
    .option("--actor <address>", "actor address filter")
    .option("--ip <ip>", "client IP filter")
    .option("--method <method>", "HTTP method filter")
    .option("--route-id <route>", "route id filter")
    .option("--status <code>", "HTTP status code filter")
    .action(async (options, command: Command) => {
      await executeAdminOperationCommand(
        command,
        cliOperationBindings["system logs requests"],
        async () => ({
          query: {
            ...(options.cursor ? { cursor: ensureNonEmpty(String(options.cursor), "--cursor") } : {}),
            ...(options.limit ? { limit: ensurePageLimit(String(options.limit), "--limit") } : {}),
            ...(options.from ? { from: ensureNonEmpty(String(options.from), "--from") } : {}),
            ...(options.to ? { to: ensureNonEmpty(String(options.to), "--to") } : {}),
            ...(options.requestId
              ? { requestId: ensureNonEmpty(String(options.requestId), "--request-id") }
              : {}),
            ...(options.actor ? { actor: ensureNonEmpty(String(options.actor), "--actor") } : {}),
            ...(options.ip ? { ip: ensureNonEmpty(String(options.ip), "--ip") } : {}),
            ...(options.method ? { method: ensureNonEmpty(String(options.method), "--method") } : {}),
            ...(options.routeId
              ? { routeId: ensureNonEmpty(String(options.routeId), "--route-id") }
              : {}),
            ...(options.status ? { status: Number(ensureNonEmpty(String(options.status), "--status")) } : {})
          }
        })
      );
    });

  logs
    .command("audits")
    .description("List server audit logs (token + admin key required)")
    .option("--cursor <cursor>", OPAQUE_CURSOR_HELP)
    .option("--limit <n>", "page size (1-100, default: 20)")
    .option("--from <iso>", "inclusive start time (ISO datetime)")
    .option("--to <iso>", "inclusive end time (ISO datetime)")
    .option("--request-id <id>", "request id filter")
    .option("--actor <address>", "actor address filter")
    .option("--ip <ip>", "client IP filter")
    .option(
      "--category <category>",
      "audit category: RUNTIME | AUTH | SECURITY | ADMIN | DOMAIN_WRITE | BACKGROUND_JOB"
    )
    .option("--action <action>", "audit action filter")
    .option("--outcome <outcome>", "audit outcome: SUCCESS | FAILURE | REJECTED")
    .action(async (options, command: Command) => {
      await executeAdminOperationCommand(
        command,
        cliOperationBindings["system logs audits"],
        async () => ({
          query: {
            ...(options.cursor ? { cursor: ensureNonEmpty(String(options.cursor), "--cursor") } : {}),
            ...(options.limit ? { limit: ensurePageLimit(String(options.limit), "--limit") } : {}),
            ...(options.from ? { from: ensureNonEmpty(String(options.from), "--from") } : {}),
            ...(options.to ? { to: ensureNonEmpty(String(options.to), "--to") } : {}),
            ...(options.requestId
              ? { requestId: ensureNonEmpty(String(options.requestId), "--request-id") }
              : {}),
            ...(options.actor ? { actor: ensureNonEmpty(String(options.actor), "--actor") } : {}),
            ...(options.ip ? { ip: ensureNonEmpty(String(options.ip), "--ip") } : {}),
            ...(options.category
              ? { category: ensureNonEmpty(String(options.category), "--category") }
              : {}),
            ...(options.action ? { action: ensureNonEmpty(String(options.action), "--action") } : {}),
            ...(options.outcome
              ? { outcome: ensureNonEmpty(String(options.outcome), "--outcome") }
              : {})
          }
        })
      );
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
      .option("--reason <reason>", "optional update reason (max 1000 chars)")
      .option("--reason-file <path>", "file containing optional update reason (max 1000 chars)"),
    ["require one of --patch-json / --patch-file", "--reason and --reason-file are mutually exclusive"]
  ).action(async (options, command: Command) => {
    await executeAdminOperationCommand(
      command,
      cliOperationBindings["system settings update"],
      async () => {
        const patchInput = resolveFileBackedInput({
          inlineValue: options.patchJson,
          filePath: options.patchFile,
          inlineFlag: "patch-json",
          fileFlag: "patch-file",
          normalize: (value) => value.replace(/^\uFEFF/, "")
        });
        const reasonInput = resolveTextInput({
          inlineValue: options.reason,
          filePath: options.reasonFile,
          fieldName: "reason",
          required: false
        });

        return {
          body: {
            applyTo: ensureRuntimeSettingsApplyTo(String(options.applyTo), "--apply-to"),
            patch: ensureRuntimeSettingsPatchJson(
              patchInput,
              options.patchFile ? "--patch-file" : "--patch-json"
            ),
            ...(reasonInput
              ? {
                  reason: ensureTrimmedNonEmptyMaxLength(
                    reasonInput,
                    1000,
                    options.reasonFile ? "--reason-file" : "--reason"
                  )
                }
              : {})
          }
        };
      }
    );
  });
  addInputContractHelp(
    settings
      .command("reset")
      .description("Reset runtime settings to environment defaults (token + admin key required)")
      .requiredOption("--apply-to <target>", "current or next")
      .option("--reason <reason>", "optional reset reason (max 1000 chars)")
      .option("--reason-file <path>", "file containing optional reset reason (max 1000 chars)"),
    ["--reason and --reason-file are mutually exclusive"]
  ).action(async (options, command: Command) => {
    await executeAdminOperationCommand(
      command,
      cliOperationBindings["system settings reset"],
      async () => {
        const reasonInput = resolveTextInput({
          inlineValue: options.reason,
          filePath: options.reasonFile,
          fieldName: "reason",
          required: false
        });

        return {
          body: {
            applyTo: ensureRuntimeSettingsApplyTo(String(options.applyTo), "--apply-to"),
            ...(reasonInput
              ? {
                  reason: ensureTrimmedNonEmptyMaxLength(
                    reasonInput,
                    1000,
                    options.reasonFile ? "--reason-file" : "--reason"
                  )
                }
              : {})
          }
        };
      }
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
