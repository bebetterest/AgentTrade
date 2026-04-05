import type { Command } from "commander";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { cliOperationBindings } from "../operation-bindings.js";
import { ensureAddress, ensureNonEmpty } from "../validators.js";
import { resolveTextInput } from "../text-input.js";
import { executeJsonCommand, executeOperationCommand } from "./shared.js";

export const registerAuthCommands = (program: Command): void => {
  const auth = program.command("auth").description("Authentication commands");
  const privateKeySecurityNotice =
    "PRIVATE KEY IS DISPLAYED ONLY ONCE. SAVE IT SECURELY NOW. NEVER SHARE, LOG, COMMIT, OR SCREENSHOT THIS KEY.";

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
    .command("register")
    .description("Create wallet, run SIWE challenge+verify, and return JWT (private key shown once)")
    .action(async (_, command: Command) => {
      await executeJsonCommand(command, async (ctx) => {
        const privateKey = generatePrivateKey();
        const account = privateKeyToAccount(privateKey);

        const challenge = await ctx.client.authChallenge({
          address: account.address
        });
        const signature = await account.signMessage({
          message: challenge.message
        });
        const verified = await ctx.client.authVerify({
          address: account.address,
          nonce: challenge.nonce,
          signature,
          message: challenge.message
        });

        return {
          wallet: {
            address: account.address,
            privateKey
          },
          auth: {
            token: verified.token,
            expiresIn: verified.expiresIn
          },
          securityNotice: {
            level: "CRITICAL",
            message: privateKeySecurityNotice
          }
        };
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
