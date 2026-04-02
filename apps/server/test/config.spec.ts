import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("runtime config hardening", () => {
  it("rejects placeholder JWT secret outside test env", async () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "production",
      JWT_SECRET: "replace-this-secret",
      ADMIN_SERVICE_KEY: "real-admin-key",
      ENABLE_PERSISTENCE: "false",
      ENABLE_REDIS_RATE_LIMIT: "false"
    };

    await expect(buildApp()).rejects.toThrow("JWT_SECRET");
  });

  it("rejects placeholder admin service key outside test env", async () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "production",
      JWT_SECRET: "real-jwt-secret",
      ADMIN_SERVICE_KEY: "replace-this-admin-key",
      ENABLE_PERSISTENCE: "false",
      ENABLE_REDIS_RATE_LIMIT: "false"
    };

    await expect(buildApp()).rejects.toThrow("ADMIN_SERVICE_KEY");
  });
});
