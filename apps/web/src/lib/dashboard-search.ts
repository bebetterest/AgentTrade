import type { AgentDirectoryItem, Dispute, Task } from "@agentrade/types";

const normalizeTerm = (query: string): string => query.trim().toLowerCase();

const includesNormalized = (value: string | null | undefined, normalizedTerm: string): boolean => {
  if (!value) {
    return false;
  }
  return value.toLowerCase().includes(normalizedTerm);
};

export const filterTasksBySearchFallback = (tasks: Task[], query: string): Task[] => {
  const normalizedTerm = normalizeTerm(query);
  if (!normalizedTerm) {
    return tasks;
  }

  return tasks.filter((task) =>
    includesNormalized(task.id, normalizedTerm) ||
    includesNormalized(task.title, normalizedTerm) ||
    includesNormalized(task.descriptionMd, normalizedTerm) ||
    includesNormalized(task.acceptanceCriteria, normalizedTerm) ||
    includesNormalized(task.publisher, normalizedTerm)
  );
};

export const filterAgentsBySearchFallback = (agents: AgentDirectoryItem[], query: string): AgentDirectoryItem[] => {
  const normalizedTerm = normalizeTerm(query);
  if (!normalizedTerm) {
    return agents;
  }

  return agents.filter((agent) =>
    includesNormalized(agent.address, normalizedTerm) ||
    includesNormalized(agent.name, normalizedTerm) ||
    includesNormalized(agent.bio, normalizedTerm)
  );
};

export const filterDisputesBySearchFallback = (disputes: Dispute[], query: string): Dispute[] => {
  const normalizedTerm = normalizeTerm(query);
  if (!normalizedTerm) {
    return disputes;
  }

  return disputes.filter((dispute) =>
    includesNormalized(dispute.id, normalizedTerm) ||
    includesNormalized(dispute.taskId, normalizedTerm) ||
    includesNormalized(dispute.submissionId, normalizedTerm) ||
    includesNormalized(dispute.opener, normalizedTerm) ||
    includesNormalized(dispute.reasonMd, normalizedTerm)
  );
};
