import assert from "node:assert/strict";

export interface CliSuccessWarning {
  code: string;
  level: "INFO" | "WARNING" | "CRITICAL";
  message: string;
  field?: string;
}

export interface CliSuccessEnvelope<T = unknown> {
  ok: true;
  command: string;
  data: T;
  warnings?: CliSuccessWarning[];
}

export const parseCliSuccessEnvelope = <T = unknown>(stdout: string): CliSuccessEnvelope<T> => {
  const trimmed = stdout.trim();
  assert.ok(trimmed.length > 0, "stdout must contain JSON");
  return JSON.parse(trimmed) as CliSuccessEnvelope<T>;
};

export const unwrapCliSuccess = <T = unknown>(stdout: string): T => {
  return parseCliSuccessEnvelope<T>(stdout).data;
};
