import { ApiClientError } from "@agentrade/sdk";
import { CliConfigError, CliExitCode, CliValidationError } from "./errors.js";

const CLI_SUCCESS_META = Symbol("cliSuccessMeta");

export interface StructuredCliWarning {
  code: string;
  level: "INFO" | "WARNING" | "CRITICAL";
  message: string;
  field?: string;
}

interface CliSuccessMeta<T> {
  [CLI_SUCCESS_META]: true;
  data: T;
  warnings?: StructuredCliWarning[];
}

export interface StructuredCliSuccess<T = unknown> {
  ok: true;
  command: string;
  data: T;
  warnings?: StructuredCliWarning[];
}

export interface StructuredCliError {
  type: "VALIDATION_ERROR" | "CONFIG_ERROR" | "API_ERROR" | "NETWORK_ERROR" | "UNKNOWN_ERROR";
  message: string;
  httpStatus: number | null;
  apiError: string | null;
  issues: unknown;
  retryable: boolean;
  command: string;
}

interface NormalizedErrorResult {
  output: StructuredCliError;
  exitCode: number;
}

export const withSuccessMeta = <T>(
  data: T,
  warnings?: StructuredCliWarning[]
): CliSuccessMeta<T> => ({
  [CLI_SUCCESS_META]: true,
  data,
  ...(warnings && warnings.length > 0 ? { warnings } : {})
});

const isCommanderError = (error: unknown): error is { message: string; code?: string; exitCode?: number } => {
  if (!error || typeof error !== "object") {
    return false;
  }
  const value = error as Record<string, unknown>;
  return typeof value.message === "string" && typeof value.code === "string" && value.code.startsWith("commander.");
};

export const shouldSuppressCommanderError = (error: unknown): boolean => {
  if (!isCommanderError(error)) {
    return false;
  }
  const exitCode = Number(error.exitCode ?? 1);
  return error.code === "commander.helpDisplayed" || exitCode === 0;
};

const messageOf = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const commandFromError = (error: unknown): string | undefined => {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const value = error as Record<string, unknown>;
  return typeof value.commandPath === "string" ? value.commandPath : undefined;
};

const isCliSuccessMeta = (value: unknown): value is CliSuccessMeta<unknown> => {
  if (!value || typeof value !== "object") {
    return false;
  }
  return (value as Partial<CliSuccessMeta<unknown>>)[CLI_SUCCESS_META] === true;
};

export const printSuccessJson = (value: unknown, pretty: boolean, command: string): void => {
  const envelope: StructuredCliSuccess =
    isCliSuccessMeta(value)
      ? {
          ok: true,
          command,
          data: value.data,
          ...(value.warnings && value.warnings.length > 0 ? { warnings: value.warnings } : {})
        }
      : {
          ok: true,
          command,
          data: value
        };
  process.stdout.write(`${JSON.stringify(envelope, null, pretty ? 2 : 0)}\n`);
};

export const printErrorJson = (value: StructuredCliError): void => {
  process.stderr.write(`${JSON.stringify(value)}\n`);
};

export const normalizeCliError = (error: unknown, fallbackCommand: string): NormalizedErrorResult => {
  const command = commandFromError(error) ?? fallbackCommand;

  if (error instanceof CliValidationError || isCommanderError(error)) {
    return {
      output: {
        type: "VALIDATION_ERROR",
        message: messageOf(error),
        httpStatus: null,
        apiError: null,
        issues: null,
        retryable: false,
        command
      },
      exitCode: CliExitCode.VALIDATION
    };
  }

  if (error instanceof CliConfigError) {
    return {
      output: {
        type: "CONFIG_ERROR",
        message: error.message,
        httpStatus: null,
        apiError: null,
        issues: null,
        retryable: false,
        command
      },
      exitCode: CliExitCode.CONFIG
    };
  }

  if (error instanceof ApiClientError) {
    if (error.apiError === "MISSING_BEARER_TOKEN" || error.apiError === "MISSING_ADMIN_KEY") {
      return {
        output: {
          type: "CONFIG_ERROR",
          message: error.message,
          httpStatus: null,
          apiError: error.apiError,
          issues: error.issues,
          retryable: false,
          command
        },
        exitCode: CliExitCode.CONFIG
      };
    }

    if (error.httpStatus !== null) {
      return {
        output: {
          type: "API_ERROR",
          message: error.message,
          httpStatus: error.httpStatus,
          apiError: error.apiError,
          issues: error.issues,
          retryable: error.retryable,
          command
        },
        exitCode: CliExitCode.API
      };
    }

    return {
      output: {
        type: "NETWORK_ERROR",
        message: error.message,
        httpStatus: null,
        apiError: error.apiError,
        issues: error.issues,
        retryable: error.retryable,
        command
      },
      exitCode: CliExitCode.NETWORK
    };
  }

  return {
    output: {
      type: "UNKNOWN_ERROR",
      message: messageOf(error),
      httpStatus: null,
      apiError: null,
      issues: null,
      retryable: false,
      command
    },
    exitCode: CliExitCode.UNKNOWN
  };
};
