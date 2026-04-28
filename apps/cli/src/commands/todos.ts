import type { Command } from "commander";
import {
  TODO_ACTION_REQUIRED_TYPES,
  TODO_WAITING_TYPES,
  type Address,
  type TodoScope
} from "@agentrade/types";
import { loadCliPersistedConfig } from "../cli-config.js";
import { cliOperationBindings } from "../operation-bindings.js";
import { CliConfigError, CliValidationError } from "../errors.js";
import { ensureAddress, ensurePageLimit, ensureTodoGroupType } from "../validators.js";
import { OPAQUE_CURSOR_HELP, addInputContractHelp, executeOperationCommand } from "./shared.js";

interface TodoCommandOptions {
  address?: string;
  type?: string;
  limit?: string;
  cursor?: string;
}

const resolveTodoAddress = (rawAddress: unknown): Address => {
  if (typeof rawAddress === "string") {
    return ensureAddress(rawAddress, "--address");
  }

  const persistedAddress = loadCliPersistedConfig().values.walletAddress;
  if (!persistedAddress) {
    throw new CliConfigError(
      "missing wallet address: use --address or `agentrade config set wallet-address <address>` before running todos"
    );
  }
  return ensureAddress(persistedAddress, "persisted wallet-address");
};

const buildTodosRequest = (
  scope: TodoScope,
  options: TodoCommandOptions
) => {
  const type =
    typeof options.type === "string"
      ? ensureTodoGroupType(options.type, scope === "all" ? "all" : scope)
      : undefined;
  if (typeof options.cursor === "string" && !type) {
    throw new CliValidationError("--cursor requires --type");
  }

  return {
    pathParams: {
      address: resolveTodoAddress(options.address)
    },
    query: {
      scope,
      type,
      cursor: typeof options.cursor === "string" ? options.cursor : undefined,
      limit: typeof options.limit === "string" ? ensurePageLimit(options.limit) : undefined
    }
  };
};

const readTodoOptions = (command: Command): TodoCommandOptions =>
  command.optsWithGlobals() as TodoCommandOptions;

const applyTodoOptions = (command: Command, extraInputContractLines: readonly string[] = []): Command =>
  addInputContractHelp(
    command
      .option("--address <address>", "target account address; defaults to persisted wallet-address")
      .option("--type <type>", "stable todo group type filter")
      .option("--limit <number>", "per-group page size (default: 20)")
      .option("--cursor <cursor>", OPAQUE_CURSOR_HELP),
    [
      "--address is optional; when omitted, the CLI uses persisted wallet-address from local config",
      "--cursor requires --type because each cursor only pages one todo group",
      ...extraInputContractLines
    ]
  );

export const registerTodoCommands = (program: Command): void => {
  const todos = applyTodoOptions(program.command("todos").description("Get grouped account todos"));

  todos.action(async (_options: TodoCommandOptions, command: Command) => {
    await executeOperationCommand(command, cliOperationBindings.todos, async () =>
      buildTodosRequest("all", readTodoOptions(command))
    );
  });

  applyTodoOptions(
    todos.command("action-required").description("List action-required todo groups"),
    [
      `--type, when provided, must be one of: ${TODO_ACTION_REQUIRED_TYPES.join(", ")}`
    ]
  ).action(async (_options: TodoCommandOptions, command: Command) => {
    await executeOperationCommand(command, cliOperationBindings["todos action-required"], async () =>
      buildTodosRequest("action_required", readTodoOptions(command))
    );
  });

  applyTodoOptions(todos.command("waiting").description("List waiting todo groups"), [
    `--type, when provided, must be one of: ${TODO_WAITING_TYPES.join(", ")}`
  ]).action(async (_options: TodoCommandOptions, command: Command) => {
    await executeOperationCommand(command, cliOperationBindings["todos waiting"], async () =>
      buildTodosRequest("waiting", readTodoOptions(command))
    );
  });
};
