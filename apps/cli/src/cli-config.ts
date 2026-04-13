import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
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
  walletAddress?: string;
  walletPrivateKey?: string;
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
  | "walletAddress"
  | "walletPrivateKey"
  | "timeoutMs"
  | "retries";

const WALLET_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const WALLET_PRIVATE_KEY_REGEX = /^0x[a-fA-F0-9]{64}$/;
const WALLET_PRIVATE_KEY_ENCRYPTED_PREFIX = "enc:v1:";
const WALLET_PRIVATE_KEY_KEY_BYTES = 32;
const WALLET_PRIVATE_KEY_IV_BYTES = 12;
const WALLET_PRIVATE_KEY_TAG_BYTES = 16;
const WALLET_PRIVATE_KEY_CIPHER = "aes-256-gcm";
const WALLET_KEY_FILENAME = "wallet.key";

const resolveWalletKeyPath = (configPath: string): string => join(dirname(configPath), WALLET_KEY_FILENAME);

const readWalletKey = (configPath: string, createIfMissing: boolean): Buffer => {
  const keyPath = resolveWalletKeyPath(configPath);
  if (existsSync(keyPath)) {
    let key: Buffer;
    try {
      key = readFileSync(keyPath);
    } catch (error) {
      throw new CliConfigError(
        `unable to read wallet key at ${keyPath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (key.length !== WALLET_PRIVATE_KEY_KEY_BYTES) {
      throw new CliConfigError(
        `invalid wallet key at ${keyPath}: expected ${WALLET_PRIVATE_KEY_KEY_BYTES} bytes`
      );
    }
    return key;
  }
  if (!createIfMissing) {
    throw new CliConfigError(
      `missing wallet key at ${keyPath}: cannot decrypt wallet private key; run auth register or config set wallet-private-key`
    );
  }

  const key = randomBytes(WALLET_PRIVATE_KEY_KEY_BYTES);
  mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(keyPath, key, {
      mode: 0o600
    });
  } catch (error) {
    throw new CliConfigError(
      `unable to write wallet key at ${keyPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return key;
};

const parseEncryptedPayload = (raw: string, path: string): Buffer => {
  if (!raw.startsWith(WALLET_PRIVATE_KEY_ENCRYPTED_PREFIX)) {
    throw configError(path, "walletPrivateKey must use encrypted format enc:v1");
  }
  const payload = raw.slice(WALLET_PRIVATE_KEY_ENCRYPTED_PREFIX.length);
  let decoded: Buffer;
  try {
    decoded = Buffer.from(payload, "base64");
  } catch {
    throw configError(path, "walletPrivateKey encrypted payload is invalid");
  }
  if (decoded.length <= WALLET_PRIVATE_KEY_IV_BYTES + WALLET_PRIVATE_KEY_TAG_BYTES) {
    throw configError(path, "walletPrivateKey encrypted payload is too short");
  }
  return decoded;
};

const encryptWalletPrivateKey = (privateKey: string, configPath: string): string => {
  const key = readWalletKey(configPath, true);
  const iv = randomBytes(WALLET_PRIVATE_KEY_IV_BYTES);
  const cipher = createCipheriv(WALLET_PRIVATE_KEY_CIPHER, key, iv);
  const encrypted = Buffer.concat([cipher.update(privateKey, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, encrypted]).toString("base64");
  return `${WALLET_PRIVATE_KEY_ENCRYPTED_PREFIX}${payload}`;
};

const decryptWalletPrivateKey = (encryptedValue: string, configPath: string): string => {
  const decoded = parseEncryptedPayload(encryptedValue, configPath);
  const iv = decoded.subarray(0, WALLET_PRIVATE_KEY_IV_BYTES);
  const tag = decoded.subarray(
    WALLET_PRIVATE_KEY_IV_BYTES,
    WALLET_PRIVATE_KEY_IV_BYTES + WALLET_PRIVATE_KEY_TAG_BYTES
  );
  const encrypted = decoded.subarray(WALLET_PRIVATE_KEY_IV_BYTES + WALLET_PRIVATE_KEY_TAG_BYTES);
  const key = readWalletKey(configPath, false);
  try {
    const decipher = createDecipheriv(WALLET_PRIVATE_KEY_CIPHER, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    throw new CliConfigError(
      "failed to decrypt wallet private key: local key material is invalid or does not match this config"
    );
  }
};

const removeWalletKeyFile = (configPath: string): void => {
  const keyPath = resolveWalletKeyPath(configPath);
  if (!existsSync(keyPath)) {
    return;
  }
  try {
    unlinkSync(keyPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return;
    }
    throw new CliConfigError(
      `unable to remove wallet key at ${keyPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

export const resolveStoredWalletPrivateKey = (
  value: string | undefined,
  configPath: string
): `0x${string}` | undefined => {
  if (!value) {
    return undefined;
  }
  const decrypted = decryptWalletPrivateKey(value, configPath);
  if (!WALLET_PRIVATE_KEY_REGEX.test(decrypted)) {
    throw new CliConfigError("decrypted wallet private key is invalid");
  }
  return decrypted as `0x${string}`;
};

const configError = (path: string, message: string): CliConfigError =>
  new CliConfigError(`invalid CLI config at ${path}: ${message}`);

const parseOptionalString = (
  raw: unknown,
  path: string,
  field: keyof Pick<
    CliPersistedConfig,
    "baseUrl" | "token" | "adminKey" | "walletAddress" | "walletPrivateKey"
  >
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

const parseCliPersistedConfig = (
  raw: unknown,
  path: string
): CliPersistedConfig => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw configError(path, "root value must be a JSON object");
  }
  const input = raw as Record<string, unknown>;

  const parsed: CliPersistedConfig = {};
  const baseUrl = parseOptionalString(input.baseUrl, path, "baseUrl");
  const token = parseOptionalString(input.token, path, "token");
  const adminKey = parseOptionalString(input.adminKey, path, "adminKey");
  const walletAddress = parseOptionalString(input.walletAddress, path, "walletAddress");
  const walletPrivateKey = parseOptionalString(input.walletPrivateKey, path, "walletPrivateKey");
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
  if (walletAddress !== undefined) {
    if (!WALLET_ADDRESS_REGEX.test(walletAddress)) {
      throw configError(path, "walletAddress must be a valid EVM address");
    }
    parsed.walletAddress = walletAddress;
  }
  if (walletPrivateKey !== undefined) {
    if (WALLET_PRIVATE_KEY_REGEX.test(walletPrivateKey)) {
      throw configError(
        path,
        "walletPrivateKey must not be plaintext; run `agentrade config set wallet-private-key <private-key>`"
      );
    }
    parseEncryptedPayload(walletPrivateKey, path);
    parsed.walletPrivateKey = walletPrivateKey;
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
  if (normalized.walletAddress !== undefined) {
    ordered.walletAddress = normalized.walletAddress;
  }
  if (normalized.walletPrivateKey !== undefined) {
    ordered.walletPrivateKey = normalized.walletPrivateKey;
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
    case "walletAddress":
      next.walletAddress = String(value);
      break;
    case "walletPrivateKey":
      next.walletPrivateKey = encryptWalletPrivateKey(String(value), current.path);
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
  if (keys.includes("walletPrivateKey")) {
    delete next.walletPrivateKey;
    removeWalletKeyFile(current.path);
  }
  return writeCliPersistedConfig(current.path, next);
};

export const clearCliPersistedConfig = (): CliPersistedConfigSnapshot => {
  const current = loadCliPersistedConfig();
  removeWalletKeyFile(current.path);
  return writeCliPersistedConfig(current.path, {});
};
