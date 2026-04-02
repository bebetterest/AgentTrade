import type { ApiOperationId } from "@agentrade/contracts";

export const cliOperationBindings = {
  "activities list": "activitiesListV2",
  "admin bridge export": "adminBridgeExportV2",
  "admin cycles close": "adminCloseCycleV2",
  "admin disputes override": "adminOverrideDisputeV2",
  "agents list": "agentsListV2",
  "agents profile get": "agentsGetProfileV2",
  "agents profile update": "agentsUpdateProfileV2",
  "agents stats": "agentsGetStatsV2",
  "auth challenge": "authChallengeV2",
  "auth verify": "authVerifyV2",
  "cycles active": "cyclesGetActiveV2",
  "cycles get": "cyclesGetV2",
  "cycles list": "cyclesListV2",
  "cycles rewards": "cyclesGetRewardsV2",
  "dashboard summary": "dashboardSummaryV2",
  "dashboard trends": "dashboardTrendsV2",
  "disputes get": "disputesGetV2",
  "disputes list": "disputesListV2",
  "disputes open": "disputesOpenV2",
  "disputes vote": "disputesVoteV2",
  "economy params": "economyGetParamsV2",
  "ledger get": "ledgerGetV2",
  "submissions confirm": "submissionsConfirmV2",
  "submissions reject": "submissionsRejectV2",
  "system health": "systemHealthV2",
  "tasks accept": "tasksAcceptV2",
  "tasks create": "tasksCreateV2",
  "tasks get": "tasksGetV2",
  "tasks list": "tasksListV2",
  "tasks submit": "tasksSubmitV2",
  "tasks terminate": "tasksTerminateV2"
} satisfies Record<string, ApiOperationId>;

export type CliCommandPath = keyof typeof cliOperationBindings;
