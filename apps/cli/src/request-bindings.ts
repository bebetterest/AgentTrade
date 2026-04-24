export interface CliRequestBindingDefinition {
  location: "path" | "query" | "body";
  field: string;
  sources: string[];
  note?: string;
}

export const cliRequestBindings: Record<string, readonly CliRequestBindingDefinition[]> = {
  "activities list": [
    { location: "query", field: "taskId", sources: ["--task"] },
    { location: "query", field: "disputeId", sources: ["--dispute"] },
    { location: "query", field: "address", sources: ["--address"] },
    { location: "query", field: "type", sources: ["--type"] },
    { location: "query", field: "order", sources: ["--order"] },
    { location: "query", field: "cursor", sources: ["--cursor"] },
    { location: "query", field: "limit", sources: ["--limit"] }
  ],
  "agents list": [
    { location: "query", field: "q", sources: ["--q"] },
    { location: "query", field: "activeOnly", sources: ["--active-only"] },
    { location: "query", field: "sort", sources: ["--sort"] },
    { location: "query", field: "order", sources: ["--order"] },
    { location: "query", field: "cursor", sources: ["--cursor"] },
    { location: "query", field: "limit", sources: ["--limit"] }
  ],
  "agents profile get": [{ location: "path", field: "address", sources: ["--address"] }],
  "agents profile update": [
    { location: "path", field: "address", sources: ["--address"] },
    {
      location: "body",
      field: "name",
      sources: ["--name", "--name-file", "--clear-name"],
      note: "--clear-name writes an empty string"
    },
    {
      location: "body",
      field: "bio",
      sources: ["--bio", "--bio-file", "--clear-bio"],
      note: "--clear-bio writes an empty string"
    }
  ],
  "agents stats": [{ location: "path", field: "address", sources: ["--address"] }],
  "auth challenge": [{ location: "body", field: "address", sources: ["--address"] }],
  "auth login": [],
  "auth register": [],
  "auth verify": [
    { location: "body", field: "address", sources: ["--address"] },
    { location: "body", field: "nonce", sources: ["--nonce"] },
    { location: "body", field: "signature", sources: ["--signature", "--signature-file"] },
    { location: "body", field: "message", sources: ["--message", "--message-file"] }
  ],
  "config set": [],
  "config show": [],
  "config unset": [],
  "cycles active": [],
  "cycles get": [{ location: "path", field: "id", sources: ["--cycle"] }],
  "cycles list": [
    { location: "query", field: "cursor", sources: ["--cursor"] },
    { location: "query", field: "limit", sources: ["--limit"] }
  ],
  "cycles rewards": [{ location: "path", field: "id", sources: ["--cycle"] }],
  "dashboard summary": [{ location: "query", field: "tz", sources: ["--tz"] }],
  "dashboard trends": [
    { location: "query", field: "tz", sources: ["--tz"] },
    { location: "query", field: "window", sources: ["--window"] }
  ],
  "disputes get": [{ location: "path", field: "id", sources: ["--dispute"] }],
  "disputes list": [
    { location: "query", field: "taskId", sources: ["--task"] },
    { location: "query", field: "opener", sources: ["--opener"] },
    { location: "query", field: "status", sources: ["--status"] },
    { location: "query", field: "q", sources: ["--q"] },
    { location: "query", field: "sort", sources: ["--sort"] },
    { location: "query", field: "order", sources: ["--order"] },
    { location: "query", field: "cursor", sources: ["--cursor"] },
    { location: "query", field: "limit", sources: ["--limit"] }
  ],
  "disputes open": [
    { location: "body", field: "taskId", sources: ["--task"] },
    { location: "body", field: "submissionId", sources: ["--submission"] },
    { location: "body", field: "reasonMd", sources: ["--reason", "--reason-file"] }
  ],
  "disputes respond": [
    { location: "path", field: "id", sources: ["--dispute"] },
    { location: "body", field: "reasonMd", sources: ["--reason", "--reason-file"] }
  ],
  "disputes vote": [
    { location: "path", field: "id", sources: ["--dispute"] },
    { location: "body", field: "vote", sources: ["--vote"] }
  ],
  "economy params": [],
  "ledger get": [{ location: "path", field: "address", sources: ["--address"] }],
  spec: [],
  "submissions confirm": [{ location: "path", field: "id", sources: ["--submission"] }],
  "submissions get": [{ location: "path", field: "id", sources: ["--submission"] }],
  "submissions list": [
    { location: "query", field: "taskId", sources: ["--task"] },
    { location: "query", field: "agent", sources: ["--agent"] },
    { location: "query", field: "status", sources: ["--status"] },
    { location: "query", field: "q", sources: ["--q"] },
    { location: "query", field: "sort", sources: ["--sort"] },
    { location: "query", field: "order", sources: ["--order"] },
    { location: "query", field: "cursor", sources: ["--cursor"] },
    { location: "query", field: "limit", sources: ["--limit"] }
  ],
  "submissions reject": [
    { location: "path", field: "id", sources: ["--submission"] },
    { location: "body", field: "reasonMd", sources: ["--reason", "--reason-file"] }
  ],
  "system health": [],
  "system metrics": [],
  "system settings get": [],
  "system settings history": [
    { location: "query", field: "cursor", sources: ["--cursor"] },
    { location: "query", field: "limit", sources: ["--limit"] }
  ],
  "system settings reset": [
    { location: "body", field: "applyTo", sources: ["--apply-to"] },
    { location: "body", field: "reason", sources: ["--reason", "--reason-file"] }
  ],
  "system settings update": [
    { location: "body", field: "applyTo", sources: ["--apply-to"] },
    { location: "body", field: "patch", sources: ["--patch-json", "--patch-file"] },
    { location: "body", field: "reason", sources: ["--reason", "--reason-file"] }
  ],
  "tasks create": [
    { location: "body", field: "title", sources: ["--title", "--title-file"] },
    { location: "body", field: "descriptionMd", sources: ["--desc", "--desc-file"] },
    { location: "body", field: "acceptanceCriteria", sources: ["--criteria", "--criteria-file"] },
    { location: "body", field: "deadlineUtc", sources: ["--deadline"] },
    { location: "body", field: "displayTimezone", sources: ["--tz"] },
    { location: "body", field: "slotsTotal", sources: ["--slots"] },
    { location: "body", field: "rewardPerSlot", sources: ["--reward"] },
    {
      location: "body",
      field: "allowRepeatCompletionsBySameAgent",
      sources: ["--allow-repeat"],
      note: "flag presence writes true; omission leaves false"
    }
  ],
  "tasks get": [{ location: "path", field: "id", sources: ["--task"] }],
  "tasks intend": [{ location: "path", field: "id", sources: ["--task"] }],
  "tasks intentions": [
    { location: "path", field: "id", sources: ["--task"] },
    { location: "query", field: "cursor", sources: ["--cursor"] },
    { location: "query", field: "limit", sources: ["--limit"] }
  ],
  "tasks list": [
    { location: "query", field: "q", sources: ["--q"] },
    { location: "query", field: "status", sources: ["--status"] },
    { location: "query", field: "publisher", sources: ["--publisher"] },
    { location: "query", field: "sort", sources: ["--sort"] },
    { location: "query", field: "order", sources: ["--order"] },
    { location: "query", field: "cursor", sources: ["--cursor"] },
    { location: "query", field: "limit", sources: ["--limit"] }
  ],
  "tasks submit": [
    { location: "path", field: "id", sources: ["--task"] },
    { location: "body", field: "payloadMd", sources: ["--payload", "--payload-file"] }
  ],
  "tasks terminate": [{ location: "path", field: "id", sources: ["--task"] }]
};
