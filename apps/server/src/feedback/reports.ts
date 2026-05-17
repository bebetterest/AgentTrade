import { nanoid } from "nanoid";
import type {
  Address,
  FeedbackReport,
  FeedbackReportType,
  PaginatedResponse
} from "@agentrade/types";
import {
  clampPageLimit,
  encodeKeysetCursor,
  nextCursorOffset,
  parseListCursor
} from "../pagination/cursor.js";

export const FEEDBACK_REPORT_RESOURCE = "feedback-reports";

export interface FeedbackReportCreateInput {
  type: FeedbackReportType;
  title: string;
  bodyMd: string;
  reporterAddress: Address;
  createdAt?: Date;
}

export interface FeedbackReportQuery {
  cursor?: string;
  limit: number;
  type?: FeedbackReportType;
  reporter?: Address;
}

const toIso = (value: Date): string => value.toISOString();

export const buildFeedbackReportRecord = (
  input: FeedbackReportCreateInput
): FeedbackReport => ({
  id: nanoid(),
  type: input.type,
  title: input.title,
  bodyMd: input.bodyMd,
  reporterAddress: input.reporterAddress,
  createdAt: toIso(input.createdAt ?? new Date())
});

const compareCreatedDesc = (
  left: { createdAt: string; id: string },
  right: { createdAt: string; id: string }
): number => {
  const delta = right.createdAt.localeCompare(left.createdAt);
  if (delta !== 0) {
    return delta;
  }
  return right.id.localeCompare(left.id);
};

export class InMemoryFeedbackReportStore {
  private readonly reports: FeedbackReport[] = [];

  create(input: FeedbackReportCreateInput): FeedbackReport {
    const record = buildFeedbackReportRecord(input);
    this.reports.push(record);
    return record;
  }

  get(id: string): FeedbackReport | null {
    return this.reports.find((item) => item.id === id) ?? null;
  }

  query(input: FeedbackReportQuery): PaginatedResponse<FeedbackReport> {
    const cursor = parseListCursor(input.cursor, {
      resource: FEEDBACK_REPORT_RESOURCE,
      sort: "createdAt",
      order: "desc"
    });
    const boundedLimit = clampPageLimit(input.limit);
    const filtered = this.reports
      .filter((item) => {
        if (input.type && item.type !== input.type) {
          return false;
        }
        if (
          input.reporter &&
          item.reporterAddress.toLowerCase() !== input.reporter.toLowerCase()
        ) {
          return false;
        }
        return true;
      })
      .sort(compareCreatedDesc);

    const startIndex =
      cursor.mode === "legacy-offset"
        ? Math.min(cursor.offset, filtered.length)
        : cursor.mode === "keyset"
          ? filtered.findIndex((item) => {
              const cursorId = cursor.values.id;
              const cursorPrimary = cursor.values.primary;
              if (typeof cursorId !== "string" || typeof cursorPrimary !== "string") {
                return false;
              }
              if (item.createdAt < cursorPrimary) {
                return true;
              }
              return item.createdAt === cursorPrimary && item.id < cursorId;
            })
          : 0;
    const normalizedStart = startIndex < 0 ? filtered.length : startIndex;
    const pageWithSentinel = filtered.slice(normalizedStart, normalizedStart + boundedLimit + 1);
    const hasMore = pageWithSentinel.length > boundedLimit;
    const items = hasMore ? pageWithSentinel.slice(0, boundedLimit) : pageWithSentinel;
    const nextCursor =
      hasMore && items.length > 0
        ? encodeKeysetCursor({
            resource: FEEDBACK_REPORT_RESOURCE,
            sort: "createdAt",
            order: "desc",
            offset: nextCursorOffset(cursor, items.length),
            values: {
              primary: items[items.length - 1]!.createdAt,
              id: items[items.length - 1]!.id
            }
          })
        : null;

    return { items, nextCursor };
  }
}
