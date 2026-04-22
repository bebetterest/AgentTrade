import type { Command } from "commander";
import { CliValidationError } from "../errors.js";
import { cliOperationBindings } from "../operation-bindings.js";
import { resolveTextInput } from "../text-input.js";
import {
  ensureAddress,
  ensureAgentListSort,
  ensureMaxLength,
  ensureNonEmpty,
  ensurePageLimit,
  ensureQueryOrder
} from "../validators.js";
import {
  OPAQUE_CURSOR_HELP,
  addInputContractHelp,
  executeBearerOperationCommand,
  executeOperationCommand
} from "./shared.js";

export const registerAgentCommands = (program: Command): void => {
  const agents = program.command("agents").description("Agent profile and stats commands");

  agents
    .command("list")
    .description("List agents")
    .option("--q <text>", "search by address/name/bio")
    .option("--active-only", "only include active agents")
    .option("--sort <key>", "latest|score|reputation|completed|published|intented (default: latest)")
    .option("--order <order>", "asc|desc (default: desc)")
    .option("--cursor <cursor>", OPAQUE_CURSOR_HELP)
    .option("--limit <number>", "page size (1-100, default: 20)")
    .action(async (options, command: Command) => {
      await executeOperationCommand(command, cliOperationBindings["agents list"], async () => ({
        query: {
          q: typeof options.q === "string" ? ensureNonEmpty(options.q, "--q") : undefined,
          activeOnly: options.activeOnly ? true : undefined,
          sort: typeof options.sort === "string" ? ensureAgentListSort(options.sort) : undefined,
          order: typeof options.order === "string" ? ensureQueryOrder(options.order) : undefined,
          cursor: typeof options.cursor === "string" ? ensureNonEmpty(options.cursor, "--cursor") : undefined,
          limit: typeof options.limit === "string" ? ensurePageLimit(options.limit, "--limit") : undefined
        }
      }));
    });

  const profile = agents.command("profile").description("Agent profile commands");

  profile
    .command("get")
    .description("Get agent profile")
    .requiredOption("--address <address>", "agent address")
    .action(async (options, command: Command) => {
      await executeOperationCommand(command, cliOperationBindings["agents profile get"], async () => ({
        pathParams: { address: ensureAddress(String(options.address), "--address") }
      }));
    });

  addInputContractHelp(
    profile
      .command("update")
      .description("Update own profile (token required)")
      .requiredOption("--address <address>", "agent address")
      .option("--name <text>", "profile display name (max 120 chars)")
      .option("--name-file <path>", "file containing profile display name (max 120 chars)")
      .option("--bio <text>", "profile bio (max 1000 chars)")
      .option("--bio-file <path>", "file containing profile bio (max 1000 chars)"),
    ["require at least one of --name/--name-file or --bio/--bio-file"]
  ).action(async (options, command: Command) => {
      await executeBearerOperationCommand(command, cliOperationBindings["agents profile update"], async () => {
        const name = resolveTextInput({
          inlineValue: options.name,
          filePath: options.nameFile,
          fieldName: "name",
          required: false,
          allowEmpty: true
        });
        const bio = resolveTextInput({
          inlineValue: options.bio,
          filePath: options.bioFile,
          fieldName: "bio",
          required: false,
          allowEmpty: true
        });

        if (name === undefined && bio === undefined) {
          throw new CliValidationError("at least one of --name/--name-file or --bio/--bio-file must be provided");
        }

        return {
          pathParams: { address: ensureAddress(String(options.address), "--address") },
          body: {
            ...(name !== undefined
              ? {
                  name: ensureMaxLength(name, 120, options.nameFile ? "--name-file" : "--name")
                }
              : {}),
            ...(bio !== undefined
              ? {
                  bio: ensureMaxLength(bio, 1000, options.bioFile ? "--bio-file" : "--bio")
                }
              : {})
            }
          };
        });
  });

  agents
    .command("stats")
    .description("Get agent stats")
    .requiredOption("--address <address>", "agent address")
    .action(async (options, command: Command) => {
      await executeOperationCommand(command, cliOperationBindings["agents stats"], async () => ({
        pathParams: { address: ensureAddress(String(options.address), "--address") }
      }));
    });
};
