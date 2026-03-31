import type { Command } from "commander";
import type { Task } from "@agentrade/types";
import {
  ensureAddress,
  ensureIanaTimeZone,
  ensureIsoDate,
  ensureNonEmpty,
  ensurePositiveInteger
} from "../validators.js";
import { resolveTextInput } from "../text-input.js";
import { executeBearerJsonCommand, executeJsonCommand } from "./shared.js";

export const registerTaskCommands = (program: Command): void => {
  const tasks = program.command("tasks").description("Task lifecycle commands");

  tasks
    .command("list")
    .description("List tasks")
    .option("--q <text>", "search by id/title/publisher")
    .option("--status <status>", "OPEN|IN_PROGRESS|TERMINATED|CLOSED")
    .option("--publisher <address>", "publisher address")
    .option("--sort <key>", "latest|created|deadline|reward")
    .option("--order <order>", "asc|desc")
    .option("--cursor <offset>", "pagination cursor")
    .option("--limit <number>", "page size")
    .action(async (options, command: Command) => {
      await executeJsonCommand(command, async ({ client }) => {
        return client.getTasks({
          q: typeof options.q === "string" ? ensureNonEmpty(options.q, "--q") : undefined,
          status: typeof options.status === "string" ? options.status.trim().toUpperCase() as Task["status"] : undefined,
          publisher: typeof options.publisher === "string" ? ensureAddress(options.publisher, "--publisher") : undefined,
          sort: typeof options.sort === "string" ? options.sort.trim().toLowerCase() as "latest" | "created" | "deadline" | "reward" : undefined,
          order: typeof options.order === "string" ? options.order.trim().toLowerCase() as "asc" | "desc" : undefined,
          cursor: typeof options.cursor === "string" ? ensureNonEmpty(options.cursor, "--cursor") : undefined,
          limit: typeof options.limit === "string" ? ensurePositiveInteger(options.limit, "--limit") : undefined
        });
      });
    });

  tasks
    .command("get")
    .description("Get task details")
    .requiredOption("--task <id>", "task id")
    .action(async (options, command: Command) => {
      await executeJsonCommand(command, async ({ client }) => {
        const taskId = ensureNonEmpty(String(options.task), "--task");
        return client.getTask(taskId);
      });
    });

  tasks
    .command("create")
    .description("Create a task")
    .requiredOption("--title <title>", "task title")
    .option("--desc <markdown>", "task description markdown")
    .option("--desc-file <path>", "file containing task description markdown")
    .option("--criteria <markdown>", "task acceptance criteria markdown")
    .option("--criteria-file <path>", "file containing task acceptance criteria markdown")
    .requiredOption("--deadline <iso>", "deadline in ISO datetime format")
    .requiredOption("--tz <timezone>", "display timezone")
    .requiredOption("--slots <number>", "slot count")
    .requiredOption("--reward <number>", "reward per slot")
    .option("--allow-repeat", "allow repeat completions by same agent")
    .action(async (options, command: Command) => {
      await executeBearerJsonCommand(command, async ({ client }) => {
        const descriptionMd = resolveTextInput({
          inlineValue: options.desc,
          filePath: options.descFile,
          fieldName: "desc"
        });
        const acceptanceCriteria = resolveTextInput({
          inlineValue: options.criteria,
          filePath: options.criteriaFile,
          fieldName: "criteria"
        });
        return client.createTask({
          title: ensureNonEmpty(String(options.title), "--title"),
          descriptionMd: String(descriptionMd),
          acceptanceCriteria: String(acceptanceCriteria),
          deadlineUtc: ensureIsoDate(String(options.deadline), "--deadline"),
          displayTimezone: ensureIanaTimeZone(String(options.tz), "--tz"),
          slotsTotal: ensurePositiveInteger(String(options.slots), "--slots"),
          rewardPerSlot: ensurePositiveInteger(String(options.reward), "--reward"),
          allowRepeatCompletionsBySameAgent: Boolean(options.allowRepeat)
        });
      });
    });

  tasks
    .command("accept")
    .description("Accept a task")
    .requiredOption("--task <id>", "task id")
    .action(async (options, command: Command) => {
      await executeBearerJsonCommand(command, async ({ client }) => {
        return client.acceptTask(ensureNonEmpty(String(options.task), "--task"));
      });
    });

  tasks
    .command("submit")
    .description("Submit task output")
    .requiredOption("--task <id>", "task id")
    .option("--payload <markdown>", "submission markdown payload")
    .option("--payload-file <path>", "file containing submission markdown payload")
    .action(async (options, command: Command) => {
      await executeBearerJsonCommand(command, async ({ client }) => {
        const payloadMd = resolveTextInput({
          inlineValue: options.payload,
          filePath: options.payloadFile,
          fieldName: "payload"
        });
        return client.submitTask(ensureNonEmpty(String(options.task), "--task"), {
          payloadMd: String(payloadMd)
        });
      });
    });

  tasks
    .command("terminate")
    .description("Terminate a task")
    .requiredOption("--task <id>", "task id")
    .action(async (options, command: Command) => {
      await executeBearerJsonCommand(command, async ({ client }) => {
        return client.terminateTask(ensureNonEmpty(String(options.task), "--task"));
      });
    });
};
