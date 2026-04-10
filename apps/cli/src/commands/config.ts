import type { Command } from "commander";
import {
  CLI_DEFAULT_BASE_URL,
  CLI_DEFAULT_RETRIES,
  CLI_DEFAULT_TIMEOUT_MS,
  clearCliPersistedConfig,
  loadCliPersistedConfig,
  setCliPersistedConfigValue,
  type CliPersistedConfig,
  type CliPersistedConfigKey,
  unsetCliPersistedConfigKeys
} from "../cli-config.js";
import { CliValidationError } from "../errors.js";
import { printJson } from "../output.js";
import {
  ensureHttpUrl,
  ensureNonEmpty,
  ensureNonNegativeInteger,
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
    timeoutMs: number | null;
    retries: number | null;
  };
  effective: {
    baseUrl: string;
    tokenConfigured: boolean;
    adminKeyConfigured: boolean;
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
  "timeout-ms": "timeoutMs",
  timeout_ms: "timeoutMs",
  retries: "retries"
};

const VALID_SET_KEYS = "base-url|token|admin-key|timeout-ms|retries";

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

const maskSecret = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length <= 8) {
    return "***";
  }
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
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
      token: maskSecret(values.token),
      tokenConfigured: Boolean(values.token),
      adminKey: maskSecret(values.adminKey),
      adminKeyConfigured: Boolean(values.adminKey),
      timeoutMs: values.timeoutMs ?? null,
      retries: values.retries ?? null
    },
    effective: {
      baseUrl: values.baseUrl ?? CLI_DEFAULT_BASE_URL,
      tokenConfigured: Boolean(values.token),
      adminKeyConfigured: Boolean(values.adminKey),
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

export const registerConfigCommands = (program: Command): void => {
  const config = program.command("config").description("Manage global CLI runtime configuration");

  config
    .command("show")
    .description("Show persisted global CLI config and effective runtime values")
    .action(function (this: Command) {
      try {
        const snapshot = loadCliPersistedConfig();
        printJson(
          {
            ok: true,
            ...toConfigOutput(snapshot.path, snapshot.exists, snapshot.values)
          },
          resolvePretty(this)
        );
      } catch (error) {
        attachCommandPath(error, "config show");
        throw error;
      }
    });

  config
    .command("set")
    .description("Persist one global CLI setting (supports *_ aliases)")
    .argument("<key>", `setting key (${VALID_SET_KEYS})`)
    .argument("<value>", "setting value")
    .action(function (this: Command, rawKey: string, rawValue: string) {
      try {
        const key = parseSetKey(rawKey);
        const value = parseSetValue(key, rawValue);
        const snapshot = setCliPersistedConfigValue(key, value);
        printJson(
          {
            ok: true,
            action: "set",
            key,
            ...toConfigOutput(snapshot.path, snapshot.exists, snapshot.values)
          },
          resolvePretty(this)
        );
      } catch (error) {
        attachCommandPath(error, "config set");
        throw error;
      }
    });

  config
    .command("unset")
    .description("Remove one persisted key or clear all keys")
    .argument("<key>", "setting key (base-url|token|admin-key|timeout-ms|retries|all)")
    .action(function (this: Command, rawKey: string) {
      try {
        const key = parseUnsetKey(rawKey);
        const snapshot =
          key === "all" ? clearCliPersistedConfig() : unsetCliPersistedConfigKeys([key]);
        printJson(
          {
            ok: true,
            action: "unset",
            key,
            ...toConfigOutput(snapshot.path, snapshot.exists, snapshot.values)
          },
          resolvePretty(this)
        );
      } catch (error) {
        attachCommandPath(error, "config unset");
        throw error;
      }
    });
};
