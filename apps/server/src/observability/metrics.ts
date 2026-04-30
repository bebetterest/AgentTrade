import type { LatencySummary, ServiceMetricsResponse } from "@agentrade/types";

const MAX_LATENCY_SAMPLES = 4096;

export type WorkerJobMetricOutcome = "success" | "error" | "lock_miss";

export interface WorkerJobMetricCounters {
  workerJobSuccessTotal: number;
  workerJobErrorTotal: number;
  workerJobLockMissTotal: number;
  workerJobSuccessTotalExact: string;
  workerJobErrorTotalExact: string;
  workerJobLockMissTotalExact: string;
}

const MAX_SAFE_COUNTER = BigInt(Number.MAX_SAFE_INTEGER);

const toSafeCounterNumber = (value: bigint): number =>
  value > MAX_SAFE_COUNTER ? Number.MAX_SAFE_INTEGER : Number(value);

const normalizeCounterBigInt = (value: bigint | undefined): bigint =>
  value && value > 0n ? value : 0n;

const parseCounterBigInt = (value: number | string | undefined): bigint => {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? BigInt(Math.floor(value)) : 0n;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return BigInt(value);
  }
  return 0n;
};

export const workerJobMetricCountersFromBigInts = (input: {
  workerJobSuccessTotal?: bigint;
  workerJobErrorTotal?: bigint;
  workerJobLockMissTotal?: bigint;
} = {}): WorkerJobMetricCounters => {
  const success = normalizeCounterBigInt(input.workerJobSuccessTotal);
  const error = normalizeCounterBigInt(input.workerJobErrorTotal);
  const lockMiss = normalizeCounterBigInt(input.workerJobLockMissTotal);
  return {
    workerJobSuccessTotal: toSafeCounterNumber(success),
    workerJobErrorTotal: toSafeCounterNumber(error),
    workerJobLockMissTotal: toSafeCounterNumber(lockMiss),
    workerJobSuccessTotalExact: success.toString(),
    workerJobErrorTotalExact: error.toString(),
    workerJobLockMissTotalExact: lockMiss.toString()
  };
};

export const emptyWorkerJobMetricCounters = (): WorkerJobMetricCounters =>
  workerJobMetricCountersFromBigInts();

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
  private readonly values = Array<number>(MAX_LATENCY_SAMPLES).fill(0);
  private count = 0;
  private nextIndex = 0;

  add(durationMs: number): void {
    this.values[this.nextIndex] = clampDuration(durationMs);
    this.nextIndex = (this.nextIndex + 1) % MAX_LATENCY_SAMPLES;
    if (this.count < MAX_LATENCY_SAMPLES) {
      this.count += 1;
    }
  }

  snapshot(): LatencySnapshot {
    return { values: this.values.slice(0, this.count) };
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
  private requestLogDroppedTotal = 0;
  private requestLogFlushTotal = 0;
  private requestLogFlushErrorTotal = 0;
  private workerJobSuccessTotal = 0n;
  private workerJobErrorTotal = 0n;
  private workerJobLockMissTotal = 0n;
  private requestLogBufferSize = 0;

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

  recordRequestLogBufferSize(size: number): void {
    this.requestLogBufferSize = Number.isFinite(size) && size >= 0 ? Math.floor(size) : 0;
  }

  recordRequestLogDropped(count = 1): void {
    this.requestLogDroppedTotal += Math.max(0, Math.floor(count));
  }

  recordRequestLogFlush(outcome: "success" | "error"): void {
    if (outcome === "success") {
      this.requestLogFlushTotal += 1;
      return;
    }
    this.requestLogFlushErrorTotal += 1;
  }

  recordWorkerJob(outcome: WorkerJobMetricOutcome): void {
    if (outcome === "success") {
      this.workerJobSuccessTotal += 1n;
      return;
    }
    if (outcome === "lock_miss") {
      this.workerJobLockMissTotal += 1n;
      return;
    }
    this.workerJobErrorTotal += 1n;
  }

  snapshot(workerJobCounters: Partial<WorkerJobMetricCounters> = {}): ServiceMetricsResponse {
    const workerCounters = workerJobMetricCountersFromBigInts({
      workerJobSuccessTotal:
        this.workerJobSuccessTotal +
        parseCounterBigInt(
          workerJobCounters.workerJobSuccessTotalExact ?? workerJobCounters.workerJobSuccessTotal
        ),
      workerJobErrorTotal:
        this.workerJobErrorTotal +
        parseCounterBigInt(
          workerJobCounters.workerJobErrorTotalExact ?? workerJobCounters.workerJobErrorTotal
        ),
      workerJobLockMissTotal:
        this.workerJobLockMissTotal +
        parseCounterBigInt(
          workerJobCounters.workerJobLockMissTotalExact ?? workerJobCounters.workerJobLockMissTotal
        )
    });
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
        writeDeadlockTotal: this.writeDeadlockTotal,
        requestLogDroppedTotal: this.requestLogDroppedTotal,
        requestLogFlushTotal: this.requestLogFlushTotal,
        requestLogFlushErrorTotal: this.requestLogFlushErrorTotal,
        workerJobSuccessTotal: workerCounters.workerJobSuccessTotal,
        workerJobErrorTotal: workerCounters.workerJobErrorTotal,
        workerJobLockMissTotal: workerCounters.workerJobLockMissTotal,
        workerJobSuccessTotalExact: workerCounters.workerJobSuccessTotalExact,
        workerJobErrorTotalExact: workerCounters.workerJobErrorTotalExact,
        workerJobLockMissTotalExact: workerCounters.workerJobLockMissTotalExact
      },
      gauges: {
        requestLogBufferSize: this.requestLogBufferSize
      },
      latencies: {
        requests: summarizeLatency(this.requestLatency.snapshot()),
        writes: summarizeLatency(this.writeLatency.snapshot())
      }
    };
  }
}
