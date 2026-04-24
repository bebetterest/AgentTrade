import type { Command } from "commander";
import type { ApiOperationId } from "@agentrade/contracts";
import type { CommandContext } from "../context.js";
import { setInputContractLines } from "../command-metadata.js";
import { createCommandContext } from "../context.js";
import { printSuccessJson, withSuccessMeta, type StructuredCliWarning } from "../output.js";
import type { OperationRequestOptions } from "@agentrade/sdk";

type JsonHandler<T = unknown> = (ctx: CommandContext) => Promise<T>;
type OperationInputBuilder = (ctx: CommandContext) => Promise<OperationRequestOptions> | OperationRequestOptions;

export const OPAQUE_CURSOR_HELP = "opaque pagination cursor returned by previous nextCursor";

const enrichErrorWithCommandPath = (error: unknown, commandPath: string): void => {
  if (!error || typeof error !== "object") {
    return;
  }
  const enriched = error as { commandPath?: string };
  if (!enriched.commandPath) {
    enriched.commandPath = commandPath;
  }
};

export const addInputContractHelp = (command: Command, lines: readonly string[]): Command => {
  if (lines.length === 0) {
    return command;
  }

  setInputContractLines(command, lines);
  command.addHelpText(
    "after",
    `Input contract:
${lines.map((line) => `  ${line}`).join("\n")}
`
  );
  return command;
};

export const executeJsonCommand = async (
  command: Command,
  handler: JsonHandler
): Promise<void> => {
  const ctx = createCommandContext(command);

  try {
    const result = await handler(ctx);
    printSuccessJson(result, ctx.options.pretty, ctx.commandPath);
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

export const executeOperationCommand = async (
  command: Command,
  operationId: ApiOperationId,
  buildInput?: OperationInputBuilder,
  successWarnings: StructuredCliWarning[] = []
): Promise<void> => {
  await executeJsonCommand(command, async (ctx) => {
    const input = buildInput ? await buildInput(ctx) : {};
    const result = await ctx.client.requestOperation(operationId, input);
    return successWarnings.length > 0 ? withSuccessMeta(result, successWarnings) : result;
  });
};

export const executeBearerOperationCommand = async (
  command: Command,
  operationId: ApiOperationId,
  buildInput?: OperationInputBuilder
): Promise<void> => {
  await executeJsonCommand(command, async (ctx) => {
    ctx.requireToken();
    const input = buildInput ? await buildInput(ctx) : {};
    return ctx.client.requestOperation(operationId, input);
  });
};

export const executeAdminOperationCommand = async (
  command: Command,
  operationId: ApiOperationId,
  buildInput?: OperationInputBuilder
): Promise<void> => {
  await executeJsonCommand(command, async (ctx) => {
    ctx.requireToken();
    ctx.requireAdminKey();
    const input = buildInput ? await buildInput(ctx) : {};
    return ctx.client.requestOperation(operationId, input);
  });
};
