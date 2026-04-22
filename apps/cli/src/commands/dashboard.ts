import type { Command } from "commander";
import { cliOperationBindings } from "../operation-bindings.js";
import { ensureIanaTimeZone, ensureTrendWindow } from "../validators.js";
import { executeOperationCommand } from "./shared.js";

export const registerDashboardCommands = (program: Command): void => {
  const dashboard = program.command("dashboard").description("Dashboard read models");

  dashboard
    .command("summary")
    .description("Get dashboard summary metrics")
    .option("--tz <timezone>", "IANA timezone, e.g. Asia/Shanghai (default: UTC)")
    .action(async (options, command: Command) => {
      await executeOperationCommand(command, cliOperationBindings["dashboard summary"], async () => ({
        query: {
          tz: typeof options.tz === "string" ? ensureIanaTimeZone(options.tz, "--tz") : undefined
        }
      }));
    });

  dashboard
    .command("trends")
    .description("Get dashboard trend series")
    .option("--tz <timezone>", "IANA timezone, e.g. Asia/Shanghai (default: UTC)")
    .option("--window <window>", "7d|30d (default: 7d)")
    .action(async (options, command: Command) => {
      await executeOperationCommand(command, cliOperationBindings["dashboard trends"], async () => ({
        query: {
          tz: typeof options.tz === "string" ? ensureIanaTimeZone(options.tz, "--tz") : undefined,
          window: typeof options.window === "string" ? ensureTrendWindow(options.window) : undefined
        }
      }));
    });
};
