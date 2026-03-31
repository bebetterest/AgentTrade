import type { Command } from "commander";
import { CliValidationError } from "../errors.js";
import { resolveTextInput } from "../text-input.js";
import { ensureAddress, ensureNonEmpty, ensurePositiveInteger } from "../validators.js";
import { executeBearerJsonCommand, executeJsonCommand } from "./shared.js";

export const registerAgentCommands = (program: Command): void => {
  const agents = program.command("agents").description("Agent profile and stats commands");

  agents
    .command("list")
    .description("List agents")
    .option("--q <text>", "search by address/name/bio")
    .option("--active-only", "only include active agents")
    .option("--sort <key>", "latest|score|reputation|completed|published|accepted")
    .option("--order <order>", "asc|desc")
    .option("--cursor <offset>", "pagination cursor")
    .option("--limit <number>", "page size")
    .action(async (options, command: Command) => {
      await executeJsonCommand(command, async ({ client }) =>
        client.getAgents({
          q: typeof options.q === "string" ? ensureNonEmpty(options.q, "--q") : undefined,
          activeOnly: options.activeOnly ? true : undefined,
          sort: typeof options.sort === "string"
            ? options.sort.trim().toLowerCase() as
                | "latest"
                | "score"
                | "reputation"
                | "completed"
                | "published"
                | "accepted"
            : undefined,
          order: typeof options.order === "string"
            ? options.order.trim().toLowerCase() as "asc" | "desc"
            : undefined,
          cursor: typeof options.cursor === "string" ? ensureNonEmpty(options.cursor, "--cursor") : undefined,
          limit: typeof options.limit === "string" ? ensurePositiveInteger(options.limit, "--limit") : undefined
        })
      );
    });

  const profile = agents.command("profile").description("Agent profile commands");

  profile
    .command("get")
    .description("Get agent profile")
    .requiredOption("--address <address>", "agent address")
    .action(async (options, command: Command) => {
      await executeJsonCommand(command, async ({ client }) => {
        return client.getAgentProfile(ensureAddress(String(options.address), "--address"));
      });
    });

  profile
    .command("update")
    .description("Update own profile")
    .requiredOption("--address <address>", "agent address")
    .option("--name <text>", "profile display name")
    .option("--name-file <path>", "file containing profile display name")
    .option("--bio <text>", "profile bio")
    .option("--bio-file <path>", "file containing profile bio")
    .action(async (options, command: Command) => {
      await executeBearerJsonCommand(command, async ({ client }) => {
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

        return client.updateAgentProfile(ensureAddress(String(options.address), "--address"), {
          ...(name !== undefined ? { name } : {}),
          ...(bio !== undefined ? { bio } : {})
        });
      });
    });

  agents
    .command("stats")
    .description("Get agent stats")
    .requiredOption("--address <address>", "agent address")
    .action(async (options, command: Command) => {
      await executeJsonCommand(command, async ({ client }) => {
        return client.getAgentStats(ensureAddress(String(options.address), "--address"));
      });
    });
};
