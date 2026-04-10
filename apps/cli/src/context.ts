import { AgentradeApiClient } from "@agentrade/sdk";
import type { Command } from "commander";
import { CliConfigError } from "./errors.js";
import {
  CLI_DEFAULT_BASE_URL,
  CLI_DEFAULT_RETRIES,
  CLI_DEFAULT_TIMEOUT_MS,
  loadCliPersistedConfig,
  type CliPersistedConfig
} from "./cli-config.js";
import { ensureHttpUrl, ensureNonNegativeInteger, ensurePositiveInteger } from "./validators.js";

interface RawGlobalOptions {
  baseUrl?: string;
  token?: string;
  adminKey?: string;
  timeoutMs?: string | number;
  retries?: string | number;
  pretty?: boolean;
}

export interface CliGlobalOptions {
  baseUrl: string;
  token?: string;
  adminKey?: string;
  timeoutMs: number;
  retries: number;
  pretty: boolean;
}

export interface CommandContext {
  commandPath: string;
  options: CliGlobalOptions;
  client: AgentradeApiClient;
  requireToken: () => string;
  requireAdminKey: () => string;
}

const resolveCommandPath = (command: Command): string => {
  const segments: string[] = [];
  let cursor: Command | null = command;
  while (cursor && cursor.name() !== "agentrade") {
    segments.push(cursor.name());
    cursor = cursor.parent ?? null;
  }
  return segments.reverse().join(" ");
};

const normalizeOptional = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  return value.trim().length > 0 ? value : undefined;
};

const parsePositiveInteger = (value: string | number, flag: string): number => {
  return ensurePositiveInteger(String(value), flag);
};

const parseNonNegativeInteger = (value: string | number, flag: string): number => {
  return ensureNonNegativeInteger(String(value), flag);
};

export const resolveGlobalOptions = (
  command: Command,
  persistedConfig: CliPersistedConfig = loadCliPersistedConfig().values
): CliGlobalOptions => {
  const raw = command.optsWithGlobals() as RawGlobalOptions;

  const rawBaseUrl = raw.baseUrl === undefined ? persistedConfig.baseUrl : String(raw.baseUrl);
  const baseUrl = ensureHttpUrl(rawBaseUrl ?? CLI_DEFAULT_BASE_URL, "--base-url");

  const rawToken = raw.token === undefined ? persistedConfig.token : String(raw.token);
  const rawAdminKey = raw.adminKey === undefined ? persistedConfig.adminKey : String(raw.adminKey);

  const rawTimeoutMs =
    raw.timeoutMs === undefined ? persistedConfig.timeoutMs ?? CLI_DEFAULT_TIMEOUT_MS : raw.timeoutMs;
  const timeoutMs = parsePositiveInteger(rawTimeoutMs, "--timeout-ms");

  const rawRetries =
    raw.retries === undefined ? persistedConfig.retries ?? CLI_DEFAULT_RETRIES : raw.retries;
  const retries = parseNonNegativeInteger(rawRetries, "--retries");

  return {
    baseUrl,
    token: normalizeOptional(rawToken),
    adminKey: normalizeOptional(rawAdminKey),
    timeoutMs,
    retries,
    pretty: Boolean(raw.pretty)
  };
};

export const createCommandContext = (command: Command): CommandContext => {
  const options = resolveGlobalOptions(command);
  const client = new AgentradeApiClient({
    baseUrl: options.baseUrl,
    token: options.token,
    adminKey: options.adminKey,
    timeoutMs: options.timeoutMs,
    retries: options.retries
  });

  return {
    commandPath: resolveCommandPath(command),
    options,
    client,
    requireToken: () => {
      if (!options.token) {
        throw new CliConfigError("missing token: use --token");
      }
      return options.token;
    },
    requireAdminKey: () => {
      if (!options.adminKey) {
        throw new CliConfigError("missing admin key: use --admin-key");
      }
      return options.adminKey;
    }
  };
};
