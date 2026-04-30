import { describe, expect, it } from "vitest";
import { defaultConfig, loadConfig } from "@agentrade/config";

const withEnv = <T>(
  patch: Record<string, string | undefined>,
  operation: () => T
): T => {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return operation();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
};

describe("runtime config weight validation", () => {
  it("accepts default score and reputation weight groups", () => {
    const config = withEnv(
      {
        REPUTATION_WEIGHT_PUBLISHER_BPS: undefined,
        REPUTATION_WEIGHT_WORKER_BPS: undefined,
        REPUTATION_WEIGHT_SUPERVISOR_BPS: undefined,
        SCORE_WEIGHT_REPUTATION_BPS: undefined,
        SCORE_WEIGHT_COMPLETION_BPS: undefined,
        SCORE_WEIGHT_QUALITY_BPS: undefined
      },
      () => loadConfig()
    );

    expect(config.reputationWeightPublisherBps).toBe(defaultConfig.reputationWeightPublisherBps);
    expect(config.scoreWeightReputationBps).toBe(defaultConfig.scoreWeightReputationBps);
  });

  it("rejects invalid reputation weight sum", () => {
    expect(() =>
      withEnv(
        {
          REPUTATION_WEIGHT_PUBLISHER_BPS: "3000",
          REPUTATION_WEIGHT_WORKER_BPS: "3000",
          REPUTATION_WEIGHT_SUPERVISOR_BPS: "3000"
        },
        () => loadConfig()
      )
    ).toThrow(/REPUTATION_WEIGHT_\*_BPS/);
  });

  it("rejects negative score weight", () => {
    expect(() =>
      withEnv(
        {
          SCORE_WEIGHT_REPUTATION_BPS: "-1",
          SCORE_WEIGHT_COMPLETION_BPS: "7000",
          SCORE_WEIGHT_QUALITY_BPS: "3001"
        },
        () => loadConfig()
      )
    ).toThrow(/SCORE_WEIGHT_REPUTATION_BPS must be >= 0/);
  });

  it("rejects non-integer score weights", () => {
    expect(() =>
      withEnv(
        {
          SCORE_WEIGHT_REPUTATION_BPS: "4500.5",
          SCORE_WEIGHT_COMPLETION_BPS: "3499.5",
          SCORE_WEIGHT_QUALITY_BPS: "2000"
        },
        () => loadConfig()
      )
    ).toThrow(/must be an integer/);
  });
});

