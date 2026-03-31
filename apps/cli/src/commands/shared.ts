import type { Command } from "commander";
import type { CommandContext } from "../context.js";
import { createCommandContext } from "../context.js";
import { printJson } from "../output.js";

type JsonHandler<T = unknown> = (ctx: CommandContext) => Promise<T>;

const enrichErrorWithCommandPath = (error: unknown, commandPath: string): void => {
  if (!error || typeof error !== "object") {
    return;
  }
  const enriched = error as { commandPath?: string };
  if (!enriched.commandPath) {
    enriched.commandPath = commandPath;
  }
};

export const executeJsonCommand = async (
  command: Command,
  handler: JsonHandler
): Promise<void> => {
  const ctx = createCommandContext(command);

  try {
    const result = await handler(ctx);
    printJson(result, ctx.options.pretty);
  } catch (error) {
    enrichErrorWithCommandPath(error, ctx.commandPath);
    throw error;
  }
};

export const executeBearerJsonCommand = async (command: Command, handler: JsonHandler): Promise<void> => {
  await executeJsonCommand(command, async (ctx) => {
    ctx.requireToken();
    return handler(ctx);
  });
};

export const executeAdminJsonCommand = async (command: Command, handler: JsonHandler): Promise<void> => {
  await executeJsonCommand(command, async (ctx) => {
    ctx.requireAdminKey();
    return handler(ctx);
  });
};
