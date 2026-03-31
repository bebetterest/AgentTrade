import { readFileSync } from "node:fs";
import { CliValidationError } from "./errors.js";

interface TextInputOptions {
  inlineValue?: string;
  filePath?: string;
  fieldName: string;
  required?: boolean;
  allowEmpty?: boolean;
}

export const resolveTextInput = (options: TextInputOptions): string | undefined => {
  const { inlineValue, filePath, fieldName, required = true, allowEmpty = false } = options;

  if (inlineValue !== undefined && filePath !== undefined) {
    throw new CliValidationError(`--${fieldName} and --${fieldName}-file are mutually exclusive`);
  }

  let value: string | undefined;
  if (filePath !== undefined) {
    try {
      value = readFileSync(filePath, "utf8");
    } catch (error) {
      throw new CliValidationError(
        `failed to read --${fieldName}-file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  } else {
    value = inlineValue;
  }

  if (value === undefined) {
    if (required) {
      throw new CliValidationError(`--${fieldName} or --${fieldName}-file is required`);
    }
    return undefined;
  }

  if (!allowEmpty && value.trim().length === 0) {
    throw new CliValidationError(`--${fieldName} must be non-empty`);
  }

  return value;
};
