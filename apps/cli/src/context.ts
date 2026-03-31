import { AgentradeApiClient } from "@agentrade/sdk";
import type { Command } from "commander";
import { CliConfigError } from "./errors.js";
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

export const resolveGlobalOptions = (command: Command): CliGlobalOptions => {
  const raw = command.optsWithGlobals() as RawGlobalOptions;

  const rawBaseUrl = normalizeOptional(raw.baseUrl);
  if (!rawBaseUrl) {
    throw new CliConfigError("--base-url is required");
  }
  const baseUrl = ensureHttpUrl(rawBaseUrl, "--base-url");

  const timeoutMs =
    typeof raw.timeoutMs === "number"
      ? raw.timeoutMs
      : ensurePositiveInteger(String(raw.timeoutMs ?? "10000"), "--timeout-ms");

  const retries =
    typeof raw.retries === "number"
      ? raw.retries
      : ensureNonNegativeInteger(String(raw.retries ?? "1"), "--retries");

  return {
    baseUrl,
    token: normalizeOptional(raw.token),
    adminKey: normalizeOptional(raw.adminKey),
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
        throw new CliConfigError("missing token: use --token or AGENTRADE_TOKEN");
      }
      return options.token;
    },
    requireAdminKey: () => {
      if (!options.adminKey) {
        throw new CliConfigError("missing admin key: use --admin-key or AGENTRADE_ADMIN_SERVICE_KEY");
      }
      return options.adminKey;
    }
  };
};
