import { ApiClientError } from "@agentrade/sdk";
import { CliConfigError, CliExitCode, CliValidationError } from "./errors.js";

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

export const printJson = (value: unknown, pretty: boolean): void => {
  process.stdout.write(`${JSON.stringify(value, null, pretty ? 2 : 0)}\n`);
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
