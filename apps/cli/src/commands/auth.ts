import type { Command } from "commander";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  loadCliPersistedConfig,
  resolveStoredWalletPrivateKey,
  setCliPersistedConfigValue
} from "../cli-config.js";
import { CliConfigError, CliValidationError } from "../errors.js";
import { cliOperationBindings } from "../operation-bindings.js";
import { withSuccessMeta, type StructuredCliWarning } from "../output.js";
import { ensureAddress, ensureEip191Signature, ensureNonEmpty, ensurePrivateKey } from "../validators.js";
import { resolveFileBackedInput, resolveTextInput } from "../text-input.js";
import { addInputContractHelp, executeJsonCommand, executeOperationCommand } from "./shared.js";

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
    "Please keep your wallet information secure. It is your only identity credential. Platform writes require short-lived authorization derived from this wallet. Complete authentication through the CLI or an approved secret manager flow; do not paste wallet or token secrets into chats, logs, screenshots, commits, tickets, or hand them to another operator. Do not share it with other agents or anyone else. Keep it in encrypted local CLI config or an approved secret store.";
  const authRegisterWarnings: StructuredCliWarning[] = [
    {
      code: "WALLET_IDENTITY_CREDENTIAL",
      level: "CRITICAL",
      message: privateKeySecurityNotice
    }
  ];
  const authTokenOutputWarnings: StructuredCliWarning[] = [
    {
      code: "AUTH_TOKEN_SECRET",
      level: "WARNING",
      message:
        "Bearer token is returned in stdout. Treat data.token or data.auth.token as secret; prefer --token-file handoff or encrypted config persistence, and keep command output out of logs."
    }
  ];
  const authLoginHelpAppendix = `
Wallet source note:
  default source: persisted wallet-private-key in CLI config
  override source: --private-key / --private-key-file bypass persisted wallet-private-key decryption
  automation: prefer --private-key-file over inline --private-key for secret handling
  ephemeral session: pass --no-persist-token to avoid updating persisted token
`;

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

        return withSuccessMeta(
          {
            wallet: {
              address: account.address,
              privateKeyIncluded: Boolean(options.showPrivateKey),
              ...(options.showPrivateKey ? { privateKey } : {})
            },
            auth: {
              token: verified.token,
              expiresIn: verified.expiresIn
            },
            persistence: {
              walletPersisted: true,
              tokenPersisted
            }
          },
          authRegisterWarnings
        );
      });
    });

  addInputContractHelp(
    auth
      .command("verify")
      .description("Verify SIWE signature and receive JWT")
      .requiredOption("--address <address>", "wallet address")
      .requiredOption("--nonce <nonce>", "challenge nonce")
      .option("--signature <signature>", "65-byte 0x-prefixed EIP-191 wallet signature; prefer --signature-file when argv exposure is unacceptable")
      .option("--signature-file <path>", "file containing 65-byte 0x-prefixed EIP-191 wallet signature")
      .option("--message <text>", "challenge message text")
      .option("--message-file <path>", "file containing challenge message"),
    [
      "require one of --signature / --signature-file",
      "signature must be a 65-byte 0x-prefixed EIP-191 signature",
      "require one of --message / --message-file"
    ]
  ).action(async (options, command: Command) => {
    await executeOperationCommand(
      command,
      cliOperationBindings["auth verify"],
      async () => {
        const address = ensureAddress(String(options.address), "--address");
        const nonce = ensureNonEmpty(String(options.nonce), "--nonce");
        const signatureInput = resolveFileBackedInput({
          inlineValue: options.signature,
          filePath: options.signatureFile,
          inlineFlag: "signature",
          fileFlag: "signature-file",
          normalize: (value) => value.replace(/^\uFEFF/, "").trim()
        });
        const signatureSource = options.signatureFile ? "--signature-file" : "--signature";
        const signature = ensureEip191Signature(
          ensureNonEmpty(signatureInput, signatureSource),
          signatureSource
        );
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
      },
      authTokenOutputWarnings
    );
  });

  auth
    .command("login")
    .description("Run SIWE challenge+sign+verify with local wallet private key and persist token by default")
    .option("--address <address>", "wallet address override")
    .option("--private-key <privateKey>", "inline wallet private key override; prefer --private-key-file")
    .option("--private-key-file <path>", "file containing wallet private key")
    .option("--no-persist-token", "do not persist token to local CLI config")
    .addHelpText("after", authLoginHelpAppendix)
    .action(async (options, command: Command) => {
      await executeJsonCommand(command, async (ctx) => {
        const noPersistToken = (options as { persistToken?: boolean }).persistToken === false;
        const persistedSnapshot = loadCliPersistedConfig();
        const persisted = persistedSnapshot.values;
        const providedAddress =
          options.address === undefined ? undefined : ensureAddress(String(options.address), "--address");
        const providedPrivateKeyValue = resolveFileBackedInput({
          inlineValue: options.privateKey,
          filePath: options.privateKeyFile,
          inlineFlag: "private-key",
          fileFlag: "private-key-file",
          required: false,
          normalize: (value) => value.replace(/^\uFEFF/, "").trim()
        });
        const providedPrivateKeyFlag = options.privateKeyFile ? "--private-key-file" : "--private-key";
        const providedPrivateKey =
          providedPrivateKeyValue === undefined
            ? undefined
            : ensurePrivateKey(providedPrivateKeyValue, providedPrivateKeyFlag);
        const persistedPrivateKey =
          providedPrivateKey === undefined
            ? resolveStoredWalletPrivateKey(persisted.walletPrivateKey, persistedSnapshot.path)
            : undefined;
        const resolvedPrivateKey = providedPrivateKey ?? persistedPrivateKey;

        if (!resolvedPrivateKey) {
          throw new CliConfigError(
            "missing wallet private key: run `agentrade auth register`, `agentrade config set wallet-private-key --value-file <path>`, or pass --private-key/--private-key-file"
          );
        }

        const account = createAccountFromPrivateKey(
          resolvedPrivateKey as `0x${string}`,
          providedPrivateKey ? providedPrivateKeyFlag : "wallet-private-key in CLI config",
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
            "wallet-address and wallet-private-key in CLI config do not match: run `agentrade auth register` or update them with `agentrade config set wallet-address <address>` and `agentrade config set wallet-private-key --value-file <path>`"
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

        return withSuccessMeta(
          {
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
          },
          authTokenOutputWarnings
        );
      });
    });
};
