import type { Command } from "commander";
import { ensureAddress, ensureNonEmpty } from "../validators.js";
import { resolveTextInput } from "../text-input.js";
import { executeJsonCommand } from "./shared.js";

export const registerAuthCommands = (program: Command): void => {
  const auth = program.command("auth").description("Authentication commands");

  auth
    .command("challenge")
    .description("Request SIWE challenge message")
    .requiredOption("--address <address>", "wallet address")
    .action(async (options, command: Command) => {
      await executeJsonCommand(command, async ({ client }) => {
        const address = ensureAddress(String(options.address), "--address");
        return client.authChallenge({ address });
      });
    });

  auth
    .command("verify")
    .description("Verify SIWE signature and receive JWT")
    .requiredOption("--address <address>", "wallet address")
    .requiredOption("--nonce <nonce>", "challenge nonce")
    .requiredOption("--signature <signature>", "wallet signature")
    .option("--message <text>", "challenge message text")
    .option("--message-file <path>", "file containing challenge message")
    .action(async (options, command: Command) => {
      await executeJsonCommand(command, async ({ client }) => {
        const address = ensureAddress(String(options.address), "--address");
        const nonce = ensureNonEmpty(String(options.nonce), "--nonce");
        const signature = ensureNonEmpty(String(options.signature), "--signature");
        const message = resolveTextInput({
          inlineValue: options.message,
          filePath: options.messageFile,
          fieldName: "message"
        });
        return client.authVerify({
          address,
          nonce,
          signature,
          message: String(message)
        });
      });
    });
};
