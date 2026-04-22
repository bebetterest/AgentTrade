import type { Command } from "commander";
import { cliOperationBindings } from "../operation-bindings.js";
import {
  ensureAddress,
  ensureIanaTimeZone,
  ensureIsoDate,
  ensureNonEmpty,
  ensurePageLimit,
  ensurePositiveInteger,
  ensureQueryOrder,
  ensureTaskListSort,
  ensureTaskStatus
} from "../validators.js";
import { resolveTextInput } from "../text-input.js";
import { executeBearerOperationCommand, executeOperationCommand } from "./shared.js";

export const registerTaskCommands = (program: Command): void => {
  const tasks = program.command("tasks").description("Task lifecycle commands");

  tasks
    .command("list")
    .description("List tasks")
    .option("--q <text>", "search by id/title/description/criteria/publisher")
    .option("--status <status>", "OPEN|IN_PROGRESS|TERMINATED|CLOSED")
    .option("--publisher <address>", "publisher address")
    .option("--sort <key>", "latest|created|deadline|reward (default: latest)")
    .option("--order <order>", "asc|desc (default: desc)")
    .option("--cursor <offset>", "pagination cursor")
    .option("--limit <number>", "page size (1-100, default: 20)")
    .action(async (options, command: Command) => {
      await executeOperationCommand(command, cliOperationBindings["tasks list"], async () => ({
        query: {
          q: typeof options.q === "string" ? ensureNonEmpty(options.q, "--q") : undefined,
          status: typeof options.status === "string" ? ensureTaskStatus(options.status) : undefined,
          publisher: typeof options.publisher === "string" ? ensureAddress(options.publisher, "--publisher") : undefined,
          sort: typeof options.sort === "string" ? ensureTaskListSort(options.sort) : undefined,
          order: typeof options.order === "string" ? ensureQueryOrder(options.order) : undefined,
          cursor: typeof options.cursor === "string" ? ensureNonEmpty(options.cursor, "--cursor") : undefined,
          limit: typeof options.limit === "string" ? ensurePageLimit(options.limit, "--limit") : undefined
        }
      }));
    });

  tasks
    .command("get")
    .description("Get task details")
    .requiredOption("--task <id>", "task id")
    .action(async (options, command: Command) => {
      await executeOperationCommand(command, cliOperationBindings["tasks get"], async () => ({
        pathParams: { id: ensureNonEmpty(String(options.task), "--task") }
      }));
    });

  tasks
    .command("create")
    .description("Create a task (token required)")
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
      await executeBearerOperationCommand(command, cliOperationBindings["tasks create"], async () => {
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
        return {
          body: {
            title: ensureNonEmpty(String(options.title), "--title"),
            descriptionMd: String(descriptionMd),
            acceptanceCriteria: String(acceptanceCriteria),
            deadlineUtc: ensureIsoDate(String(options.deadline), "--deadline"),
            displayTimezone: ensureIanaTimeZone(String(options.tz), "--tz"),
            slotsTotal: ensurePositiveInteger(String(options.slots), "--slots"),
            rewardPerSlot: ensurePositiveInteger(String(options.reward), "--reward"),
            allowRepeatCompletionsBySameAgent: Boolean(options.allowRepeat)
          }
        };
      });
    });

  tasks
    .command("intend")
    .description("Add intention for a task (token required)")
    .requiredOption("--task <id>", "task id")
    .action(async (options, command: Command) => {
      await executeBearerOperationCommand(command, cliOperationBindings["tasks intend"], async () => ({
        pathParams: { id: ensureNonEmpty(String(options.task), "--task") }
      }));
    });

  tasks
    .command("intentions")
    .description("List task intentions")
    .requiredOption("--task <id>", "task id")
    .option("--cursor <token>", "pagination cursor")
    .option("--limit <number>", "page size (1-100, default: 20)")
    .action(async (options, command: Command) => {
      await executeOperationCommand(command, cliOperationBindings["tasks intentions"], async () => ({
        pathParams: { id: ensureNonEmpty(String(options.task), "--task") },
        query: {
          cursor: typeof options.cursor === "string" ? ensureNonEmpty(options.cursor, "--cursor") : undefined,
          limit: typeof options.limit === "string" ? ensurePageLimit(options.limit, "--limit") : undefined
        }
      }));
    });

  tasks
    .command("submit")
    .description("Submit task output (token required)")
    .requiredOption("--task <id>", "task id")
    .option("--payload <markdown>", "submission markdown payload")
    .option("--payload-file <path>", "file containing submission markdown payload")
    .action(async (options, command: Command) => {
      await executeBearerOperationCommand(command, cliOperationBindings["tasks submit"], async () => {
        const payloadMd = resolveTextInput({
          inlineValue: options.payload,
          filePath: options.payloadFile,
          fieldName: "payload"
        });
        return {
          pathParams: { id: ensureNonEmpty(String(options.task), "--task") },
          body: {
            payloadMd: String(payloadMd)
          }
        };
      });
    });

  tasks
    .command("terminate")
    .description("Terminate a task (token required)")
    .requiredOption("--task <id>", "task id")
    .action(async (options, command: Command) => {
      await executeBearerOperationCommand(command, cliOperationBindings["tasks terminate"], async () => ({
        pathParams: { id: ensureNonEmpty(String(options.task), "--task") }
      }));
    });
};
