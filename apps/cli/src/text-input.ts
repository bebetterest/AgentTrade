import { readFileSync } from "node:fs";
import { CliValidationError } from "./errors.js";

const stripLeadingBom = (value: string): string => value.replace(/^\uFEFF/, "");

interface BaseFileBackedInputOptions {
  inlineValue?: string;
  filePath?: string;
  inlineFlag: string;
  fileFlag?: string;
  allowEmpty?: boolean;
  normalize?: (value: string) => string;
}

interface RequiredFileBackedInputOptions extends BaseFileBackedInputOptions {
  required?: true;
}

interface OptionalFileBackedInputOptions extends BaseFileBackedInputOptions {
  required: false;
}

interface BaseTextInputOptions {
  inlineValue?: string;
  filePath?: string;
  fieldName: string;
  allowEmpty?: boolean;
}

interface RequiredTextInputOptions extends BaseTextInputOptions {
  required?: true;
}

interface OptionalTextInputOptions extends BaseTextInputOptions {
  required: false;
}

export function resolveFileBackedInput(options: RequiredFileBackedInputOptions): string;
export function resolveFileBackedInput(options: OptionalFileBackedInputOptions): string | undefined;
export function resolveFileBackedInput(
  options: RequiredFileBackedInputOptions | OptionalFileBackedInputOptions
): string | undefined {
  const {
    inlineValue,
    filePath,
    inlineFlag,
    fileFlag = `${inlineFlag}-file`,
    required = true,
    allowEmpty = false,
    normalize
  } = options;

  if (inlineValue !== undefined && filePath !== undefined) {
    throw new CliValidationError(`--${inlineFlag} and --${fileFlag} are mutually exclusive`);
  }

  let value: string | undefined;
  if (filePath !== undefined) {
    try {
      value = readFileSync(filePath, "utf8");
    } catch (error) {
      throw new CliValidationError(
        `failed to read --${fileFlag}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  } else {
    value = inlineValue;
  }

  const normalizedValue = value === undefined ? undefined : (normalize ? normalize(value) : value);

  if (normalizedValue === undefined) {
    if (required) {
      throw new CliValidationError(`--${inlineFlag} or --${fileFlag} is required`);
    }
    return undefined;
  }

  if (!allowEmpty && normalizedValue.trim().length === 0) {
    throw new CliValidationError(`--${filePath !== undefined ? fileFlag : inlineFlag} must be non-empty`);
  }

  return normalizedValue;
}

export function resolveTextInput(options: RequiredTextInputOptions): string;
export function resolveTextInput(options: OptionalTextInputOptions): string | undefined;
export function resolveTextInput(
  options: RequiredTextInputOptions | OptionalTextInputOptions
): string | undefined {
  const { inlineValue, filePath, fieldName, required = true, allowEmpty = false } = options;
  if (required === false) {
    return resolveFileBackedInput({
      inlineValue,
      filePath,
      inlineFlag: fieldName,
      required: false,
      allowEmpty,
      normalize: stripLeadingBom
    });
  }

  return resolveFileBackedInput({
    inlineValue,
    filePath,
    inlineFlag: fieldName,
    allowEmpty,
    normalize: stripLeadingBom
  });
}
