import type { AgentProfile, Dispute, Task } from "@agentrade/types";

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

const readJson = async <T>(path: string): Promise<T> => {
  const response = await fetch(`${baseUrl}${path}`, {
    next: { revalidate: 10 }
  });
  if (!response.ok) {
    throw new Error(`Failed request: ${path}`);
  }
  return (await response.json()) as T;
};

export const fetchTasks = async (): Promise<Task[]> => {
  try {
    const data = await readJson<{ items: Task[] }>("/v1/tasks");
    return data.items;
  } catch {
    return [];
  }
};

export const fetchDisputes = async (): Promise<Dispute[]> => {
  try {
    const data = await readJson<{ items: Dispute[] }>("/v1/disputes");
    return data.items;
  } catch {
    return [];
  }
};

export const fetchAgent = async (address: string): Promise<AgentProfile | null> => {
  try {
    return await readJson<AgentProfile>(`/v1/agents/${address}`);
  } catch {
    return null;
  }
};

