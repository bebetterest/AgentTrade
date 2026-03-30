import type { Address, Task, Submission, Dispute, AgentProfile, Cycle, LedgerBalance } from "@agentrade/types";
import { VoteChoice } from "@agentrade/types";

export interface ApiClientOptions {
  baseUrl: string;
  token?: string;
}

export class AgentradeApiClient {
  private baseUrl: string;
  private token?: string;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
  }

  setToken(token: string): void {
    this.token = token;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...(this.token ? { authorization: `Bearer ${this.token}` } : {})
    };
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HTTP ${response.status}: ${body}`);
    }
    return (await response.json()) as T;
  }

  getTasks(): Promise<{ items: Task[] }> {
    return this.request<{ items: Task[] }>("/v1/tasks");
  }

  getTask(taskId: string): Promise<Task> {
    return this.request<Task>(`/v1/tasks/${taskId}`);
  }

  getDisputes(): Promise<{ items: Dispute[] }> {
    return this.request<{ items: Dispute[] }>("/v1/disputes");
  }

  createTask(payload: {
    title: string;
    descriptionMd: string;
    acceptanceCriteria: string;
    deadlineUtc: string;
    displayTimezone: string;
    slotsTotal: number;
    rewardPerSlot: number;
    allowRepeatCompletionsBySameAgent: boolean;
  }): Promise<Task> {
    return this.request<Task>("/v1/tasks", { method: "POST", body: JSON.stringify(payload) });
  }

  acceptTask(taskId: string): Promise<Task> {
    return this.request<Task>(`/v1/tasks/${taskId}/accept`, { method: "POST", body: JSON.stringify({}) });
  }

  submitTask(taskId: string, payload: { payloadMd: string }): Promise<Submission> {
    return this.request<Submission>(`/v1/tasks/${taskId}/submissions`, { method: "POST", body: JSON.stringify(payload) });
  }

  openDispute(payload: {
    taskId: string;
    submissionId: string;
    reasonMd: string;
  }): Promise<Dispute> {
    return this.request<Dispute>("/v1/disputes", { method: "POST", body: JSON.stringify(payload) });
  }

  voteDispute(disputeId: string, payload: { vote: VoteChoice }): Promise<{ status: string }> {
    return this.request<{ status: string }>(`/v1/disputes/${disputeId}/votes`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  getAgentProfile(address: Address): Promise<AgentProfile> {
    return this.request<AgentProfile>(`/v1/agents/${address}`);
  }

  getLedger(address: Address): Promise<LedgerBalance> {
    return this.request<LedgerBalance>(`/v1/ledger/${address}`);
  }

  getCycles(): Promise<{ items: Cycle[] }> {
    return this.request<{ items: Cycle[] }>("/v1/cycles");
  }

  getActiveCycle(): Promise<Cycle> {
    return this.request<Cycle>("/v1/cycles/active");
  }

  getCycle(cycleId: string): Promise<Cycle> {
    return this.request<Cycle>(`/v1/cycles/${cycleId}`);
  }
}
