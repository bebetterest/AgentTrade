import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import jwt from "jsonwebtoken";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  apiOperations,
  buildOpenApiDocument,
  getApiOperation,
  v2ApiErrorEnvelopeSchema
} from "@agentrade/contracts";
import type { Address } from "@agentrade/types";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { toServerRoutePath } from "../src/api/services.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../../..");

const addr = (seed: string): Address =>
  `0x${Buffer.from(seed).toString("hex").slice(0, 40).padEnd(40, "0")}` as Address;

const futureDeadline = (hours = 24): string =>
  new Date(Date.now() + hours * 3_600_000).toISOString();

const serialize = (document: unknown): string => `${JSON.stringify(document, null, 2)}\n`;

describe("contract registry", () => {
  it("keeps every public operation fully declared", () => {
    const operationIds = new Set<string>();

    for (const operation of apiOperations) {
      expect(operation.operationId.length).toBeGreaterThan(0);
      expect(operationIds.has(operation.operationId)).toBe(false);
      operationIds.add(operation.operationId);

      expect(operation.pathTemplate === "/health" || /^\/v[12]\//.test(operation.pathTemplate)).toBe(true);
      expect(operation.responseSchema).toBeDefined();
      expect(operation.responseComponent).toBeDefined();
      expect(operation.errorStatuses?.length ?? 0).toBeGreaterThan(0);
      expect(operation.errorEnvelope).toBe(operation.version);

      if (operation.pathParamsSchema) {
        expect(operation.pathTemplate).toMatch(/\{[^}]+\}/);
      }

      if (operation.bodySchema) {
        expect(operation.requestBodyComponent).toBeDefined();
      }

      if (operation.version === "v1") {
        expect(operation.deprecated).toBe(true);
      } else {
        expect(operation.deprecated ?? false).toBe(false);
      }
    }
  });

  it("keeps every v1 contract paired with a v2 contract carrying the same semantics", () => {
    const grouped = new Map<
      string,
      {
        v1?: (typeof apiOperations)[number];
        v2?: (typeof apiOperations)[number];
      }
    >();

    for (const operation of apiOperations) {
      const key = operation.operationId.replace(/V[12]$/, "");
      const entry = grouped.get(key) ?? {};
      entry[operation.version] = operation;
      grouped.set(key, entry);
    }

    for (const [key, pair] of grouped) {
      expect(pair.v1, `missing v1 contract for ${key}`).toBeDefined();
      expect(pair.v2, `missing v2 contract for ${key}`).toBeDefined();

      const v1 = pair.v1!;
      const v2 = pair.v2!;
      expect(v1.method).toBe(v2.method);
      expect(v1.tag).toBe(v2.tag);
      expect(v1.auth).toBe(v2.auth);
      expect(Boolean(v1.bodySchema)).toBe(Boolean(v2.bodySchema));
      expect(Boolean(v1.pathParamsSchema)).toBe(Boolean(v2.pathParamsSchema));
    }
  });

  it("keeps generated OpenAPI artifacts in sync with docs", () => {
    expect(readFileSync(resolve(repoRoot, "docs/api/openapi.yaml"), "utf8")).toBe(
      serialize(buildOpenApiDocument("en"))
    );
    expect(readFileSync(resolve(repoRoot, "docs/api/openapi_cn.yaml"), "utf8")).toBe(
      serialize(buildOpenApiDocument("zh"))
    );
  });
});

describe("v2 response contracts", () => {
  let app: FastifyInstance | null = null;
  const secret = "contract-test-secret";
  const adminKey = "contract-test-admin-key";
  const oldEnv = { ...process.env };

  beforeAll(() => {
    process.env.JWT_SECRET = secret;
    process.env.ADMIN_SERVICE_KEY = adminKey;
    process.env.ENABLE_PERSISTENCE = "false";
    process.env.ENABLE_REDIS_RATE_LIMIT = "false";
    process.env.RATE_LIMIT_PER_MINUTE = "10000";
    process.env.RATE_LIMIT_BURST = "10000";
  });

  beforeEach(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  afterAll(() => {
    process.env = oldEnv;
  });

  it("registers every declared contract as a server route", async () => {
    for (const operation of apiOperations) {
      expect(
        app!.hasRoute({
          method: operation.method,
          url: toServerRoutePath(operation.pathTemplate)
        }),
        `missing route for ${operation.operationId}`
      ).toBe(true);
    }
  });

  it("returns v2 payloads that match declared success and error schemas", async () => {
    const publisher = addr("contract-publisher-1");
    const token = jwt.sign({ sub: publisher }, secret, { expiresIn: "1h" });

    const createResponse = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: "contract-task",
        descriptionMd: "desc",
        acceptanceCriteria: "criteria",
        deadlineUtc: futureDeadline(),
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    expect(createResponse.statusCode).toBe(200);
    const createdTask = getApiOperation("tasksCreateV2").responseSchema.parse(createResponse.json()) as {
      id: string;
    };

    const listResponse = await app!.inject({
      method: "GET",
      url: "/v2/tasks?limit=1"
    });
    expect(listResponse.statusCode).toBe(200);
    getApiOperation("tasksListV2").responseSchema.parse(listResponse.json());

    const getResponse = await app!.inject({
      method: "GET",
      url: `/v2/tasks/${createdTask.id}`
    });
    expect(getResponse.statusCode).toBe(200);
    getApiOperation("tasksGetV2").responseSchema.parse(getResponse.json());

    const missingResponse = await app!.inject({
      method: "GET",
      url: "/v2/tasks/task-does-not-exist"
    });
    expect(missingResponse.statusCode).toBe(404);
    const errorPayload = v2ApiErrorEnvelopeSchema.schema.parse(missingResponse.json());
    expect(errorPayload.error.code).toBe("TASK_NOT_FOUND");
    expect(errorPayload.error.requestId.length).toBeGreaterThan(0);
    expect(errorPayload.error.retryable).toBe(false);
  });
});
