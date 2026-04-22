import { readFileSync } from "node:fs";
import type { Command } from "commander";
import {
  CLI_DEFAULT_BASE_URL,
  CLI_DEFAULT_RETRIES,
  CLI_DEFAULT_TIMEOUT_MS,
  clearCliPersistedConfig,
  isStoredCliSecretEncrypted,
  loadCliPersistedConfig,
  setCliPersistedConfigValue,
  type CliPersistedConfig,
  type CliPersistedConfigKey,
  unsetCliPersistedConfigKeys
} from "../cli-config.js";
import { CliValidationError } from "../errors.js";
import { printSuccessJson, type StructuredCliWarning, withSuccessMeta } from "../output.js";
import { addInputContractHelp } from "./shared.js";
import {
  ensureAddress,
  ensureHttpUrl,
  ensureNonEmpty,
  ensureNonNegativeInteger,
  ensurePrivateKey,
  ensurePositiveInteger
} from "../validators.js";

type ConfigOutput = {
  path: string;
  exists: boolean;
  configured: {
    baseUrl: string | null;
    token: string | null;
    tokenConfigured: boolean;
    adminKey: string | null;
    adminKeyConfigured: boolean;
    walletAddress: string | null;
    walletAddressConfigured: boolean;
    walletPrivateKey: string | null;
    walletPrivateKeyConfigured: boolean;
    timeoutMs: number | null;
    retries: number | null;
  };
  effective: {
    baseUrl: string;
    tokenConfigured: boolean;
    adminKeyConfigured: boolean;
    walletAddress: string | null;
    walletAddressConfigured: boolean;
    walletPrivateKeyConfigured: boolean;
    timeoutMs: number;
    retries: number;
  };
};

const KEY_ALIASES: Record<string, CliPersistedConfigKey> = {
  "base-url": "baseUrl",
  base_url: "baseUrl",
  token: "token",
  "admin-key": "adminKey",
  admin_key: "adminKey",
  "wallet-address": "walletAddress",
  wallet_address: "walletAddress",
  "wallet-private-key": "walletPrivateKey",
  wallet_private_key: "walletPrivateKey",
  "timeout-ms": "timeoutMs",
  timeout_ms: "timeoutMs",
  retries: "retries"
};

const VALID_SET_KEYS = "base-url|token|admin-key|wallet-address|wallet-private-key|timeout-ms|retries";

const attachCommandPath = (error: unknown, commandPath: string): void => {
  if (!error || typeof error !== "object") {
    return;
  }
  const tagged = error as { commandPath?: string };
  if (!tagged.commandPath) {
    tagged.commandPath = commandPath;
  }
};

const resolvePretty = (command: Command): boolean => {
  const raw = command.optsWithGlobals() as { pretty?: boolean };
  return Boolean(raw.pretty);
};

const stripLeadingBom = (value: string): string => value.replace(/^\uFEFF/, "");
const normalizeConfigSetFileValue = (value: string): string => stripLeadingBom(value).trim();

const maskConfiguredSecret = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (isStoredCliSecretEncrypted(trimmed)) {
    return "***encrypted***";
  }
  return "***configured***";
};

const maskEncryptedSecret = (value: string | undefined): string | null => {
  if (!value || value.trim().length === 0) {
    return null;
  }
  return "***encrypted***";
};

const toPlaintextPersistedSecretWarnings = (values: CliPersistedConfig): StructuredCliWarning[] => {
  const warnings: StructuredCliWarning[] = [];
  const token = values.token?.trim();
  const adminKey = values.adminKey?.trim();

  if (token && !isStoredCliSecretEncrypted(token)) {
    warnings.push({
      code: "PLAINTEXT_PERSISTED_SECRET",
      level: "WARNING",
      field: "token",
      message:
        "token in CLI config is plaintext and not encrypted at rest; rerun `agentrade config set token --value-file <path>` or `agentrade config set token <value>` to rewrite it securely"
    });
  }

  if (adminKey && !isStoredCliSecretEncrypted(adminKey)) {
    warnings.push({
      code: "PLAINTEXT_PERSISTED_SECRET",
      level: "WARNING",
      field: "adminKey",
      message:
        "admin-key in CLI config is plaintext and not encrypted at rest; rerun `agentrade config set admin-key --value-file <path>` or `agentrade config set admin-key <value>` to rewrite it securely"
    });
  }

  return warnings;
};

const toConfigOutput = (
  path: string,
  exists: boolean,
  values: CliPersistedConfig
): ConfigOutput => {
  return {
    path,
    exists,
    configured: {
      baseUrl: values.baseUrl ?? null,
      token: maskConfiguredSecret(values.token),
      tokenConfigured: Boolean(values.token),
      adminKey: maskConfiguredSecret(values.adminKey),
      adminKeyConfigured: Boolean(values.adminKey),
      walletAddress: values.walletAddress ?? null,
      walletAddressConfigured: Boolean(values.walletAddress),
      walletPrivateKey: maskEncryptedSecret(values.walletPrivateKey),
      walletPrivateKeyConfigured: Boolean(values.walletPrivateKey),
      timeoutMs: values.timeoutMs ?? null,
      retries: values.retries ?? null
    },
    effective: {
      baseUrl: values.baseUrl ?? CLI_DEFAULT_BASE_URL,
      tokenConfigured: Boolean(values.token),
      adminKeyConfigured: Boolean(values.adminKey),
      walletAddress: values.walletAddress ?? null,
      walletAddressConfigured: Boolean(values.walletAddress),
      walletPrivateKeyConfigured: Boolean(values.walletPrivateKey),
      timeoutMs: values.timeoutMs ?? CLI_DEFAULT_TIMEOUT_MS,
      retries: values.retries ?? CLI_DEFAULT_RETRIES
    }
  };
};

