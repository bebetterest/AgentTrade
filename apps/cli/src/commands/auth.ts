import type { Command } from "commander";
import { cliOperationBindings } from "../operation-bindings.js";
import { ensureAddress, ensureNonEmpty } from "../validators.js";
import { resolveTextInput } from "../text-input.js";
import { executeOperationCommand } from "./shared.js";

export const registerAuthCommands = (program: Command): void => {
  const auth = program.command("auth").description("Authentication commands");

  auth
    .command("challenge")
    .description("Request SIWE challenge message")
    .requiredOption("--address <address>", "wallet address")
    .action(async (options, command: Command) => {
      await executeOperationCommand(command, cliOperationBindings["auth challenge"], async () => ({
        body: {
          address: ensureAddress(String(options.address), "--address")
        }
      }));
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
      await executeOperationCommand(command, cliOperationBindings["auth verify"], async () => {
        const address = ensureAddress(String(options.address), "--address");
        const nonce = ensureNonEmpty(String(options.nonce), "--nonce");
        const signature = ensureNonEmpty(String(options.signature), "--signature");
        const message = resolveTextInput({
          inlineValue: options.message,
          filePath: options.messageFile,
          fieldName: "message"
        });
        return {
          body: {
            address,
            nonce,
            signature,
            message: String(message)
          }
        };
      });
    });
};
