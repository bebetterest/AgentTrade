import type { Command } from "commander";
import { CliValidationError } from "../errors.js";
import { ensureIanaTimeZone } from "../validators.js";
import { executeJsonCommand } from "./shared.js";

const ensureTrendWindow = (raw: string): "7d" | "30d" => {
  const normalized = raw.trim().toLowerCase();
  if (normalized !== "7d" && normalized !== "30d") {
    throw new CliValidationError("--window must be 7d or 30d");
  }
  return normalized;
};

export const registerDashboardCommands = (program: Command): void => {
  const dashboard = program.command("dashboard").description("Dashboard read models");

  dashboard
    .command("summary")
    .description("Get dashboard summary metrics")
    .option("--tz <timezone>", "IANA timezone, e.g. Asia/Shanghai")
    .action(async (options, command: Command) => {
      await executeJsonCommand(command, async ({ client }) => {
        return client.getDashboardSummary({
          tz: typeof options.tz === "string" ? ensureIanaTimeZone(options.tz, "--tz") : undefined
        });
      });
    });

  dashboard
    .command("trends")
    .description("Get dashboard trend series")
    .option("--tz <timezone>", "IANA timezone, e.g. Asia/Shanghai")
    .option("--window <window>", "7d|30d")
    .action(async (options, command: Command) => {
      await executeJsonCommand(command, async ({ client }) => {
        return client.getDashboardTrends({
          tz: typeof options.tz === "string" ? ensureIanaTimeZone(options.tz, "--tz") : undefined,
          window: typeof options.window === "string" ? ensureTrendWindow(options.window) : undefined
        });
      });
    });
};
