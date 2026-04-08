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