describe("runtime config strict parsing", () => {
  it("rejects invalid numeric values for critical fields", () => {
    expect(() =>
      withEnv(
        {
          RATE_LIMIT_PER_MINUTE: "not-a-number"
        },
        () => loadConfig()
      )
    ).toThrow(/RATE_LIMIT_PER_MINUTE/);
  });

  it("rejects invalid boolean values for critical fields", () => {
    expect(() =>
      withEnv(
        {
          TRUST_PROXY: "definitely"
        },
        () => loadConfig()
      )
    ).toThrow(/TRUST_PROXY/);
  });

  it("accepts explicit log configuration overrides", () => {
    const config = withEnv(
      {
        LOG_LEVEL: "debug",
        ENABLE_REQUEST_LOG_PERSISTENCE: "false",
        ENABLE_AUDIT_LOG_PERSISTENCE: "true",
        REQUEST_LOG_RETENTION_DAYS: "14",
        AUDIT_LOG_RETENTION_DAYS: "90",
        LOG_CLEANUP_INTERVAL_MINUTES: "15",
        LOG_CLEANUP_BATCH_SIZE: "25",
        SERVER_RUNTIME_ROLE: "worker",
        CYCLE_CLOSE_POLL_INTERVAL_MS: "250",
        REQUEST_LOG_BATCH_SIZE: "50",
        REQUEST_LOG_FLUSH_INTERVAL_MS: "25",
        REQUEST_LOG_BUFFER_CAPACITY: "500"
      },
      () => loadConfig()
    );
    expect(config.logLevel).toBe("debug");
    expect(config.enableRequestLogPersistence).toBe(false);
    expect(config.enableAuditLogPersistence).toBe(true);
    expect(config.requestLogRetentionDays).toBe(14);
    expect(config.auditLogRetentionDays).toBe(90);
    expect(config.logCleanupIntervalMinutes).toBe(15);
    expect(config.logCleanupBatchSize).toBe(25);
    expect(config.serverRuntimeRole).toBe("worker");
    expect(config.cycleClosePollIntervalMs).toBe(250);
    expect(config.requestLogBatchSize).toBe(50);
    expect(config.requestLogFlushIntervalMs).toBe(25);
    expect(config.requestLogBufferCapacity).toBe(500);
  });

  it("rejects invalid log level", () => {
    expect(() =>
      withEnv(
        {
          LOG_LEVEL: "verbose"
        },
        () => loadConfig()
      )
    ).toThrow(/LOG_LEVEL/);
  });

  it("rejects invalid server performance runtime configuration", () => {
    expect(() =>
      withEnv(
        {
          SERVER_RUNTIME_ROLE: "scheduler"
        },
        () => loadConfig()
      )
    ).toThrow(/SERVER_RUNTIME_ROLE/);

    expect(() =>
      withEnv(
        {
          REQUEST_LOG_BATCH_SIZE: "0"
        },
        () => loadConfig()
      )
    ).toThrow(/REQUEST_LOG_BATCH_SIZE/);

    expect(() =>
      withEnv(
        {
          REQUEST_LOG_FLUSH_INTERVAL_MS: "0"
        },
        () => loadConfig()
      )
    ).toThrow(/REQUEST_LOG_FLUSH_INTERVAL_MS/);

    expect(() =>
      withEnv(
        {
          REQUEST_LOG_BUFFER_CAPACITY: "0"
        },
        () => loadConfig()
      )
    ).toThrow(/REQUEST_LOG_BUFFER_CAPACITY/);

    expect(() =>
      withEnv(
        {
          LOG_CLEANUP_BATCH_SIZE: "0"
        },
        () => loadConfig()
      )
    ).toThrow(/LOG_CLEANUP_BATCH_SIZE/);

    expect(() =>
      withEnv(
        {
          CYCLE_CLOSE_POLL_INTERVAL_MS: "0"
        },
        () => loadConfig()
      )
    ).toThrow(/CYCLE_CLOSE_POLL_INTERVAL_MS/);
  });

  it("rejects non-positive log retention windows", () => {
    expect(() =>
      withEnv(
        {
          REQUEST_LOG_RETENTION_DAYS: "0"
        },
        () => loadConfig()
      )
    ).toThrow(/REQUEST_LOG_RETENTION_DAYS/);

    expect(() =>
      withEnv(
        {
          AUDIT_LOG_RETENTION_DAYS: "0"
        },
        () => loadConfig()
      )
    ).toThrow(/AUDIT_LOG_RETENTION_DAYS/);
  });

  it("rejects mixed wildcard and explicit CORS allowlist origins", () => {
    expect(() =>
      withEnv(
        {
          CORS_ALLOWED_ORIGINS: "*,https://example.com"
        },
        () => loadConfig()
      )
    ).toThrow(/CORS_ALLOWED_ORIGINS/);
  });

  it("rejects non-positive auth challenge capacity", () => {
    expect(() =>
      withEnv(
        {
          AUTH_CHALLENGE_MAX_ENTRIES: "0"
        },
        () => loadConfig()
      )
    ).toThrow(/AUTH_CHALLENGE_MAX_ENTRIES/);
  });

  it("rejects negative initial agent balance", () => {
    expect(() =>
      withEnv(
        {
          INITIAL_AGENT_BALANCE: "-1"
        },
        () => loadConfig()
      )
    ).toThrow(/INITIAL_AGENT_BALANCE/);
  });

  it("rejects non-positive cycle duration", () => {
    expect(() =>
      withEnv(
        {
          CYCLE_DURATION_HOURS: "0"
        },
        () => loadConfig()
      )
    ).toThrow(/CYCLE_DURATION_HOURS/);
  });
});