const parseSetKey = (raw: string): CliPersistedConfigKey => {
  const normalized = raw.trim().toLowerCase();
  const key = KEY_ALIASES[normalized];
  if (!key) {
    throw new CliValidationError(
      `invalid config key '${raw}': expected one of ${VALID_SET_KEYS}`
    );
  }
  return key;
};

const parseUnsetKey = (raw: string): CliPersistedConfigKey | "all" => {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "all") {
    return "all";
  }
  return parseSetKey(raw);
};

const parseSetValue = (
  key: CliPersistedConfigKey,
  rawValue: string
): string | number => {
  switch (key) {
    case "baseUrl":
      return ensureHttpUrl(rawValue, "<value>");
    case "token":
      return ensureNonEmpty(rawValue, "<value>");
    case "adminKey":
      return ensureNonEmpty(rawValue, "<value>");
    case "walletAddress":
      return ensureAddress(rawValue, "<value>");
    case "walletPrivateKey":
      return ensurePrivateKey(rawValue, "<value>");
    case "timeoutMs":
      return ensurePositiveInteger(rawValue, "<value>");
    case "retries":
      return ensureNonNegativeInteger(rawValue, "<value>");
    default: {
      const exhaustive: never = key;
      return exhaustive;
    }
  }
};

const resolveConfigSetRawValue = (
  inlineValue: string | undefined,
  valueFile: string | undefined
): string => {
  if (inlineValue !== undefined && valueFile !== undefined) {
    throw new CliValidationError("<value> and --value-file are mutually exclusive");
  }

  if (valueFile !== undefined) {
    try {
      return normalizeConfigSetFileValue(readFileSync(valueFile, "utf8"));
    } catch (error) {
      throw new CliValidationError(
        `failed to read --value-file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (inlineValue === undefined) {
    throw new CliValidationError("<value> or --value-file is required");
  }

  return stripLeadingBom(inlineValue);
};

export const registerConfigCommands = (program: Command): void => {
  const config = program.command("config").description("Manage global CLI runtime configuration");
  const configSetHelpAppendix = `
Config set note:
  automation: prefer --value-file for token/admin-key/wallet-private-key to avoid argv exposure
  persisted token/admin-key/wallet-private-key are encrypted at rest
`;

  config
    .command("show")
    .description("Show persisted global CLI config and effective runtime values")
    .action(function (this: Command) {
      try {
        const snapshot = loadCliPersistedConfig();
        printSuccessJson(
          withSuccessMeta(
            toConfigOutput(snapshot.path, snapshot.exists, snapshot.values),
            toPlaintextPersistedSecretWarnings(snapshot.values)
          ),
          resolvePretty(this),
          "config show"
        );
      } catch (error) {
        attachCommandPath(error, "config show");
        throw error;
      }
    });

  addInputContractHelp(
    config
      .command("set")
      .description("Persist one global CLI setting (supports *_ aliases and file-backed values)")
      .argument("<key>", `setting key (${VALID_SET_KEYS})`)
      .argument("[value]", "setting value")
      .option("--value-file <path>", "file containing setting value"),
    ["require one of <value> / --value-file"]
  )
    .addHelpText("after", configSetHelpAppendix)
    .action(function (this: Command, rawKey: string, rawValue?: string) {
      try {
        const options = this.opts() as { valueFile?: string };
        const key = parseSetKey(rawKey);
        const value = parseSetValue(key, resolveConfigSetRawValue(rawValue, options.valueFile));
        const snapshot = setCliPersistedConfigValue(key, value);
        printSuccessJson(
          withSuccessMeta(
            {
              action: "set",
              key,
              ...toConfigOutput(snapshot.path, snapshot.exists, snapshot.values)
            },
            toPlaintextPersistedSecretWarnings(snapshot.values)
          ),
          resolvePretty(this),
          "config set"
        );
      } catch (error) {
        attachCommandPath(error, "config set");
        throw error;
      }
    });

  config
    .command("unset")
    .description("Remove one persisted key or clear all keys")
    .argument(
      "<key>",
      "setting key (base-url|token|admin-key|wallet-address|wallet-private-key|timeout-ms|retries|all)"
    )
    .action(function (this: Command, rawKey: string) {
      try {
        const key = parseUnsetKey(rawKey);
        const snapshot =
          key === "all" ? clearCliPersistedConfig() : unsetCliPersistedConfigKeys([key]);
        printSuccessJson(
          withSuccessMeta(
            {
              action: "unset",
              key,
              ...toConfigOutput(snapshot.path, snapshot.exists, snapshot.values)
            },
            toPlaintextPersistedSecretWarnings(snapshot.values)
          ),
          resolvePretty(this),
          "config unset"
        );
      } catch (error) {
        attachCommandPath(error, "config unset");
        throw error;
      }
    });
};
