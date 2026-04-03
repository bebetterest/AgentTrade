import type { LatencySummary, ServiceMetricsResponse } from "@agentrade/types";

const MAX_LATENCY_SAMPLES = 4096;

interface LatencySnapshot {
  values: number[];
}

const clampDuration = (value: number): number =>
  Number.isFinite(value) && value >= 0 ? Number(value.toFixed(3)) : 0;

const percentile = (sorted: number[], rank: number): number => {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(rank * sorted.length) - 1));
  return sorted[index] ?? 0;
};

const summarizeLatency = (snapshot: LatencySnapshot): LatencySummary => {
  if (snapshot.values.length === 0) {
    return {
      count: 0,
      avgMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      maxMs: 0
    };
  }

  const sorted = [...snapshot.values].sort((left, right) => left - right);
  const total = sorted.reduce((sum, item) => sum + item, 0);
  const max = sorted[sorted.length - 1] ?? 0;

  return {
    count: sorted.length,
    avgMs: clampDuration(total / sorted.length),
    p50Ms: clampDuration(percentile(sorted, 0.5)),
    p95Ms: clampDuration(percentile(sorted, 0.95)),
    p99Ms: clampDuration(percentile(sorted, 0.99)),
    maxMs: clampDuration(max)
  };
};

class LatencyBuffer {
  private readonly values: number[] = [];

  add(durationMs: number): void {
    this.values.push(clampDuration(durationMs));
    if (this.values.length > MAX_LATENCY_SAMPLES) {
      this.values.splice(0, this.values.length - MAX_LATENCY_SAMPLES);
    }
  }

  snapshot(): LatencySnapshot {
    return { values: [...this.values] };
  }
}

export class ServiceMetricsCollector {
  private readonly startedAt = new Date();
  private readonly requestLatency = new LatencyBuffer();
  private readonly writeLatency = new LatencyBuffer();
  private requestsTotal = 0;
  private errorsTotal = 0;
  private rateLimitedTotal = 0;
  private writeTotal = 0;
  private writeErrorTotal = 0;
  private writeConflictTotal = 0;
  private writeDeadlockTotal = 0;

  recordRequest(input: { statusCode: number; durationMs: number }): void {
    this.requestsTotal += 1;
    if (input.statusCode >= 400) {
      this.errorsTotal += 1;
    }
    if (input.statusCode === 429) {
      this.rateLimitedTotal += 1;
    }
    this.requestLatency.add(input.durationMs);
  }

  recordWrite(input: {
    durationMs: number;
    outcome: "success" | "error";
    conflict: boolean;
    deadlock: boolean;
  }): void {
    this.writeTotal += 1;
    if (input.outcome === "error") {
      this.writeErrorTotal += 1;
    }
    if (input.conflict) {
      this.writeConflictTotal += 1;
    }
    if (input.deadlock) {
      this.writeDeadlockTotal += 1;
    }
    this.writeLatency.add(input.durationMs);
  }

  snapshot(): ServiceMetricsResponse {
    return {
      generatedAt: new Date().toISOString(),
      startedAt: this.startedAt.toISOString(),
      counters: {
        requestsTotal: this.requestsTotal,
        errorsTotal: this.errorsTotal,
        rateLimitedTotal: this.rateLimitedTotal,
        writeTotal: this.writeTotal,
        writeErrorTotal: this.writeErrorTotal,
        writeConflictTotal: this.writeConflictTotal,
        writeDeadlockTotal: this.writeDeadlockTotal
      },
      latencies: {
        requests: summarizeLatency(this.requestLatency.snapshot()),
        writes: summarizeLatency(this.writeLatency.snapshot())
      }
    };
  }
}
