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
});
