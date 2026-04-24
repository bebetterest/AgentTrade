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
const PERSISTED_SECRET_ENCRYPTED_PREFIX = "enc:v1:";
const PERSISTED_SECRET_KEY_BYTES = 32;
const PERSISTED_SECRET_IV_BYTES = 12;
const PERSISTED_SECRET_TAG_BYTES = 16;
const PERSISTED_SECRET_CIPHER = "aes-256-gcm";
const PERSISTED_SECRET_KEY_FILENAME = "wallet.key";

const resolvePersistedSecretKeyPath = (configPath: string): string =>
  join(dirname(configPath), PERSISTED_SECRET_KEY_FILENAME);

export const isStoredCliSecretEncrypted = (value: string): boolean =>
  value.startsWith(PERSISTED_SECRET_ENCRYPTED_PREFIX);

const readPersistedSecretKey = (configPath: string, createIfMissing: boolean): Buffer => {
  const keyPath = resolvePersistedSecretKeyPath(configPath);
  if (existsSync(keyPath)) {
    let key: Buffer;
    try {
      key = readFileSync(keyPath);
    } catch (error) {
      throw new CliConfigError(
        `unable to read CLI secret key at ${keyPath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (key.length !== PERSISTED_SECRET_KEY_BYTES) {
      throw new CliConfigError(
        `invalid CLI secret key at ${keyPath}: expected ${PERSISTED_SECRET_KEY_BYTES} bytes`
      );
    }
    return key;
  }
  if (!createIfMissing) {
    throw new CliConfigError(
      `missing CLI secret key at ${keyPath}: cannot decrypt persisted secrets; rerun \`agentrade auth register\` or rewrite encrypted secrets with \`agentrade config set token --value-file <path>\`, \`agentrade config set admin-key --value-file <path>\`, or \`agentrade config set wallet-private-key --value-file <path>\``
    );
  }

  const key = randomBytes(PERSISTED_SECRET_KEY_BYTES);
  try {
    mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 });
  } catch (error) {
    throw new CliConfigError(
      `unable to create CLI secret key directory at ${dirname(keyPath)}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  try {
    writeFileSync(keyPath, key, {
      mode: 0o600
    });
  } catch (error) {
    throw new CliConfigError(
      `unable to write CLI secret key at ${keyPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return key;
};

const parseEncryptedPayload = (raw: string, path: string): Buffer => {
  if (!raw.startsWith(PERSISTED_SECRET_ENCRYPTED_PREFIX)) {
    throw configError(path, "persisted secret must use encrypted format enc:v1");
  }
  const payload = raw.slice(PERSISTED_SECRET_ENCRYPTED_PREFIX.length);
  let decoded: Buffer;
  try {
    decoded = Buffer.from(payload, "base64");
  } catch {
    throw configError(path, "persisted secret encrypted payload is invalid");
  }
  if (decoded.length <= PERSISTED_SECRET_IV_BYTES + PERSISTED_SECRET_TAG_BYTES) {
    throw configError(path, "persisted secret encrypted payload is too short");
  }
  return decoded;
};

const encryptPersistedSecret = (value: string, configPath: string): string => {
  const key = readPersistedSecretKey(configPath, true);
  const iv = randomBytes(PERSISTED_SECRET_IV_BYTES);
  const cipher = createCipheriv(PERSISTED_SECRET_CIPHER, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, encrypted]).toString("base64");
  return `${PERSISTED_SECRET_ENCRYPTED_PREFIX}${payload}`;
};

const decryptPersistedSecret = (encryptedValue: string, configPath: string): string => {
  const decoded = parseEncryptedPayload(encryptedValue, configPath);
  const iv = decoded.subarray(0, PERSISTED_SECRET_IV_BYTES);
  const tag = decoded.subarray(
    PERSISTED_SECRET_IV_BYTES,
    PERSISTED_SECRET_IV_BYTES + PERSISTED_SECRET_TAG_BYTES
  );
  const encrypted = decoded.subarray(PERSISTED_SECRET_IV_BYTES + PERSISTED_SECRET_TAG_BYTES);
  const key = readPersistedSecretKey(configPath, false);
  try {
    const decipher = createDecipheriv(PERSISTED_SECRET_CIPHER, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    throw new CliConfigError(
      "failed to decrypt persisted CLI secret: local key material is invalid or does not match this config; rerun `agentrade auth register` or rewrite the affected secret with `agentrade config set token --value-file <path>`, `agentrade config set admin-key --value-file <path>`, or `agentrade config set wallet-private-key --value-file <path>`"
    );
  }
};

const removePersistedSecretKeyFile = (configPath: string): void => {
  const keyPath = resolvePersistedSecretKeyPath(configPath);
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
      `unable to remove CLI secret key at ${keyPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

export const resolveStoredCliSecret = (
  value: string | undefined,
  configPath: string
): string | undefined => {
  if (!value) {
    return undefined;
  }
  return isStoredCliSecretEncrypted(value) ? decryptPersistedSecret(value, configPath) : value;
};

export const resolveStoredWalletPrivateKey = (
  value: string | undefined,
  configPath: string
): `0x${string}` | undefined => {
  const resolved = resolveStoredCliSecret(value, configPath);
  if (!resolved) {
    return undefined;
  }
  if (!WALLET_PRIVATE_KEY_REGEX.test(resolved)) {
    throw new CliConfigError("decrypted wallet private key is invalid");
  }
  return resolved as `0x${string}`;
};

const configError = (path: string, message: string): CliConfigError =>
  new CliConfigError(`invalid CLI config at ${path}: ${message}`);

const hasEncryptedPersistedSecrets = (values: CliPersistedConfig): boolean =>
  [values.token, values.adminKey, values.walletPrivateKey].some(
    (value) => typeof value === "string" && isStoredCliSecretEncrypted(value)
  );

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
    if (isStoredCliSecretEncrypted(token)) {
      parseEncryptedPayload(token, path);
    }
    parsed.token = token;
  }
  if (adminKey !== undefined) {
    if (isStoredCliSecretEncrypted(adminKey)) {
      parseEncryptedPayload(adminKey, path);
    }
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
        "plaintext walletPrivateKey is unsupported; remove the walletPrivateKey field or delete the CLI config file, then recreate encrypted wallet config with `agentrade auth register` or `agentrade config set wallet-private-key --value-file <path>`"
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
      try {
        unlinkSync(path);
      } catch (error) {
        throw new CliConfigError(
          `unable to remove CLI config at ${path}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    return {
      path,
      exists: false,
      values: {}
    };
  }

  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  } catch (error) {
    throw new CliConfigError(
      `unable to create CLI config directory at ${dirname(path)}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  try {
    writeFileSync(path, `${JSON.stringify(normalized, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
  } catch (error) {
    throw new CliConfigError(
      `unable to write CLI config at ${path}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

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
      next.token = encryptPersistedSecret(String(value), current.path);
      break;
    case "adminKey":
      next.adminKey = encryptPersistedSecret(String(value), current.path);
      break;
    case "walletAddress":
      next.walletAddress = String(value);
      break;
    case "walletPrivateKey":
      next.walletPrivateKey = encryptPersistedSecret(String(value), current.path);
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
  if (!hasEncryptedPersistedSecrets(next)) {
    removePersistedSecretKeyFile(current.path);
  }
  return writeCliPersistedConfig(current.path, next);
};

export const clearCliPersistedConfig = (): CliPersistedConfigSnapshot => {
  const current = loadCliPersistedConfig();
  removePersistedSecretKeyFile(current.path);
  return writeCliPersistedConfig(current.path, {});
};
