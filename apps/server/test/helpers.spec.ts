import { describe, expect, it } from "vitest";
import { defaultConfig } from "@agentrade/config";
import {
  allocateIntegerPool,
  clampReputation,
  computeAgentCompositeScore,
  computeSupervisorVoteWeight,
  computeTaxAmount,
  computeTerminationPenalty
} from "../src/domain/helpers.js";

describe("domain helpers", () => {
  it("clamps reputation into [0, 100]", () => {
    expect(clampReputation(-10)).toBe(0);
    expect(clampReputation(55)).toBe(55);
    expect(clampReputation(120)).toBe(100);
  });

  it("computes tax with global min floor", () => {
    expect(computeTaxAmount(10, defaultConfig)).toBe(1); // 5% -> 0.5 => min 1
    expect(computeTaxAmount(100, defaultConfig)).toBe(5);
  });

  it("computes termination penalty with minimum 1 when remaining reward > 0", () => {
    expect(computeTerminationPenalty(0, defaultConfig)).toBe(0);
    expect(computeTerminationPenalty(1, defaultConfig)).toBe(1);
    expect(computeTerminationPenalty(100, defaultConfig)).toBe(10);
  });

  it("computes supervisor vote weight by configured weighted sum", () => {
    const weight = computeSupervisorVoteWeight(
      {
        publisher: 40,
        worker: 60,
        supervisor: 80
      },
      defaultConfig
    );
    // 40*0.2 + 60*0.3 + 80*0.5 = 66
    expect(weight).toBe(66);
  });

  it("computes composite score by configured weighted sum", () => {
    expect(
      computeAgentCompositeScore(
        {
          reputationAvg: 80,
          completionRate: 50,
          qualityRate: 100
        },
        defaultConfig
      )
    ).toBe(73.5); // (80*0.45 + 50*0.35 + 100*0.2)
  });

  it("allocates equally when all workloads are zero", () => {
    const distribution = allocateIntegerPool(
      10,
      new Map([
        ["agent-c", 0],
        ["agent-a", 0],
        ["agent-b", 0]
      ])
    );
    expect(distribution.get("agent-a")).toBe(4);
    expect(distribution.get("agent-b")).toBe(3);
    expect(distribution.get("agent-c")).toBe(3);
    expect([...distribution.values()].reduce((acc, value) => acc + value, 0)).toBe(10);
  });

  it("ignores zero-workload agents when positive workload exists", () => {
    const distribution = allocateIntegerPool(
      9,
      new Map([
        ["agent-a", 0],
        ["agent-b", 2],
        ["agent-c", 1]
      ])
    );
    expect(distribution.has("agent-a")).toBe(false);
    expect((distribution.get("agent-b") ?? 0) + (distribution.get("agent-c") ?? 0)).toBe(9);
    expect((distribution.get("agent-b") ?? 0)).toBeGreaterThan(distribution.get("agent-c") ?? 0);
  });

  it("preserves pool amount and determinism under randomized workload cases", () => {
    let seed = 20260330;
    const nextRand = (): number => {
      seed = (seed * 1664525 + 1013904223) % 0x100000000;
      return seed / 0x100000000;
    };

    for (let round = 0; round < 100; round += 1) {
      const pool = Math.floor(nextRand() * 500);
      const size = 1 + Math.floor(nextRand() * 20);
      const workloads = new Map<string, number>();
      for (let i = 0; i < size; i += 1) {
        workloads.set(`agent-${i.toString().padStart(2, "0")}`, Math.floor(nextRand() * 8));
      }

      const once = allocateIntegerPool(pool, workloads);
      const twice = allocateIntegerPool(pool, workloads);
      expect([...once.entries()]).toEqual([...twice.entries()]);

      const distributed = [...once.values()].reduce((acc, value) => acc + value, 0);
      expect(distributed).toBe(pool);
      for (const amount of once.values()) {
        expect(Number.isInteger(amount)).toBe(true);
        expect(amount).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
