import { z } from "zod";

export type SortOrder = "asc" | "desc";
export type CursorPrimitive = string | number | boolean | null;
export type CursorValues = Record<string, CursorPrimitive>;

type LegacyOffsetCursorPayload = {
  v: 1;
  kind: "offset";
  offset: number;
};

type KeysetCursorPayload = {
  v: 1;
  kind: "keyset";
  resource: string;
  sort?: string;
  order?: SortOrder;
  values: CursorValues;
  offset?: number;
};

type DecodedPayload = LegacyOffsetCursorPayload | KeysetCursorPayload;

export type ParsedCursor =
  | { mode: "start"; offset: 0 }
  | { mode: "legacy-offset"; offset: number }
  | {
      mode: "keyset";
      offset: number;
      resource: string;
      sort?: string;
      order?: SortOrder;
      values: CursorValues;
    };

const isSafeOffset = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

const parseOpaquePayload = (cursor: string): DecodedPayload => {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  return JSON.parse(decoded) as DecodedPayload;
};

const invalidCursorError = (message: string): z.ZodError =>
  new z.ZodError([
    {
      code: z.ZodIssueCode.custom,
      message,
      path: ["cursor"]
    }
  ]);

export const parseCursorOffset = (cursor: string | undefined): number => {
  if (!cursor) {
    return 0;
  }

  const legacyNumeric = Number(cursor);
  if (isSafeOffset(legacyNumeric)) {
    return legacyNumeric;
  }

  try {
    const payload = parseOpaquePayload(cursor);
    if (payload.kind === "offset" && isSafeOffset(payload.offset)) {
      return payload.offset;
    }
    if (payload.kind === "keyset" && isSafeOffset(payload.offset)) {
      return payload.offset;
    }
  } catch {
    // fall through to validation error
  }

  throw invalidCursorError(
    "cursor must be a non-negative integer string, opaque offset cursor, or opaque keyset cursor"
  );
};

export const parseListCursor = (
  cursor: string | undefined,
  input: {
    resource: string;
    sort?: string;
    order?: SortOrder;
  }
): ParsedCursor => {
  if (!cursor) {
    return { mode: "start", offset: 0 };
  }

  const legacyNumeric = Number(cursor);
  if (isSafeOffset(legacyNumeric)) {
    return { mode: "legacy-offset", offset: legacyNumeric };
  }

  try {
    const payload = parseOpaquePayload(cursor);
    if (payload.kind === "offset" && isSafeOffset(payload.offset)) {
      return { mode: "legacy-offset", offset: payload.offset };
    }

    if (
      payload.kind !== "keyset" ||
      payload.v !== 1 ||
      payload.resource !== input.resource ||
      !payload.values ||
      typeof payload.values !== "object" ||
      Array.isArray(payload.values)
    ) {
      throw invalidCursorError("cursor is not a valid keyset cursor");
    }

    if (input.sort && payload.sort && payload.sort !== input.sort) {
      throw invalidCursorError(`cursor sort mismatch: expected ${input.sort}, got ${payload.sort}`);
    }
    if (input.order && payload.order && payload.order !== input.order) {
      throw invalidCursorError(`cursor order mismatch: expected ${input.order}, got ${payload.order}`);
    }

    return {
      mode: "keyset",
      offset: isSafeOffset(payload.offset) ? payload.offset : 0,
      resource: payload.resource,
      sort: payload.sort,
      order: payload.order,
      values: payload.values
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw error;
    }
    throw invalidCursorError(
      "cursor must be a non-negative integer string, opaque offset cursor, or opaque keyset cursor"
    );
  }
};

export const encodeKeysetCursor = (input: {
  resource: string;
  values: CursorValues;
  offset: number;
  sort?: string;
  order?: SortOrder;
}): string =>
  Buffer.from(
    JSON.stringify({
      v: 1,
      kind: "keyset",
      resource: input.resource,
      sort: input.sort,
      order: input.order,
      values: input.values,
      offset: input.offset
    }),
    "utf8"
  ).toString("base64url");

export const clampPageLimit = (limit: number): number => Math.max(1, Math.min(100, limit));

export const nextCursorOffset = (cursor: ParsedCursor, consumedCount: number): number =>
  cursor.offset + consumedCount;
