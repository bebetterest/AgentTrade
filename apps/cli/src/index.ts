#!/usr/bin/env node
import { Command } from "commander";
import { AgentradeApiClient } from "@agentrade/sdk";
import { VoteChoice, type Address } from "@agentrade/types";
import { readFileSync } from "node:fs";

const baseUrl = process.env.AGENTRADE_API_BASE_URL ?? "http://localhost:3000";
const token = process.env.AGENTRADE_TOKEN;
const adminKey = process.env.AGENTRADE_ADMIN_SERVICE_KEY;

const client = new AgentradeApiClient({ baseUrl, token });
const program = new Command();

program
  .name("agentrade")
  .description("Agentrade CLI for agent and admin operations")
  .version("0.1.0");

program
  .command("auth:challenge")
  .description("Request SIWE challenge message")
  .requiredOption("--address <address>", "wallet address")
  .action(async (options) => {
    const response = await fetch(`${baseUrl}/v1/auth/challenge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: options.address })
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    console.log(await response.text());
  });

program
  .command("auth:verify")
  .description("Verify SIWE signature and get JWT")
  .requiredOption("--address <address>", "wallet address")
  .requiredOption("--nonce <nonce>", "challenge nonce")
  .requiredOption("--signature <signature>", "wallet signature")
  .option("--message <text>", "challenge message text")
  .option("--message-file <path>", "path of challenge message file")
  .action(async (options) => {
    const message = options.messageFile ? readFileSync(options.messageFile, "utf8") : options.message;
    if (!message) {
      throw new Error("message or message-file is required");
    }
    const response = await fetch(`${baseUrl}/v1/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        address: options.address,
        nonce: options.nonce,
        message,
        signature: options.signature
      })
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    console.log(await response.text());
  });

program
  .command("tasks:list")
  .description("List tasks")
  .action(async () => {
    const data = await client.getTasks();
    console.log(JSON.stringify(data, null, 2));
  });

program
  .command("tasks:create")
  .description("Create a task")
  .requiredOption("--title <title>", "task title")
  .requiredOption("--desc <markdown>", "task description markdown")
  .requiredOption("--criteria <markdown>", "acceptance criteria markdown")
  .requiredOption("--deadline <iso>", "deadline in ISO UTC format")
  .requiredOption("--tz <timezone>", "display timezone")
  .requiredOption("--slots <number>", "slot count")
  .requiredOption("--reward <number>", "reward per slot")
  .option("--allow-repeat", "allow repeat completions by same agent")
  .action(async (options) => {
    const task = await client.createTask({
      title: options.title,
      descriptionMd: options.desc,
      acceptanceCriteria: options.criteria,
      deadlineUtc: options.deadline,
      displayTimezone: options.tz,
      slotsTotal: Number(options.slots),
      rewardPerSlot: Number(options.reward),
      allowRepeatCompletionsBySameAgent: Boolean(options.allowRepeat)
    });
    console.log(JSON.stringify(task, null, 2));
  });

program
  .command("tasks:accept")
  .description("Accept a task")
  .requiredOption("--task <id>", "task id")
  .action(async (options) => {
    const task = await client.acceptTask(options.task);
    console.log(JSON.stringify(task, null, 2));
  });

program
  .command("tasks:terminate")
  .description("Terminate a task (publisher only)")
  .requiredOption("--task <id>", "task id")
  .action(async (options) => {
    const response = await fetch(`${baseUrl}/v1/tasks/${options.task}/terminate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {})
      }
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    console.log(await response.text());
  });

program
  .command("tasks:submit")
  .description("Submit task output")
  .requiredOption("--task <id>", "task id")
  .requiredOption("--payload <markdown>", "submission markdown")
  .action(async (options) => {
    const data = await client.submitTask(options.task, {
      payloadMd: options.payload
    });
    console.log(JSON.stringify(data, null, 2));
  });

program
  .command("submissions:confirm")
  .description("Confirm a submission (publisher only)")
  .requiredOption("--submission <id>", "submission id")
  .action(async (options) => {
    const response = await fetch(`${baseUrl}/v1/submissions/${options.submission}/confirm`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {})
      }
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    console.log(await response.text());
  });

program
  .command("submissions:reject")
  .description("Reject a submission (publisher only)")
  .requiredOption("--submission <id>", "submission id")
  .action(async (options) => {
    const response = await fetch(`${baseUrl}/v1/submissions/${options.submission}/reject`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {})
      }
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    console.log(await response.text());
  });

program
  .command("disputes:open")
  .description("Open a dispute")
  .requiredOption("--task <id>", "task id")
  .requiredOption("--submission <id>", "submission id")
  .requiredOption("--reason <markdown>", "dispute reason")
  .action(async (options) => {
    const data = await client.openDispute({
      taskId: options.task,
      submissionId: options.submission,
      reasonMd: options.reason
    });
    console.log(JSON.stringify(data, null, 2));
  });

program
  .command("disputes:vote")
  .description("Vote on dispute")
  .requiredOption("--dispute <id>", "dispute id")
  .requiredOption("--vote <choice>", "COMPLETED or NOT_COMPLETED")
  .action(async (options) => {
    const value = String(options.vote).toUpperCase();
    if (value !== VoteChoice.COMPLETED && value !== VoteChoice.NOT_COMPLETED) {
      throw new Error("vote must be COMPLETED or NOT_COMPLETED");
    }
    const data = await client.voteDispute(options.dispute, {
      vote: value as VoteChoice
    });
    console.log(JSON.stringify(data, null, 2));
  });

program
  .command("disputes:list")
  .description("List disputes")
  .action(async () => {
    const data = await client.getDisputes();
    console.log(JSON.stringify(data, null, 2));
  });

program
  .command("agent:profile")
  .description("Get agent profile")
  .requiredOption("--address <address>", "agent address")
  .action(async (options) => {
    const data = await client.getAgentProfile(options.address as Address);
    console.log(JSON.stringify(data, null, 2));
  });

program
  .command("agent:ledger")
  .description("Get agent ledger balance")
  .requiredOption("--address <address>", "agent address")
  .action(async (options) => {
    const data = await client.getLedger(options.address as Address);
    console.log(JSON.stringify(data, null, 2));
  });

program
  .command("cycles:list")
  .description("List cycles")
  .action(async () => {
    const data = await client.getCycles();
    console.log(JSON.stringify(data, null, 2));
  });

program
  .command("cycles:active")
  .description("Get active cycle")
  .action(async () => {
    const data = await client.getActiveCycle();
    console.log(JSON.stringify(data, null, 2));
  });

program
  .command("admin:cycle-close")
  .description("Close current cycle (admin)")
  .action(async () => {
    if (!adminKey) {
      throw new Error("AGENTRADE_ADMIN_SERVICE_KEY is required");
    }
    const response = await fetch(`${baseUrl}/v1/admin/cycles/close`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-admin-service-key": adminKey
      }
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    console.log(await response.text());
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error.message ?? String(error));
  process.exit(1);
});
