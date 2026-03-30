import type { AppConfig } from "@agentrade/config";
import type { ReputationTriple } from "@agentrade/types";

export const clampReputation = (value: number): number => Math.max(0, Math.min(100, value));

export const computeTaxAmount = (totalReward: number, config: AppConfig): number =>
  Math.max(config.taxMin, Math.floor((totalReward * config.taxRateBps) / 10_000));

export const computeTerminationPenalty = (remainingReward: number, config: AppConfig): number => {
  if (remainingReward <= 0) {
    return 0;
  }
  return Math.max(1, Math.floor((remainingReward * config.terminationPenaltyBps) / 10_000));
};

export const computeSupervisorVoteWeight = (
  reputation: ReputationTriple,
  config: AppConfig
): number =>
  (reputation.publisher * config.reputationWeightPublisherBps +
    reputation.worker * config.reputationWeightWorkerBps +
    reputation.supervisor * config.reputationWeightSupervisorBps) /
  10_000;

export const allocateIntegerPool = (
  pool: number,
  workloads: Map<string, number>
): Map<string, number> => {
  const result = new Map<string, number>();
  if (pool <= 0 || workloads.size === 0) {
    return result;
  }

  const entries = [...workloads.entries()];
  const total = entries.reduce((acc, [, value]) => acc + value, 0);
  if (total <= 0) {
    const perHead = Math.floor(pool / entries.length);
    let remainder = pool - perHead * entries.length;
    const sorted = entries.map(([agent]) => agent).sort();
    for (const agent of sorted) {
      const bonus = remainder > 0 ? 1 : 0;
      remainder -= bonus;
      result.set(agent, perHead + bonus);
    }
    return result;
  }

  let allocated = 0;
  const fractions: Array<{ agent: string; fraction: number }> = [];
  for (const [agent, workload] of entries) {
    if (workload <= 0) {
      continue;
    }
    const raw = (pool * workload) / total;
    const base = Math.floor(raw);
    allocated += base;
    result.set(agent, base);
    fractions.push({ agent, fraction: raw - base });
  }

  let remainder = pool - allocated;
  fractions.sort((a, b) => b.fraction - a.fraction || a.agent.localeCompare(b.agent));
  let cursor = 0;
  while (remainder > 0 && fractions.length > 0) {
    const current = fractions[cursor % fractions.length];
    const previous = result.get(current.agent) ?? 0;
    result.set(current.agent, previous + 1);
    remainder -= 1;
    cursor += 1;
  }
  return result;
};

