import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { CliConfigError } from "./errors.js";

export const CLI_DEFAULT_BASE_URL = "https://agentrade.info/api";
export const CLI_DEFAULT_TIMEOUT_MS = 10000;
export const CLI_DEFAULT_RETRIES = 1;

export interface CliPersistedConfig {
  baseUrl?: string;
  token?: string;
  adminKey?: string;
  timeoutMs?: number;
  retries?: number;
}

export interface CliPersistedConfigSnapshot {
  path: string;
  exists: boolean;
  values: CliPersistedConfig;
}

export type CliPersistedConfigKey =
  | "baseUrl"
  | "token"
  | "adminKey"
  | "timeoutMs"
  | "retries";

const configError = (path: string, message: string): CliConfigError =>
  new CliConfigError(`invalid CLI config at ${path}: ${message}`);

const parseOptionalString = (
  raw: unknown,
  path: string,
  field: keyof Pick<CliPersistedConfig, "baseUrl" | "token" | "adminKey">
): string | undefined => {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw !== "string") {
    throw configError(path, `${field} must be a string`);
  }
  const value = raw.trim();
  return value.length > 0 ? value : undefined;
};

const parseOptionalInteger = (
  raw: unknown,
  path: string,
  field: keyof Pick<CliPersistedConfig, "timeoutMs" | "retries">
): number | undefined => {
  if (raw === undefined || raw === null) {
    return undefined;
  }

  if (typeof raw === "number") {
    if (!Number.isSafeInteger(raw)) {
      throw configError(path, `${field} must be a safe integer`);
    }
    return raw;
  }

  if (typeof raw !== "string") {
    throw configError(path, `${field} must be an integer`);
  }

  const value = raw.trim();
  if (value.length === 0) {
    return undefined;
  }
  if (!/^-?\d+$/.test(value)) {
    throw configError(path, `${field} must be an integer`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw configError(path, `${field} must be a safe integer`);
  }
  return parsed;
};

const parseCliPersistedConfig = (raw: unknown, path: string): CliPersistedConfig => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw configError(path, "root value must be a JSON object");
  }
  const input = raw as Record<string, unknown>;

  const parsed: CliPersistedConfig = {};
  const baseUrl = parseOptionalString(input.baseUrl, path, "baseUrl");
  const token = parseOptionalString(input.token, path, "token");
  const adminKey = parseOptionalString(input.adminKey, path, "adminKey");
  const timeoutMs = parseOptionalInteger(input.timeoutMs, path, "timeoutMs");
  const retries = parseOptionalInteger(input.retries, path, "retries");

  if (baseUrl !== undefined) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(baseUrl);
    } catch {
      throw configError(path, "baseUrl must be a valid URL");
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw configError(path, "baseUrl must start with http:// or https://");
    }
    parsed.baseUrl = baseUrl;
  }
  if (token !== undefined) {
    parsed.token = token;
  }
  if (adminKey !== undefined) {
    parsed.adminKey = adminKey;
  }
  if (timeoutMs !== undefined) {
    if (timeoutMs <= 0) {
      throw configError(path, "timeoutMs must be > 0");
    }
    parsed.timeoutMs = timeoutMs;
  }
  if (retries !== undefined) {
    if (retries < 0) {
      throw configError(path, "retries must be >= 0");
    }
    parsed.retries = retries;
  }

  return parsed;
};

const normalizeConfigForWrite = (values: CliPersistedConfig, path: string): CliPersistedConfig => {
  const normalized = parseCliPersistedConfig(values, path);
  const ordered: CliPersistedConfig = {};
  if (normalized.baseUrl !== undefined) {
    ordered.baseUrl = normalized.baseUrl;
  }
  if (normalized.token !== undefined) {
    ordered.token = normalized.token;
  }
  if (normalized.adminKey !== undefined) {
    ordered.adminKey = normalized.adminKey;
  }
  if (normalized.timeoutMs !== undefined) {
    ordered.timeoutMs = normalized.timeoutMs;
  }
  if (normalized.retries !== undefined) {
    ordered.retries = normalized.retries;
  }
  return ordered;
};

const writeCliPersistedConfig = (path: string, values: CliPersistedConfig): CliPersistedConfigSnapshot => {
  const normalized = normalizeConfigForWrite(values, path);
  if (Object.keys(normalized).length === 0) {
    if (existsSync(path)) {
      unlinkSync(path);
    }
    return {
      path,
      exists: false,
      values: {}
    };
  }

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(normalized, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });

  return {
    path,
    exists: true,
    values: normalized
  };
};

export const resolveCliConfigPath = (): string => {
  const explicit = process.env.AGENTRADE_CLI_CONFIG_PATH;
  if (explicit !== undefined) {
    const value = explicit.trim();
    if (value.length === 0) {
      throw new CliConfigError("AGENTRADE_CLI_CONFIG_PATH must be non-empty when set");
    }
    return isAbsolute(value) ? value : resolve(value);
  }

  const xdgBase = process.env.XDG_CONFIG_HOME?.trim();
  if (xdgBase) {
    return join(xdgBase, "agentrade", "config.json");
  }

  const home = homedir().trim();
  if (home.length === 0) {
    throw new CliConfigError("unable to resolve home directory for CLI config");
  }

  return join(home, ".agentrade", "config.json");
};

export const loadCliPersistedConfig = (): CliPersistedConfigSnapshot => {
  const path = resolveCliConfigPath();
  if (!existsSync(path)) {
    return {
      path,
      exists: false,
      values: {}
    };
  }

  let rawText: string;
  try {
    rawText = readFileSync(path, "utf8");
  } catch (error) {
    throw new CliConfigError(
      `unable to read CLI config at ${path}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (rawText.trim().length === 0) {
    return {
      path,
      exists: true,
      values: {}
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw new CliConfigError(
      `invalid CLI config JSON at ${path}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return {
    path,
    exists: true,
    values: parseCliPersistedConfig(parsed, path)
  };
};

export const setCliPersistedConfigValue = (
  key: CliPersistedConfigKey,
  value: string | number
): CliPersistedConfigSnapshot => {
  const current = loadCliPersistedConfig();
  const next: CliPersistedConfig = { ...current.values };
  switch (key) {
    case "baseUrl":
      next.baseUrl = String(value);
      break;
    case "token":
      next.token = String(value);
      break;
    case "adminKey":
      next.adminKey = String(value);
      break;
    case "timeoutMs":
      next.timeoutMs = Number(value);
      break;
    case "retries":
      next.retries = Number(value);
      break;
    default: {
      const exhaustive: never = key;
      throw new CliConfigError(`unsupported CLI config key: ${String(exhaustive)}`);
    }
  }
  return writeCliPersistedConfig(current.path, next);
};

export const unsetCliPersistedConfigKeys = (
  keys: readonly CliPersistedConfigKey[]
): CliPersistedConfigSnapshot => {
  const current = loadCliPersistedConfig();
  const next: CliPersistedConfig = { ...current.values };
  for (const key of keys) {
    delete next[key];
  }
  return writeCliPersistedConfig(current.path, next);
};

export const clearCliPersistedConfig = (): CliPersistedConfigSnapshot => {
  const current = loadCliPersistedConfig();
  return writeCliPersistedConfig(current.path, {});
};
