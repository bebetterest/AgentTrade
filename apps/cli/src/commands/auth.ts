import type { Command } from "commander";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  loadCliPersistedConfig,
  resolveStoredWalletPrivateKey,
  setCliPersistedConfigValue
} from "../cli-config.js";
import { CliConfigError, CliValidationError } from "../errors.js";
import { cliOperationBindings } from "../operation-bindings.js";
import { ensureAddress, ensureNonEmpty, ensurePrivateKey } from "../validators.js";
import { resolveTextInput } from "../text-input.js";
import { executeJsonCommand, executeOperationCommand } from "./shared.js";

const HIDDEN_PRIVATE_KEY = "***hidden***";

const createAccountFromPrivateKey = (
  privateKey: `0x${string}`,
  flag: string,
  source: "config" | "input"
) => {
  try {
    return privateKeyToAccount(privateKey);
  } catch {
    if (source === "config") {
      throw new CliConfigError(`${flag} is not a valid secp256k1 private key`);
    }
    throw new CliValidationError(`${flag} is not a valid secp256k1 private key`);
  }
};

const persistToken = (token: string, noPersistToken: boolean): boolean => {
  if (noPersistToken) {
    return false;
  }
  setCliPersistedConfigValue("token", token);
  return true;
};

export const registerAuthCommands = (program: Command): void => {
  const auth = program.command("auth").description("Authentication commands");
  const privateKeySecurityNotice =
    "Please keep your wallet information secure. It is your only identity credential. Every operation on this platform requires short-lived authorization from this wallet, and you should complete it yourself through the CLI instead of asking your owner to operate manually. Do not share it with other agents or anyone else. It must remain known only to you and your owner.";

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
    .description("Create wallet, run SIWE challenge+verify, and persist wallet/token to local CLI config")
    .option("--show-private-key", "print plaintext private key in output", false)
    .option("--no-persist-token", "do not persist token to local CLI config")
    .action(async (options, command: Command) => {
      await executeJsonCommand(command, async (ctx) => {
        const noPersistToken = (options as { persistToken?: boolean }).persistToken === false;
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
        setCliPersistedConfigValue("walletAddress", account.address);
        setCliPersistedConfigValue("walletPrivateKey", privateKey);
        const tokenPersisted = persistToken(verified.token, noPersistToken);

        return {
          wallet: {
            address: account.address,
            privateKey: options.showPrivateKey ? privateKey : HIDDEN_PRIVATE_KEY
          },
          auth: {
            token: verified.token,
            expiresIn: verified.expiresIn
          },
          persistence: {
            walletPersisted: true,
            tokenPersisted
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

  auth
    .command("login")
    .description("Run SIWE challenge+sign+verify with local wallet private key")
    .option("--address <address>", "wallet address override")
    .option("--private-key <privateKey>", "wallet private key override")
    .option("--no-persist-token", "do not persist token to local CLI config")
    .action(async (options, command: Command) => {
      await executeJsonCommand(command, async (ctx) => {
        const noPersistToken = (options as { persistToken?: boolean }).persistToken === false;
        const persistedSnapshot = loadCliPersistedConfig();
        const persisted = persistedSnapshot.values;
        const providedAddress =
          options.address === undefined ? undefined : ensureAddress(String(options.address), "--address");
        const providedPrivateKey =
          options.privateKey === undefined
            ? undefined
            : ensurePrivateKey(String(options.privateKey), "--private-key");
        const persistedPrivateKey = resolveStoredWalletPrivateKey(
          persisted.walletPrivateKey,
          persistedSnapshot.path
        );
        const resolvedPrivateKey = providedPrivateKey ?? persistedPrivateKey;

        if (!resolvedPrivateKey) {
          throw new CliConfigError(
            "missing wallet private key: run `agentrade auth register` or pass --private-key"
          );
        }

        const account = createAccountFromPrivateKey(
          resolvedPrivateKey as `0x${string}`,
          providedPrivateKey ? "--private-key" : "wallet-private-key in CLI config",
          providedPrivateKey ? "input" : "config"
        );
        const derivedAddress = account.address;

        if (providedAddress && providedAddress.toLowerCase() !== derivedAddress.toLowerCase()) {
          throw new CliValidationError("--address does not match the resolved private key address");
        }
        if (
          !providedPrivateKey &&
          !providedAddress &&
          persisted.walletAddress &&
          persisted.walletAddress.toLowerCase() !== derivedAddress.toLowerCase()
        ) {
          throw new CliConfigError(
            "wallet-address and wallet-private-key in CLI config do not match: run `agentrade auth register` or update config"
          );
        }

        const address =
          providedAddress ?? (!providedPrivateKey ? persisted.walletAddress : undefined) ?? derivedAddress;
        const challenge = await ctx.client.authChallenge({
          address: ensureAddress(address, "--address")
        });
        const signature = await account.signMessage({
          message: challenge.message
        });
        const verified = await ctx.client.authVerify({
          address: ensureAddress(address, "--address"),
          nonce: challenge.nonce,
          signature,
          message: challenge.message
        });
        const tokenPersisted = persistToken(verified.token, noPersistToken);

        return {
          wallet: {
            address
          },
          auth: {
            token: verified.token,
            expiresIn: verified.expiresIn
          },
          persistence: {
            tokenPersisted,
            walletSource: providedPrivateKey ? "flag" : "config"
          }
        };
      });
    });
};
