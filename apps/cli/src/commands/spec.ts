import type { Command, Option } from "commander";
import {
  getApiOperation,
  type ApiAuthMode,
  type ApiOperationDefinition,
  type ApiOperationId,
  type ContractSchema,
  openApiSchemaComponents,
  type OpenApiParameterObject,
  type OpenApiSchemaObject
} from "@agentrade/contracts";
import { cliOperationBindings } from "../operation-bindings.js";
import {
  CLI_DEFAULT_BASE_URL,
  CLI_DEFAULT_RETRIES,
  CLI_DEFAULT_TIMEOUT_MS
} from "../cli-config.js";
import { getInputContractLines } from "../command-metadata.js";
import { CliValidationError } from "../errors.js";
import { printSuccessJson } from "../output.js";
import {
  cliRequestBindings,
  type CliRequestBindingDefinition
} from "../request-bindings.js";
import { STDIN_FILE_ALIAS } from "../text-input.js";

type CliExecutionMode = "api" | "composite" | "local";

interface CliSpecArgument {
  name: string;
  syntax: string;
  required: boolean;
  variadic: boolean;
  description: string | null;
  defaultValue?: unknown;
}

interface CliSpecOption {
  flags: string;
  longFlag?: string;
  shortFlag?: string;
  description: string;
  takesValue: boolean;
  valueRequired: boolean;
  required: boolean;
  defaultValue?: unknown;
}

interface CliSpecOperation {
  operationId: ApiOperationId;
  version: "v2";
  method: "GET" | "POST" | "PATCH";
  pathTemplate: string;
  auth: ApiAuthMode;
  tag: string;
}

interface CliSpecAuthRequirement {
  kind: "token" | "adminKey";
  sources: string[];
}

interface CliSpecExecutionStep {
  kind: "local" | "apiOperation";
  summary: string;
  operationId?: ApiOperationId;
  condition?: string;
  inputSources?: string[];
  outputs?: string[];
}

interface CliSpecSideEffect {
  target: "persistedConfig" | "configFile" | "secretKeyFile" | "stdout";
  action: "write" | "delete" | "display";
  summary: string;
  fields?: string[];
  condition?: string;
}

interface CliSpecSuccessField {
  path: string;
  description: string;
  sensitive?: boolean;
  condition?: string;
  required?: boolean;
  schema?: OpenApiSchemaObject;
}

interface CliSpecRequestBinding {
  location: "path" | "query" | "body";
  field: string;
  sources: string[];
  note?: string;
  required?: boolean;
  description?: string;
  schema?: OpenApiSchemaObject;
}

type CliSpecFailureType =
  | "VALIDATION_ERROR"
  | "CONFIG_ERROR"
  | "API_ERROR"
  | "NETWORK_ERROR"
  | "UNKNOWN_ERROR";

type CliSpecNetworkIssueKind = "TIMEOUT" | "DNS" | "CONNECTION" | "TLS" | "NETWORK";
type CliSpecHttpStatusClass = "4xx" | "5xx";
type CliSpecFailureStrategy =
  | "fixInputs"
  | "repairConfig"
  | "switchCredential"
  | "reReadState"
  | "boundedRetry"
  | "manualRetry"
  | "stopDuplicateBranch"
  | "escalate";
type CliSpecRetryGate =
  | "never"
  | "whenRetryable"
  | "afterInputRepair"
  | "afterStateVerification";

interface CliSpecFailureMatch {
  type: CliSpecFailureType;
  httpStatus?: number;
  httpStatusClass?: CliSpecHttpStatusClass;
  apiError?: string;
  issuesKind?: CliSpecNetworkIssueKind;
}

interface CliSpecFailureHint {
  match: CliSpecFailureMatch;
  strategy: CliSpecFailureStrategy;
  retryGate: CliSpecRetryGate;
  summary: string;
  suggestedCommands: string[];
}

type CliSpecWorkflowPhase =
  | "bootstrap"
  | "discover"
  | "publish"
  | "join"
  | "deliver"
  | "review"
  | "dispute"
  | "supervision"
  | "settlement"
  | "terminate"
  | "profile"
  | "system"
  | "config"
  | "discovery";

type CliSpecWorkflowActorRole =
  | "any"
  | "anonymous"
  | "owner"
  | "publisher"
  | "worker"
  | "party"
  | "supervisor"
  | "operator";

interface CliSpecWorkflowHints {
  phase: CliSpecWorkflowPhase;
  actorRoles: CliSpecWorkflowActorRole[];
  prerequisiteCommands: string[];
  nextCommands: string[];
}

type CliSpecEntityKind =
  | "activity"
  | "agent"
  | "authChallenge"
  | "authSession"
  | "cliDiscovery"
  | "config"
  | "cycle"
  | "cycleWorkload"
  | "dashboard"
  | "dispute"
  | "economy"
  | "ledgerAccount"
  | "runtimeSettings"
  | "serviceHealth"
  | "serviceMetrics"
  | "submission"
  | "supervisionVote"
  | "task"
  | "taskIntention";

type CliSpecEntityRelation = "target" | "created" | "listed" | "returned" | "resolved" | "related";

interface CliSpecEntityBinding {
  entity: CliSpecEntityKind;
  relation: CliSpecEntityRelation;
  inputSources?: string[];
  outputPaths?: string[];
  note?: string;
}

interface CliSpecEntityHints {
  primaryEntity: CliSpecEntityKind;
  bindings: CliSpecEntityBinding[];
}

type CliSpecHandoffSelectionMode = "currentPageItem" | "currentResult";
type CliSpecHandoffSelectionOperator = "equals" | "nonNull";

interface CliSpecHandoffSelectionCondition {
  path: string;
  operator: CliSpecHandoffSelectionOperator;
  value?: string | number | boolean;
}

interface CliSpecHandoffBinding {
  sourcePath?: string;
  sourceInput?: string;
  sourceLiteral?: string | number | boolean;
  targetInputs: string[];
  note?: string;
}

interface CliSpecHandoffHint {
  targetCommand: string;
  bindings: CliSpecHandoffBinding[];
  selectionMode?: CliSpecHandoffSelectionMode;
  selectionConditions?: CliSpecHandoffSelectionCondition[];
  note?: string;
}

interface CliSpecAutomationHints {
  effect: "read" | "remoteWrite" | "localWrite" | "compositeWrite" | "discovery";
  retryMode: "manual" | "retryableErrorsOnly" | "retryableAfterVerification";
  preflightCommands: string[];
  verificationCommands: string[];
}

interface CliSpecCommand {
  path: string;
  description: string;
  auth: ApiAuthMode;
  authRequirements: CliSpecAuthRequirement[];
  executionSteps: CliSpecExecutionStep[];
  sideEffects: CliSpecSideEffect[];
  successFields: CliSpecSuccessField[];
  requestBindings: CliSpecRequestBinding[];
  failureHints: CliSpecFailureHint[];
  workflowHints: CliSpecWorkflowHints;
  entityHints: CliSpecEntityHints;
  handoffHints: CliSpecHandoffHint[];
  automationHints: CliSpecAutomationHints;
  executionMode: CliExecutionMode;
  arguments: CliSpecArgument[];
  options: CliSpecOption[];
  inputContract: string[];
  operation?: CliSpecOperation;
  operations?: CliSpecOperation[];
}

interface CliDiscoverySpec {
  binary: string;
  version: string;
  commandQuery: string | null;
  commandCount: number;
  discovery: {
    preferredCommand: "agentrade spec";
    helpPlainTextExceptions: ["--help", "--version"];
    nestedHelpRewrite: true;
    positionalHelpArgumentsUnaffected: true;
    opaquePaginationCursor: true;
    stdinFileAlias: "-";
    stdinSingleConsumerPerInvocation: true;
  };
  runtimeConfig: {
    precedence: [
      "command flags",
      "persisted global config file",
      "built-in defaults"
    ];
    configPathCandidates: [
      "$AGENTRADE_CLI_CONFIG_PATH",
      "$XDG_CONFIG_HOME/agentrade/config.json",
      "~/.agentrade/config.json"
    ];
    builtInDefaults: {
      baseUrl: string;
      timeoutMs: number;
      retries: number;
    };
  };
  outputContract: {
    successStdoutEnvelope: ["ok", "command", "data", "warnings?"];
    failureStderrEnvelope: [
      "type",
      "message",
      "httpStatus",
      "apiError",
      "issues",
      "retryable",
      "command"
    ];
    exitCodes: {
      success: 0;
      validation: 2;
      config: 3;
      api: 4;
      network: 5;
      unknown: 10;
    };
  };
  globalOptions: CliSpecOption[];
  dualChannelInputs: Array<{
    inline: string;
    file: string;
    stdinAlias: "-";
  }>;
  commands: CliSpecCommand[];
}

interface LocalCommandMetadata {
  auth: ApiAuthMode;
  executionMode: Exclude<CliExecutionMode, "api">;
  operations?: ApiOperationId[];
  executionSteps: CliSpecExecutionStep[];
  sideEffects: CliSpecSideEffect[];
  successFields: CliSpecSuccessField[];
  automationHints: CliSpecAutomationHints;
  workflowHints: CliSpecWorkflowHints;
  entityHints: CliSpecEntityHints;
  handoffHints: CliSpecHandoffHint[];
}

const LOCAL_COMMANDS: Record<string, LocalCommandMetadata> = {
  "auth login": {
    auth: "none",
    executionMode: "composite",
    operations: ["authChallengeV2", "authVerifyV2"],
    executionSteps: [
      {
        kind: "local",
        summary: "resolve wallet private key from --private-key/--private-key-file or persisted CLI config, then derive and validate the effective address",
        inputSources: [
          "--address",
          "--private-key",
          "--private-key-file",
          "persistedConfig.walletPrivateKey",
          "persistedConfig.walletAddress"
        ],
        outputs: ["resolvedPrivateKey", "resolvedAddress"]
      },
      {
        kind: "apiOperation",
        operationId: "authChallengeV2",
        summary: "request a SIWE challenge for the resolved address",
        inputSources: ["resolvedAddress"],
        outputs: ["challenge.nonce", "challenge.message"]
      },
      {
        kind: "local",
        summary: "sign the returned challenge message with the resolved private key",
        inputSources: ["resolvedPrivateKey", "challenge.message"],
        outputs: ["signature"]
      },
      {
        kind: "apiOperation",
        operationId: "authVerifyV2",
        summary: "verify the signature and receive a bearer token",
        inputSources: ["resolvedAddress", "challenge.nonce", "challenge.message", "signature"],
        outputs: ["data.auth.token", "data.auth.expiresIn"]
      },
      {
        kind: "local",
        summary: "persist the returned token to local CLI config",
        condition: "skipped when --no-persist-token is set",
        inputSources: ["data.auth.token", "--no-persist-token"],
        outputs: ["data.persistence.tokenPersisted"]
      }
    ],
    sideEffects: [
      {
        target: "persistedConfig",
        action: "write",
        summary: "writes the encrypted bearer token to persisted CLI config",
        fields: ["token"],
        condition: "only when --no-persist-token is not set"
      },
      {
        target: "secretKeyFile",
        action: "write",
        summary: "creates the local encryption key file used for persisted secrets if it does not already exist",
        condition: "only when token persistence occurs and encrypted secret key material is not present yet"
      }
    ],
    successFields: [
      {
        path: "data.wallet.address",
        description: "resolved wallet address used for challenge and verification"
      },
      {
        path: "data.auth.token",
        description: "verified bearer token returned by auth verify",
        sensitive: true
      },
      {
        path: "data.auth.expiresIn",
        description: "token lifetime returned by auth verify"
      },
      {
        path: "data.persistence.tokenPersisted",
        description: "whether the verified token was persisted to local CLI config"
      },
      {
        path: "data.persistence.walletSource",
        description: "whether the wallet private key came from flags or persisted config"
      }
    ],
    automationHints: {
      effect: "compositeWrite",
      retryMode: "manual",
      preflightCommands: ["config show"],
      verificationCommands: ["config show"]
    },
    workflowHints: {
      phase: "bootstrap",
      actorRoles: ["anonymous"],
      prerequisiteCommands: ["config show"],
      nextCommands: ["config show", "tasks list", "tasks create"]
    },
    entityHints: {
      primaryEntity: "authSession",
      bindings: [
        {
          entity: "agent",
          relation: "resolved",
          inputSources: [
            "--address",
            "--private-key",
            "--private-key-file",
            "persistedConfig.walletAddress",
            "persistedConfig.walletPrivateKey"
          ],
          outputPaths: ["data.wallet.address"]
        },
        {
          entity: "authSession",
          relation: "created",
          outputPaths: ["data.auth.token"]
        }
      ]
    },
    handoffHints: [
      {
        targetCommand: "agents profile get",
        bindings: [
          {
            sourcePath: "data.wallet.address",
            targetInputs: ["--address"]
          }
        ]
      },
      {
        targetCommand: "agents stats",
        bindings: [
          {
            sourcePath: "data.wallet.address",
            targetInputs: ["--address"]
          }
        ]
      },
      {
        targetCommand: "tasks create",
        bindings: [
          {
            sourcePath: "data.auth.token",
            targetInputs: ["--token", "--token-file"],
            note: "pass the verified bearer token inline or through a file"
          }
        ],
        note: "task publication still requires title, description, criteria, deadline, slots, and reward inputs"
      },
      {
        targetCommand: "config set",
        bindings: [
          {
            sourceLiteral: "token",
            targetInputs: ["<key>"]
          },
          {
            sourcePath: "data.auth.token",
            targetInputs: ["[value]"],
            note: "persist the verified token inline only when argv secret exposure is acceptable"
          }
        ],
        note: "config set writes the verified bearer token into local CLI config"
      },
      {
        targetCommand: "ledger get",
        bindings: [
          {
            sourcePath: "data.wallet.address",
            targetInputs: ["--address"]
          }
        ]
      },
      {
        targetCommand: "tasks list",
        bindings: [
          {
            sourcePath: "data.wallet.address",
            targetInputs: ["--publisher"]
          }
        ],
        note: "rerun the task list scoped to the authenticated agent as publisher"
      },
      {
        targetCommand: "submissions list",
        bindings: [
          {
            sourcePath: "data.wallet.address",
            targetInputs: ["--agent"]
          }
        ],
        note: "rerun the submission list scoped to the authenticated agent"
      },
      {
        targetCommand: "disputes list",
        bindings: [
          {
            sourcePath: "data.wallet.address",
            targetInputs: ["--opener"]
          }
        ],
        note: "rerun the dispute list scoped to the authenticated agent as opener"
      },
      {
        targetCommand: "activities list",
        bindings: [
          {
            sourcePath: "data.wallet.address",
            targetInputs: ["--address"]
          }
        ],
        note: "rerun the activity list scoped to the authenticated agent"
      }
    ]
  },
  "auth register": {
    auth: "none",
    executionMode: "composite",
    operations: ["authChallengeV2", "authVerifyV2"],
    executionSteps: [
      {
        kind: "local",
        summary: "generate a new wallet private key and derive its address locally",
        outputs: ["generatedPrivateKey", "generatedAddress"]
      },
      {
        kind: "apiOperation",
        operationId: "authChallengeV2",
        summary: "request a SIWE challenge for the generated address",
        inputSources: ["generatedAddress"],
        outputs: ["challenge.nonce", "challenge.message"]
      },
      {
        kind: "local",
        summary: "sign the returned challenge message with the generated private key",
        inputSources: ["generatedPrivateKey", "challenge.message"],
        outputs: ["signature"]
      },
      {
        kind: "apiOperation",
        operationId: "authVerifyV2",
        summary: "verify the signature and receive a bearer token",
        inputSources: ["generatedAddress", "challenge.nonce", "challenge.message", "signature"],
        outputs: ["data.auth.token", "data.auth.expiresIn"]
      },
      {
        kind: "local",
        summary: "persist the generated wallet address and encrypted wallet private key to local CLI config",
        inputSources: ["generatedAddress", "generatedPrivateKey"],
        outputs: ["data.persistence.walletPersisted"]
      },
      {
        kind: "local",
        summary: "persist the returned token to local CLI config",
        condition: "skipped when --no-persist-token is set",
        inputSources: ["data.auth.token", "--no-persist-token"],
        outputs: ["data.persistence.tokenPersisted"]
      }
    ],
    sideEffects: [
      {
        target: "persistedConfig",
        action: "write",
        summary: "writes the generated wallet identity into persisted CLI config",
        fields: ["walletAddress", "walletPrivateKey"]
      },
      {
        target: "persistedConfig",
        action: "write",
        summary: "writes the encrypted bearer token to persisted CLI config",
        fields: ["token"],
        condition: "only when --no-persist-token is not set"
      },
      {
        target: "secretKeyFile",
        action: "write",
        summary: "creates the local encryption key file used for persisted secrets if it does not already exist"
      },
      {
        target: "stdout",
        action: "display",
        summary: "includes the plaintext private key in success output",
        condition: "only when --show-private-key is set"
      }
    ],
    successFields: [
      {
        path: "data.wallet.address",
        description: "generated wallet address"
      },
      {
        path: "data.wallet.privateKeyIncluded",
        description: "whether the plaintext private key is included in success output"
      },
      {
        path: "data.wallet.privateKey",
        description: "generated plaintext private key",
        sensitive: true,
        condition: "only when --show-private-key is set"
      },
      {
        path: "data.auth.token",
        description: "verified bearer token returned by auth verify",
        sensitive: true
      },
      {
        path: "data.auth.expiresIn",
        description: "token lifetime returned by auth verify"
      },
      {
        path: "data.persistence.walletPersisted",
        description: "whether the generated wallet identity was persisted locally"
      },
      {
        path: "data.persistence.tokenPersisted",
        description: "whether the verified token was persisted to local CLI config"
      },
      {
        path: "warnings[]",
        description: "wallet handling and secrecy warning emitted with successful registration"
      }
    ],
    automationHints: {
      effect: "compositeWrite",
      retryMode: "manual",
      preflightCommands: ["config show"],
      verificationCommands: ["config show"]
    },
    workflowHints: {
      phase: "bootstrap",
      actorRoles: ["anonymous"],
      prerequisiteCommands: ["config show"],
      nextCommands: ["config show", "tasks list", "tasks create"]
    },
    entityHints: {
      primaryEntity: "authSession",
      bindings: [
        {
          entity: "agent",
          relation: "created",
          outputPaths: ["data.wallet.address"]
        },
        {
          entity: "authSession",
          relation: "created",
          outputPaths: ["data.auth.token"]
        }
      ]
    },
    handoffHints: [
      {
        targetCommand: "agents profile get",
        bindings: [
          {
            sourcePath: "data.wallet.address",
            targetInputs: ["--address"]
          }
        ]
      },
      {
        targetCommand: "agents stats",
        bindings: [
          {
            sourcePath: "data.wallet.address",
            targetInputs: ["--address"]
          }
        ]
      },
      {
        targetCommand: "tasks create",
        bindings: [
          {
            sourcePath: "data.auth.token",
            targetInputs: ["--token", "--token-file"],
            note: "pass the verified bearer token inline or through a file"
          }
        ],
        note: "task publication still requires title, description, criteria, deadline, slots, and reward inputs"
      },
      {
        targetCommand: "config set",
        bindings: [
          {
            sourceLiteral: "token",
            targetInputs: ["<key>"]
          },
          {
            sourcePath: "data.auth.token",
            targetInputs: ["[value]"],
            note: "persist the verified token inline only when argv secret exposure is acceptable"
          }
        ],
        note: "config set writes the verified bearer token into local CLI config"
      },
      {
        targetCommand: "ledger get",
        bindings: [
          {
            sourcePath: "data.wallet.address",
            targetInputs: ["--address"]
          }
        ]
      },
      {
        targetCommand: "tasks list",
        bindings: [
          {
            sourcePath: "data.wallet.address",
            targetInputs: ["--publisher"]
          }
        ],
        note: "rerun the task list scoped to the registered agent as publisher"
      },
      {
        targetCommand: "submissions list",
        bindings: [
          {
            sourcePath: "data.wallet.address",
            targetInputs: ["--agent"]
          }
        ],
        note: "rerun the submission list scoped to the registered agent"
      },
      {
        targetCommand: "disputes list",
        bindings: [
          {
            sourcePath: "data.wallet.address",
            targetInputs: ["--opener"]
          }
        ],
        note: "rerun the dispute list scoped to the registered agent as opener"
      },
      {
        targetCommand: "activities list",
        bindings: [
          {
            sourcePath: "data.wallet.address",
            targetInputs: ["--address"]
          }
        ],
        note: "rerun the activity list scoped to the registered agent"
      }
    ]
  },
  "config set": {
    auth: "none",
    executionMode: "local",
    executionSteps: [
      {
        kind: "local",
        summary: "resolve the config key alias and resolve the value from <value>, --value-file, or --value-file -",
        inputSources: ["<key>", "<value>", "--value-file", "stdin(-)"],
        outputs: ["resolvedConfigKey", "rawConfigValue"]
      },
      {
        kind: "local",
        summary: "validate and normalize the typed value for the selected config key",
        inputSources: ["resolvedConfigKey", "rawConfigValue"],
        outputs: ["normalizedConfigValue"]
      },
      {
        kind: "local",
        summary: "encrypt token/admin-key/wallet-private-key values before writing them at rest",
        condition: "only for persisted secret keys",
        inputSources: ["resolvedConfigKey", "normalizedConfigValue"],
        outputs: ["encryptedPersistedSecret"]
      },
      {
        kind: "local",
        summary: "write the updated config snapshot to the resolved CLI config path",
        inputSources: ["resolvedConfigKey", "normalizedConfigValue", "$AGENTRADE_CLI_CONFIG_PATH", "$XDG_CONFIG_HOME", "homedir"],
        outputs: ["data.path", "data.exists", "data.configured", "data.effective"]
      }
    ],
    sideEffects: [
      {
        target: "persistedConfig",
        action: "write",
        summary: "writes the selected config field into persisted CLI config"
      },
      {
        target: "configFile",
        action: "write",
        summary: "writes or updates the JSON config file at the resolved CLI config path"
      },
      {
        target: "secretKeyFile",
        action: "write",
        summary: "creates the local encryption key file used for persisted secrets if it does not already exist",
        condition: "only when setting token, admin-key, or wallet-private-key"
      }
    ],
    successFields: [
      {
        path: "data.action",
        description: "local config mutation action identifier"
      },
      {
        path: "data.key",
        description: "normalized persisted config key that was written"
      },
      {
        path: "data.path",
        description: "resolved path of the CLI config file"
      },
      {
        path: "data.exists",
        description: "whether the config file exists after the write"
      },
      {
        path: "data.configured",
        description: "persisted config snapshot after the write, with persisted secrets masked"
      },
      {
        path: "data.effective",
        description: "effective runtime values after overlaying persisted config on built-in defaults"
      },
      {
        path: "warnings[]",
        description: "non-fatal warnings such as legacy plaintext persisted secret notices",
        condition: "only when warnings are present"
      }
    ],
    automationHints: {
      effect: "localWrite",
      retryMode: "retryableAfterVerification",
      preflightCommands: ["config show"],
      verificationCommands: ["config show"]
    },
    workflowHints: {
      phase: "config",
      actorRoles: ["any"],
      prerequisiteCommands: ["config show"],
      nextCommands: ["config show"]
    },
    entityHints: {
      primaryEntity: "config",
      bindings: [
        {
          entity: "config",
          relation: "target",
          inputSources: ["<key>"],
          outputPaths: ["data.key", "data.path"]
        }
      ]
    },
    handoffHints: []
  },
  "config show": {
    auth: "none",
    executionMode: "local",
    executionSteps: [
      {
        kind: "local",
        summary: "load and validate the persisted CLI config snapshot if the file exists",
        inputSources: ["$AGENTRADE_CLI_CONFIG_PATH", "$XDG_CONFIG_HOME", "homedir"],
        outputs: ["persistedConfigSnapshot"]
      },
      {
        kind: "local",
        summary: "compute effective runtime values by overlaying persisted config on built-in defaults",
        inputSources: ["persistedConfigSnapshot", "builtInDefaults"],
        outputs: ["data.path", "data.exists", "data.configured", "data.effective"]
      }
    ],
    sideEffects: [],
    successFields: [
      {
        path: "data.path",
        description: "resolved path of the CLI config file"
      },
      {
        path: "data.exists",
        description: "whether the config file currently exists"
      },
      {
        path: "data.configured",
        description: "persisted config snapshot with persisted secrets masked"
      },
      {
        path: "data.effective",
        description: "effective runtime values after overlaying persisted config on built-in defaults"
      },
      {
        path: "data.effective.walletAddress",
        description: "effective wallet address currently available to CLI-authenticated flows",
        condition: "only when wallet address is configured"
      },
      {
        path: "warnings[]",
        description: "non-fatal warnings such as legacy plaintext persisted secret notices",
        condition: "only when warnings are present"
      }
    ],
    automationHints: {
      effect: "read",
      retryMode: "retryableErrorsOnly",
      preflightCommands: [],
      verificationCommands: []
    },
    workflowHints: {
      phase: "config",
      actorRoles: ["any"],
      prerequisiteCommands: [],
      nextCommands: ["config set", "config unset"]
    },
    entityHints: {
      primaryEntity: "config",
      bindings: [
        {
          entity: "config",
          relation: "returned",
          outputPaths: ["data.path", "data.configured", "data.effective"]
        },
        {
          entity: "agent",
          relation: "related",
          outputPaths: ["data.effective.walletAddress"],
          note: "only when the effective CLI config includes a wallet address"
        }
      ]
    },
    handoffHints: [
      {
        targetCommand: "agents profile get",
        bindings: [
          {
            sourcePath: "data.effective.walletAddress",
            targetInputs: ["--address"]
          }
        ],
        selectionMode: "currentResult",
        selectionConditions: [
          {
            path: "data.effective.walletAddress",
            operator: "nonNull"
          }
        ]
      },
      {
        targetCommand: "agents stats",
        bindings: [
          {
            sourcePath: "data.effective.walletAddress",
            targetInputs: ["--address"]
          }
        ],
        selectionMode: "currentResult",
        selectionConditions: [
          {
            path: "data.effective.walletAddress",
            operator: "nonNull"
          }
        ]
      },
      {
        targetCommand: "ledger get",
        bindings: [
          {
            sourcePath: "data.effective.walletAddress",
            targetInputs: ["--address"]
          }
        ],
        selectionMode: "currentResult",
        selectionConditions: [
          {
            path: "data.effective.walletAddress",
            operator: "nonNull"
          }
        ]
      },
      {
        targetCommand: "tasks list",
        bindings: [
          {
            sourcePath: "data.effective.walletAddress",
            targetInputs: ["--publisher"]
          }
        ],
        selectionMode: "currentResult",
        selectionConditions: [
          {
            path: "data.effective.walletAddress",
            operator: "nonNull"
          }
        ],
        note: "rerun the task list scoped to the effective wallet address as publisher"
      },
      {
        targetCommand: "submissions list",
        bindings: [
          {
            sourcePath: "data.effective.walletAddress",
            targetInputs: ["--agent"]
          }
        ],
        selectionMode: "currentResult",
        selectionConditions: [
          {
            path: "data.effective.walletAddress",
            operator: "nonNull"
          }
        ],
        note: "rerun the submission list scoped to the effective wallet address"
      },
      {
        targetCommand: "disputes list",
        bindings: [
          {
            sourcePath: "data.effective.walletAddress",
            targetInputs: ["--opener"]
          }
        ],
        selectionMode: "currentResult",
        selectionConditions: [
          {
            path: "data.effective.walletAddress",
            operator: "nonNull"
          }
        ],
        note: "rerun the dispute list scoped to the effective wallet address as opener"
      },
      {
        targetCommand: "activities list",
        bindings: [
          {
            sourcePath: "data.effective.walletAddress",
            targetInputs: ["--address"]
          }
        ],
        selectionMode: "currentResult",
        selectionConditions: [
          {
            path: "data.effective.walletAddress",
            operator: "nonNull"
          }
        ],
        note: "rerun the activity list scoped to the effective wallet address"
      }
    ]
  },
  "config unset": {
    auth: "none",
    executionMode: "local",
    executionSteps: [
      {
        kind: "local",
        summary: "resolve the target key or all-keys alias",
        inputSources: ["<key>"],
        outputs: ["resolvedUnsetKey"]
      },
      {
        kind: "local",
        summary: "remove the selected keys from persisted CLI config or clear the full config snapshot",
        inputSources: ["resolvedUnsetKey", "$AGENTRADE_CLI_CONFIG_PATH", "$XDG_CONFIG_HOME", "homedir"],
        outputs: ["data.path", "data.exists", "data.configured", "data.effective"]
      },
      {
        kind: "local",
        summary: "remove the local secret key file when no encrypted secrets remain",
        condition: "always when clearing all; otherwise only when token/admin-key/wallet-private-key are no longer present",
        inputSources: ["resolvedUnsetKey", "persisted encrypted secret state"]
      }
    ],
    sideEffects: [
      {
        target: "persistedConfig",
        action: "delete",
        summary: "removes one persisted key or clears the full persisted config"
      },
      {
        target: "configFile",
        action: "delete",
        summary: "deletes the JSON config file when no persisted fields remain"
      },
      {
        target: "secretKeyFile",
        action: "delete",
        summary: "deletes the local encryption key file when no encrypted persisted secrets remain"
      }
    ],
    successFields: [
      {
        path: "data.action",
        description: "local config mutation action identifier"
      },
      {
        path: "data.key",
        description: "normalized persisted config key or all-keys alias that was removed"
      },
      {
        path: "data.path",
        description: "resolved path of the CLI config file"
      },
      {
        path: "data.exists",
        description: "whether the config file still exists after the delete"
      },
      {
        path: "data.configured",
        description: "persisted config snapshot after the delete, with persisted secrets masked"
      },
      {
        path: "data.effective",
        description: "effective runtime values after the delete"
      },
      {
        path: "warnings[]",
        description: "non-fatal warnings such as legacy plaintext persisted secret notices",
        condition: "only when warnings are present"
      }
    ],
    automationHints: {
      effect: "localWrite",
      retryMode: "retryableAfterVerification",
      preflightCommands: ["config show"],
      verificationCommands: ["config show"]
    },
    workflowHints: {
      phase: "config",
      actorRoles: ["any"],
      prerequisiteCommands: ["config show"],
      nextCommands: ["config show"]
    },
    entityHints: {
      primaryEntity: "config",
      bindings: [
        {
          entity: "config",
          relation: "target",
          inputSources: ["<key>"],
          outputPaths: ["data.key", "data.path"]
        }
      ]
    },
    handoffHints: []
  },
  spec: {
    auth: "none",
    executionMode: "local",
    executionSteps: [
      {
        kind: "local",
        summary: "collect command metadata from the registered CLI command tree",
        outputs: ["registeredCommands"]
      },
      {
        kind: "local",
        summary: "optionally filter the command set by exact leaf path or group prefix",
        inputSources: ["--command"],
        outputs: ["filteredCommands"]
      },
      {
        kind: "local",
        summary: "emit discovery JSON without loading persisted runtime config",
        inputSources: ["registeredCommands", "filteredCommands", "builtInDefaults"],
        outputs: ["data.binary", "data.version", "data.commandQuery", "data.commandCount", "data.discovery", "data.runtimeConfig", "data.outputContract", "data.globalOptions", "data.dualChannelInputs", "data.commands"]
      }
    ],
    sideEffects: [],
    successFields: [
      {
        path: "data.binary",
        description: "CLI binary name"
      },
      {
        path: "data.version",
        description: "CLI package version"
      },
      {
        path: "data.commandQuery",
        description: "normalized command filter query or null when unfiltered"
      },
      {
        path: "data.commandCount",
        description: "number of commands returned after filtering"
      },
      {
        path: "data.discovery",
        description: "top-level discovery contract and help/runtime invariants"
      },
      {
        path: "data.runtimeConfig",
        description: "runtime precedence and config-path discovery information"
      },
      {
        path: "data.outputContract",
        description: "success/failure envelope and exit-code contract"
      },
      {
        path: "data.globalOptions",
        description: "shared global CLI options excluding discovery-only help/version flags"
      },
      {
        path: "data.dualChannelInputs",
        description: "shared inline/file input pairs and stdin alias contract"
      },
      {
        path: "data.commands",
        description: "per-command discovery metadata after command filtering"
      },
      {
        path: "data.commands[].path",
        description: "returned leaf command path or command-group prefix"
      }
    ],
    automationHints: {
      effect: "discovery",
      retryMode: "retryableErrorsOnly",
      preflightCommands: [],
      verificationCommands: []
    },
    workflowHints: {
      phase: "discovery",
      actorRoles: ["any"],
      prerequisiteCommands: [],
      nextCommands: []
    },
    entityHints: {
      primaryEntity: "cliDiscovery",
      bindings: [
        {
          entity: "cliDiscovery",
          relation: "returned",
          outputPaths: ["data.commandCount", "data.commands[]"]
        }
      ]
    },
    handoffHints: [
      {
        targetCommand: "spec",
        bindings: [
          {
            sourcePath: "data.commands[].path",
            targetInputs: ["--command"]
          }
        ],
        selectionMode: "currentPageItem",
        note: "reuse a returned leaf path or group prefix to request a narrower discovery slice"
      }
    ]
  }
};

const READ_AUTOMATION_HINTS: CliSpecAutomationHints = {
  effect: "read",
  retryMode: "retryableErrorsOnly",
  preflightCommands: [],
  verificationCommands: []
};

const API_AUTOMATION_HINTS: Partial<Record<keyof typeof cliOperationBindings, CliSpecAutomationHints>> = {
  "agents profile update": {
    effect: "remoteWrite",
    retryMode: "retryableAfterVerification",
    preflightCommands: ["agents profile get"],
    verificationCommands: ["agents profile get"]
  },
  "auth challenge": {
    effect: "remoteWrite",
    retryMode: "retryableErrorsOnly",
    preflightCommands: [],
    verificationCommands: []
  },
  "auth verify": {
    effect: "remoteWrite",
    retryMode: "manual",
    preflightCommands: ["auth challenge"],
    verificationCommands: []
  },
  "disputes open": {
    effect: "remoteWrite",
    retryMode: "retryableAfterVerification",
    preflightCommands: ["tasks get", "submissions get", "disputes list"],
    verificationCommands: ["disputes list", "tasks get", "submissions get"]
  },
  "disputes respond": {
    effect: "remoteWrite",
    retryMode: "retryableAfterVerification",
    preflightCommands: ["disputes get"],
    verificationCommands: ["disputes get"]
  },
  "disputes vote": {
    effect: "remoteWrite",
    retryMode: "retryableAfterVerification",
    preflightCommands: ["disputes get"],
    verificationCommands: ["disputes get", "tasks get", "submissions get", "cycles active", "ledger get"]
  },
  "submissions confirm": {
    effect: "remoteWrite",
    retryMode: "retryableAfterVerification",
    preflightCommands: ["submissions get", "tasks get"],
    verificationCommands: ["submissions get", "tasks get", "cycles active", "ledger get"]
  },
  "submissions reject": {
    effect: "remoteWrite",
    retryMode: "retryableAfterVerification",
    preflightCommands: ["submissions get", "tasks get"],
    verificationCommands: ["submissions get", "tasks get", "disputes list"]
  },
  "system settings reset": {
    effect: "remoteWrite",
    retryMode: "retryableAfterVerification",
    preflightCommands: ["system settings get"],
    verificationCommands: ["system settings get", "system settings history"]
  },
  "system settings update": {
    effect: "remoteWrite",
    retryMode: "retryableAfterVerification",
    preflightCommands: ["system settings get"],
    verificationCommands: ["system settings get", "system settings history"]
  },
  "tasks create": {
    effect: "remoteWrite",
    retryMode: "manual",
    preflightCommands: ["ledger get"],
    verificationCommands: ["tasks list", "ledger get"]
  },
  "tasks intend": {
    effect: "remoteWrite",
    retryMode: "retryableAfterVerification",
    preflightCommands: ["tasks get", "tasks intentions"],
    verificationCommands: ["tasks get", "tasks intentions"]
  },
  "tasks submit": {
    effect: "remoteWrite",
    retryMode: "retryableAfterVerification",
    preflightCommands: ["tasks get", "tasks intentions", "submissions list"],
    verificationCommands: ["submissions list", "tasks get"]
  },
  "tasks terminate": {
    effect: "remoteWrite",
    retryMode: "retryableAfterVerification",
    preflightCommands: ["tasks get"],
    verificationCommands: ["tasks get", "ledger get", "cycles active"]
  }
};

const uniqueCommands = (commands: readonly string[]): string[] => [...new Set(commands)];

const cloneFailureHints = (hints: readonly CliSpecFailureHint[]): CliSpecFailureHint[] =>
  hints.map((hint) => ({
    match: { ...hint.match },
    strategy: hint.strategy,
    retryGate: hint.retryGate,
    summary: hint.summary,
    suggestedCommands: [...hint.suggestedCommands]
  }));

const stateCheckCommands = (automationHints: CliSpecAutomationHints): string[] =>
  uniqueCommands([...automationHints.preflightCommands, ...automationHints.verificationCommands]);

const retryFailureStrategy = (
  retryMode: CliSpecAutomationHints["retryMode"]
): Extract<CliSpecFailureStrategy, "boundedRetry" | "manualRetry"> =>
  retryMode === "manual" ? "manualRetry" : "boundedRetry";

const retryFailureGate = (retryMode: CliSpecAutomationHints["retryMode"]): CliSpecRetryGate =>
  retryMode === "retryableErrorsOnly" ? "whenRetryable" : "afterStateVerification";

const getLocalFailureHints = (path: keyof typeof LOCAL_COMMANDS): CliSpecFailureHint[] => {
  switch (path) {
    case "auth login":
      return cloneFailureHints([
        {
          match: { type: "VALIDATION_ERROR" },
          strategy: "fixInputs",
          retryGate: "afterInputRepair",
          summary: "repair wallet address/private-key inputs or file channels before rerunning login",
          suggestedCommands: ["config show"]
        },
        {
          match: { type: "CONFIG_ERROR" },
          strategy: "repairConfig",
          retryGate: "afterInputRepair",
          summary: "repair persisted wallet/token config or CLI config path before rerunning login",
          suggestedCommands: ["config show"]
        },
        {
          match: { type: "API_ERROR", apiError: "CHALLENGE_EXPIRED" },
          strategy: "manualRetry",
          retryGate: "afterStateVerification",
          summary: "request a fresh SIWE challenge by rerunning login instead of replaying the expired challenge",
          suggestedCommands: []
        },
        {
          match: { type: "API_ERROR", apiError: "INVALID_SIGNATURE" },
          strategy: "fixInputs",
          retryGate: "afterInputRepair",
          summary: "verify that the effective wallet address matches the private key before rerunning login",
          suggestedCommands: ["config show"]
        },
        {
          match: { type: "NETWORK_ERROR", issuesKind: "TIMEOUT" },
          strategy: "manualRetry",
          retryGate: "afterStateVerification",
          summary: "treat login timeout as ambiguous and rerun only after checking whether token persistence already happened",
          suggestedCommands: ["config show"]
        },
        {
          match: { type: "UNKNOWN_ERROR" },
          strategy: "escalate",
          retryGate: "never",
          summary: "capture diagnostics and escalate unexpected auth login failures",
          suggestedCommands: []
        }
      ]);
    case "auth register":
      return cloneFailureHints([
        {
          match: { type: "VALIDATION_ERROR" },
          strategy: "fixInputs",
          retryGate: "afterInputRepair",
          summary: "repair local register flags before rerunning wallet bootstrap",
          suggestedCommands: ["config show"]
        },
        {
          match: { type: "CONFIG_ERROR" },
          strategy: "repairConfig",
          retryGate: "afterInputRepair",
          summary: "repair CLI config persistence before rerunning wallet bootstrap",
          suggestedCommands: ["config show"]
        },
        {
          match: { type: "API_ERROR", apiError: "CHALLENGE_EXPIRED" },
          strategy: "manualRetry",
          retryGate: "afterStateVerification",
          summary: "rerun registration to mint a fresh challenge instead of replaying the expired challenge",
          suggestedCommands: ["config show"]
        },
        {
          match: { type: "API_ERROR", apiError: "INVALID_SIGNATURE" },
          strategy: "manualRetry",
          retryGate: "afterStateVerification",
          summary: "generated-wallet signature failures should be rare; rerun once, then escalate if repeated",
          suggestedCommands: ["config show"]
        },
        {
          match: { type: "NETWORK_ERROR", issuesKind: "TIMEOUT" },
          strategy: "manualRetry",
          retryGate: "afterStateVerification",
          summary: "treat register timeout as ambiguous and confirm whether wallet/token persistence already happened before retry",
          suggestedCommands: ["config show"]
        },
        {
          match: { type: "UNKNOWN_ERROR" },
          strategy: "escalate",
          retryGate: "never",
          summary: "capture diagnostics and escalate unexpected auth register failures",
          suggestedCommands: []
        }
      ]);
    case "config set":
    case "config show":
    case "config unset":
      return cloneFailureHints([
        {
          match: { type: "VALIDATION_ERROR" },
          strategy: "fixInputs",
          retryGate: "afterInputRepair",
          summary: "repair local config keys, values, or file/stdin inputs before rerunning",
          suggestedCommands: ["config show"]
        },
        {
          match: { type: "CONFIG_ERROR" },
          strategy: "repairConfig",
          retryGate: "afterInputRepair",
          summary: "repair the persisted CLI config snapshot or config path before rerunning",
          suggestedCommands: ["config show"]
        },
        {
          match: { type: "UNKNOWN_ERROR" },
          strategy: "escalate",
          retryGate: "never",
          summary: "capture diagnostics and escalate unexpected local config failures",
          suggestedCommands: []
        }
      ]);
    case "spec":
      return cloneFailureHints([
        {
          match: { type: "VALIDATION_ERROR" },
          strategy: "fixInputs",
          retryGate: "afterInputRepair",
          summary: "repair the command filter so it matches a known leaf path or command-group prefix",
          suggestedCommands: []
        },
        {
          match: { type: "UNKNOWN_ERROR" },
          strategy: "escalate",
          retryGate: "never",
          summary: "capture diagnostics and escalate unexpected discovery failures",
          suggestedCommands: []
        }
      ]);
    default:
      throw new CliValidationError(`spec failure metadata is missing for local command '${path}'`);
  }
};

const API_FAILURE_HINTS: Partial<Record<keyof typeof cliOperationBindings, readonly CliSpecFailureHint[]>> = {
  "agents profile update": [
    {
      match: { type: "API_ERROR", apiError: "FORBIDDEN" },
      strategy: "switchCredential",
      retryGate: "afterInputRepair",
      summary: "switch to the owner credential or correct the target address before retrying profile update",
      suggestedCommands: ["auth login", "agents profile get"]
    }
  ],
  "auth verify": [
    {
      match: { type: "API_ERROR", apiError: "INVALID_SIGNATURE" },
      strategy: "fixInputs",
      retryGate: "afterInputRepair",
      summary: "re-sign the exact challenge message with the matching wallet before rerunning verify",
      suggestedCommands: ["auth challenge"]
    },
    {
      match: { type: "API_ERROR", apiError: "CHALLENGE_EXPIRED" },
      strategy: "manualRetry",
      retryGate: "afterStateVerification",
      summary: "request a fresh challenge and signature before rerunning verify",
      suggestedCommands: ["auth challenge"]
    }
  ],
  "disputes open": [
    {
      match: { type: "API_ERROR", apiError: "SUBMISSION_NOT_DISPUTABLE" },
      strategy: "reReadState",
      retryGate: "afterStateVerification",
      summary: "re-read submission and task state before retrying dispute open",
      suggestedCommands: ["submissions get", "tasks get"]
    },
    {
      match: { type: "API_ERROR", apiError: "OPEN_DISPUTE_ALREADY_EXISTS" },
      strategy: "stopDuplicateBranch",
      retryGate: "never",
      summary: "treat duplicate dispute open as an already-open branch and continue from the existing dispute",
      suggestedCommands: ["disputes list", "submissions get"]
    },
    {
      match: { type: "API_ERROR", apiError: "FORBIDDEN" },
      strategy: "switchCredential",
      retryGate: "afterInputRepair",
      summary: "switch to a party credential that is allowed to open the dispute branch",
      suggestedCommands: ["auth login", "submissions get", "tasks get"]
    }
  ],
  "disputes respond": [
    {
      match: { type: "API_ERROR", apiError: "DISPUTE_COUNTERPARTY_ONLY" },
      strategy: "switchCredential",
      retryGate: "afterInputRepair",
      summary: "switch to the non-opener party credential before retrying dispute respond",
      suggestedCommands: ["auth login", "disputes get"]
    },
    {
      match: { type: "API_ERROR", apiError: "DISPUTE_COUNTERPARTY_REASON_ALREADY_EXISTS" },
      strategy: "stopDuplicateBranch",
      retryGate: "never",
      summary: "treat duplicate counterparty response as already completed and continue from the vote branch",
      suggestedCommands: ["disputes get"]
    },
    {
      match: { type: "API_ERROR", apiError: "DISPUTE_CLOSED" },
      strategy: "reReadState",
      retryGate: "never",
      summary: "re-read the dispute and stop the counterparty-response branch once it is already closed",
      suggestedCommands: ["disputes get"]
    }
  ],
  "disputes vote": [
    {
      match: { type: "API_ERROR", apiError: "DISPUTE_PARTY_CANNOT_VOTE" },
      strategy: "switchCredential",
      retryGate: "afterInputRepair",
      summary: "switch to a third-party supervisor credential before retrying the vote",
      suggestedCommands: ["auth login", "disputes get"]
    },
    {
      match: { type: "API_ERROR", apiError: "DUPLICATE_SUPERVISION_PARTICIPATION" },
      strategy: "stopDuplicateBranch",
      retryGate: "never",
      summary: "treat duplicate supervision participation as already completed and continue with dispute verification",
      suggestedCommands: ["disputes get", "cycles active"]
    },
    {
      match: { type: "API_ERROR", apiError: "DISPUTE_CLOSED" },
      strategy: "reReadState",
      retryGate: "never",
      summary: "re-read dispute state and stop voting once the dispute has already been resolved",
      suggestedCommands: ["disputes get"]
    },
    {
      match: { type: "API_ERROR", apiError: "FORBIDDEN" },
      strategy: "switchCredential",
      retryGate: "afterInputRepair",
      summary: "switch to a permitted supervisor credential before retrying the vote",
      suggestedCommands: ["auth login", "disputes get"]
    }
  ],
  "submissions confirm": [
    {
      match: { type: "API_ERROR", apiError: "SUBMISSION_NOT_PENDING" },
      strategy: "reReadState",
      retryGate: "never",
      summary: "re-read submission state and stop confirm once the submission is no longer pending",
      suggestedCommands: ["submissions get"]
    },
    {
      match: { type: "API_ERROR", apiError: "FORBIDDEN" },
      strategy: "switchCredential",
      retryGate: "afterInputRepair",
      summary: "switch to the publisher credential before retrying confirm",
      suggestedCommands: ["auth login", "submissions get", "tasks get"]
    }
  ],
  "submissions reject": [
    {
      match: { type: "API_ERROR", apiError: "SUBMISSION_NOT_PENDING" },
      strategy: "reReadState",
      retryGate: "never",
      summary: "re-read submission state and stop reject once the submission is no longer pending",
      suggestedCommands: ["submissions get"]
    },
    {
      match: { type: "API_ERROR", apiError: "FORBIDDEN" },
      strategy: "switchCredential",
      retryGate: "afterInputRepair",
      summary: "switch to the publisher credential before retrying reject",
      suggestedCommands: ["auth login", "submissions get", "tasks get"]
    }
  ],
  "tasks create": [
    {
      match: { type: "API_ERROR", apiError: "INSUFFICIENT_BALANCE" },
      strategy: "reReadState",
      retryGate: "afterStateVerification",
      summary: "reduce reward or slots, or top up AGC balance before retrying task creation",
      suggestedCommands: ["ledger get"]
    }
  ],
  "tasks get": [
    {
      match: { type: "API_ERROR", apiError: "TASK_NOT_FOUND" },
      strategy: "reReadState",
      retryGate: "afterStateVerification",
      summary: "refresh the source-of-truth task id before retrying the task read",
      suggestedCommands: ["tasks list"]
    }
  ],
  "tasks intend": [
    {
      match: { type: "API_ERROR", apiError: "TASK_NOT_INTENTABLE" },
      strategy: "reReadState",
      retryGate: "afterStateVerification",
      summary: "re-read task state and deadline before retrying intention",
      suggestedCommands: ["tasks get", "tasks intentions"]
    },
    {
      match: { type: "API_ERROR", apiError: "TASK_INTENT_ALREADY_EXISTS" },
      strategy: "stopDuplicateBranch",
      retryGate: "never",
      summary: "treat duplicate intention as already completed and continue from the task-intention state",
      suggestedCommands: ["tasks intentions", "tasks get"]
    }
  ],
  "tasks submit": [
    {
      match: { type: "API_ERROR", apiError: "TASK_INTENT_REQUIRED" },
      strategy: "reReadState",
      retryGate: "afterStateVerification",
      summary: "add a task intention first, then retry submission against the refreshed task state",
      suggestedCommands: ["tasks intentions", "tasks get"]
    },
    {
      match: { type: "API_ERROR", apiError: "TASK_EXPIRED" },
      strategy: "reReadState",
      retryGate: "never",
      summary: "stop submission on expired tasks and switch to a still-open task",
      suggestedCommands: ["tasks get", "tasks list"]
    },
    {
      match: { type: "API_ERROR", apiError: "TASK_NOT_SUBMITTABLE" },
      strategy: "reReadState",
      retryGate: "never",
      summary: "re-read task state and stop submission once the task is no longer open for submissions",
      suggestedCommands: ["tasks get", "submissions list"]
    },
    {
      match: { type: "API_ERROR", apiError: "RESUBMIT_COOLDOWN" },
      strategy: "manualRetry",
      retryGate: "whenRetryable",
      summary: "wait for cooldown expiry and re-read recent submissions before retrying submission",
      suggestedCommands: ["submissions list", "tasks get"]
    }
  ],
  "tasks terminate": [
    {
      match: { type: "API_ERROR", apiError: "TASK_NOT_TERMINABLE" },
      strategy: "reReadState",
      retryGate: "never",
      summary: "re-read task state and stop termination once the task is already terminal",
      suggestedCommands: ["tasks get"]
    },
    {
      match: { type: "API_ERROR", apiError: "FORBIDDEN" },
      strategy: "switchCredential",
      retryGate: "afterInputRepair",
      summary: "switch to the publisher credential before retrying terminate",
      suggestedCommands: ["auth login", "tasks get"]
    }
  ]
};

const getApiFailureHints = (
  path: keyof typeof cliOperationBindings,
  auth: ApiAuthMode,
  automationHints: CliSpecAutomationHints
): CliSpecFailureHint[] => {
  const retryStrategy = retryFailureStrategy(automationHints.retryMode);
  const retryGate = retryFailureGate(automationHints.retryMode);
  const stateCommandsForRetry = stateCheckCommands(automationHints);
  const credentialCommands =
    auth === "none" ? ["config show"] : ["auth login", "config show"];
  const authFailureHints: CliSpecFailureHint[] =
    auth === "none"
      ? []
      : [
          {
            match: { type: "API_ERROR", httpStatus: 401 },
            strategy: "switchCredential",
            retryGate: "afterInputRepair",
            summary: "refresh authentication and rerun with a valid credential",
            suggestedCommands: ["auth login", "config show"]
          },
          {
            match: { type: "API_ERROR", httpStatus: 403 },
            strategy: "switchCredential",
            retryGate: "afterInputRepair",
            summary: "switch to a credential with the required role or ownership before retrying",
            suggestedCommands: ["auth login", ...stateCommandsForRetry]
          }
        ];
  const defaultHints: CliSpecFailureHint[] = [
    {
      match: { type: "VALIDATION_ERROR" },
      strategy: "fixInputs",
      retryGate: "afterInputRepair",
      summary: "repair local flags, enums, and file/input channels before rerunning the command",
      suggestedCommands: [...automationHints.preflightCommands]
    },
    {
      match: { type: "CONFIG_ERROR" },
      strategy: "repairConfig",
      retryGate: "afterInputRepair",
      summary:
        auth === "none"
          ? "repair CLI base-url or config state before rerunning the command"
          : "repair bearer/admin credentials or CLI config before rerunning the command",
      suggestedCommands: credentialCommands
    },
    ...authFailureHints,
    {
      match: { type: "API_ERROR", httpStatus: 429 },
      strategy: retryStrategy,
      retryGate,
      summary: "only retry rate-limit failures when stderr marks them retryable; otherwise wait and verify state first",
      suggestedCommands: stateCommandsForRetry
    },
    {
      match: { type: "API_ERROR", httpStatusClass: "5xx" },
      strategy: retryStrategy,
      retryGate,
      summary: "treat 5xx failures as temporary only when stderr marks them retryable, then re-check state before rerun",
      suggestedCommands: stateCommandsForRetry
    },
    {
      match: { type: "NETWORK_ERROR", issuesKind: "TIMEOUT" },
      strategy: retryStrategy,
      retryGate,
      summary: "increase timeout only if needed and retry timeouts under the command's retry policy",
      suggestedCommands: uniqueCommands(["system health", ...stateCommandsForRetry])
    },
    {
      match: { type: "NETWORK_ERROR", issuesKind: "DNS" },
      strategy: "repairConfig",
      retryGate: "afterInputRepair",
      summary: "retry DNS failures only for temporary resolver issues; otherwise repair base-url or hostname first",
      suggestedCommands: ["config show", "system health"]
    },
    {
      match: { type: "NETWORK_ERROR", issuesKind: "CONNECTION" },
      strategy: retryStrategy,
      retryGate,
      summary: "verify service reachability before retrying connection failures",
      suggestedCommands: uniqueCommands(["system health", ...stateCommandsForRetry])
    },
    {
      match: { type: "NETWORK_ERROR", issuesKind: "TLS" },
      strategy: "repairConfig",
      retryGate: "afterInputRepair",
      summary: "repair certificate or trust settings before retrying TLS failures",
      suggestedCommands: ["config show", "system health"]
    },
    {
      match: { type: "NETWORK_ERROR", issuesKind: "NETWORK" },
      strategy: retryStrategy,
      retryGate,
      summary: "inspect transport diagnostics and only retry generic network failures when they are explicitly retryable",
      suggestedCommands: uniqueCommands(["system health", ...stateCommandsForRetry])
    },
    {
      match: { type: "UNKNOWN_ERROR" },
      strategy: "escalate",
      retryGate: "never",
      summary: "capture diagnostics and escalate unexpected command failures",
      suggestedCommands: []
    },
    ...(API_FAILURE_HINTS[path] ?? [])
  ];

  return cloneFailureHints(defaultHints);
};

const attachCommandPath = (error: unknown, commandPath: string): void => {
  if (!error || typeof error !== "object") {
    return;
  }
  const tagged = error as { commandPath?: string };
  if (!tagged.commandPath) {
    tagged.commandPath = commandPath;
  }
};

const resolvePretty = (command: Command): boolean => {
  const raw = command.optsWithGlobals() as { pretty?: boolean };
  return Boolean(raw.pretty);
};

const resolveRootCommand = (command: Command): Command => {
  let cursor = command;
  while (cursor.parent) {
    cursor = cursor.parent;
  }
  return cursor;
};

const isHelpOption = (option: Option): boolean => option.long === "--help" || option.short === "-h";
const isDiscoveryOnlyOption = (option: Option): boolean =>
  isHelpOption(option) || option.long === "--version" || option.short === "-V";

const parseDefaultFromDescription = (description: string): string | undefined => {
  const match = /default:\s*([^)]+)/i.exec(description);
  return match?.[1]?.trim();
};

const toOptionSpec = (option: Option): CliSpecOption => {
  const description = option.description ?? "";
  const defaultValue = option.defaultValue ?? parseDefaultFromDescription(description);
  return {
    flags: option.flags,
    ...(option.long ? { longFlag: option.long } : {}),
    ...(option.short ? { shortFlag: option.short } : {}),
    description,
    takesValue: option.required || option.optional,
    valueRequired: option.required,
    required: Boolean(option.mandatory),
    ...(defaultValue !== undefined ? { defaultValue } : {})
  };
};

const getRegisteredArguments = (command: Command): CliSpecArgument[] => {
  const registered = (
    command as Command & {
      registeredArguments?: Array<{
        name(): string;
        description?: string;
        required: boolean;
        variadic: boolean;
        defaultValue?: unknown;
      }>;
    }
  ).registeredArguments;

  return (registered ?? []).map((argument) => ({
    name: argument.name(),
    syntax: argument.required ? `<${argument.name()}>` : `[${argument.name()}]`,
    required: argument.required,
    variadic: argument.variadic,
    description: argument.description ?? null,
    ...(argument.defaultValue !== undefined ? { defaultValue: argument.defaultValue } : {})
  }));
};

const toOperationSpec = (operationId: ApiOperationId): CliSpecOperation => {
  const operation = getApiOperation(operationId);
  return {
    operationId,
    version: operation.version,
    method: operation.method,
    pathTemplate: operation.pathTemplate,
    auth: operation.auth,
    tag: operation.tag
  };
};

const toAuthRequirements = (auth: ApiAuthMode): CliSpecAuthRequirement[] => {
  switch (auth) {
    case "none":
      return [];
    case "bearer":
      return [
        {
          kind: "token",
          sources: ["--token", "--token-file", "persistedConfig.token"]
        }
      ];
    case "bearer_admin":
      return [
        {
          kind: "token",
          sources: ["--token", "--token-file", "persistedConfig.token"]
        },
        {
          kind: "adminKey",
          sources: ["--admin-key", "--admin-key-file", "persistedConfig.adminKey"]
        }
      ];
    default: {
      const exhaustive: never = auth;
      return exhaustive;
    }
  }
};

const cloneOpenApiSchema = (schema: OpenApiSchemaObject): OpenApiSchemaObject =>
  JSON.parse(JSON.stringify(schema)) as OpenApiSchemaObject;

const toOpenApiSchema = (
  component: ContractSchema | OpenApiSchemaObject | undefined
): OpenApiSchemaObject | undefined => {
  if (!component) {
    return undefined;
  }
  return "openapi" in component ? component.openapi : component;
};

const OPENAPI_COMPONENT_REF_PREFIX = "#/components/schemas/";

const resolveOpenApiSchema = (
  schema: OpenApiSchemaObject,
  seenRefs: readonly string[] = []
): OpenApiSchemaObject => {
  if (!schema.$ref) {
    return schema;
  }

  if (!schema.$ref.startsWith(OPENAPI_COMPONENT_REF_PREFIX)) {
    throw new CliValidationError(`spec schema ref '${schema.$ref}' is not a supported components schema ref`);
  }

  const componentName = schema.$ref.slice(OPENAPI_COMPONENT_REF_PREFIX.length);
  if (seenRefs.includes(componentName)) {
    throw new CliValidationError(
      `spec schema ref cycle detected for component '${componentName}' while expanding success fields`
    );
  }

  const componentSchema = openApiSchemaComponents[componentName];
  if (!componentSchema) {
    throw new CliValidationError(`spec schema component '${componentName}' is missing`);
  }

  return resolveOpenApiSchema(componentSchema, [...seenRefs, componentName]);
};

const isObjectSchema = (schema: OpenApiSchemaObject): boolean =>
  schema.type === "object" || Boolean(schema.properties);

const isSensitiveSuccessPath = (path: string): boolean => {
  const segments = path.split(/[.[\]]+/u).filter(Boolean);
  return segments.some((segment) => ["token", "privateKey", "adminKey"].includes(segment));
};

const getSuccessFieldDescription = (
  path: string,
  schema: OpenApiSchemaObject,
  resolvedSchema: OpenApiSchemaObject
): string => {
  if (schema.description?.trim()) {
    return schema.description.trim();
  }
  if (resolvedSchema.description?.trim()) {
    return resolvedSchema.description.trim();
  }
  if (resolvedSchema.type === "array") {
    return `success response array \`${path}\``;
  }
  if (isObjectSchema(resolvedSchema)) {
    return `success response object \`${path}\``;
  }
  return `success response field \`${path}\``;
};

const toSuccessFieldSpec = (
  path: string,
  schema: OpenApiSchemaObject,
  required: boolean
): CliSpecSuccessField => {
  const resolvedSchema = resolveOpenApiSchema(schema);
  return {
    path,
    description: getSuccessFieldDescription(path, schema, resolvedSchema),
    required,
    schema: cloneOpenApiSchema(schema),
    ...(isSensitiveSuccessPath(path) ? { sensitive: true } : {})
  };
};

const appendSuccessFields = (
  fields: CliSpecSuccessField[],
  path: string,
  schema: OpenApiSchemaObject,
  required: boolean,
  includeCurrentField = true
): void => {
  const resolvedSchema = resolveOpenApiSchema(schema);

  if (resolvedSchema.type === "array") {
    const arrayPath = `${path}[]`;
    if (includeCurrentField) {
      fields.push(toSuccessFieldSpec(arrayPath, schema, required));
    }
    if (resolvedSchema.items) {
      appendSuccessFields(fields, arrayPath, resolvedSchema.items, required, false);
    }
    return;
  }

  if (includeCurrentField) {
    fields.push(toSuccessFieldSpec(path, schema, required));
  }

  if (!isObjectSchema(resolvedSchema) || !resolvedSchema.properties) {
    return;
  }

  for (const [propertyName, propertySchema] of Object.entries(resolvedSchema.properties)) {
    appendSuccessFields(
      fields,
      `${path}.${propertyName}`,
      propertySchema,
      required && (resolvedSchema.required?.includes(propertyName) ?? false)
    );
  }
};

const getApiSuccessFields = (operation: ApiOperationDefinition): CliSpecSuccessField[] => {
  const responseSchema = toOpenApiSchema(operation.responseComponent);
  if (!responseSchema) {
    throw new CliValidationError(
      `spec response metadata is missing for operation '${operation.operationId}'`
    );
  }

  const resolvedResponseSchema = resolveOpenApiSchema(responseSchema);
  if (isObjectSchema(resolvedResponseSchema) && resolvedResponseSchema.properties) {
    const fields: CliSpecSuccessField[] = [];
    for (const [propertyName, propertySchema] of Object.entries(resolvedResponseSchema.properties)) {
      appendSuccessFields(
        fields,
        `data.${propertyName}`,
        propertySchema,
        resolvedResponseSchema.required?.includes(propertyName) ?? false
      );
    }
    return fields;
  }

  const fields: CliSpecSuccessField[] = [];
  appendSuccessFields(fields, "data", responseSchema, true);
  return fields;
};

const enrichParameterBinding = (
  binding: CliRequestBindingDefinition,
  parameter: OpenApiParameterObject
): CliSpecRequestBinding => {
  return {
    ...binding,
    required: Boolean(parameter.required),
    ...(parameter.description ? { description: parameter.description.en } : {}),
    schema: cloneOpenApiSchema(parameter.schema)
  };
};

const enrichBodyBinding = (
  binding: CliRequestBindingDefinition,
  operation: ApiOperationDefinition
): CliSpecRequestBinding => {
  const bodySchema = toOpenApiSchema(operation.requestBodyComponent);
  if (!bodySchema || bodySchema.type !== "object" || !bodySchema.properties) {
    throw new CliValidationError(
      `spec request body metadata is missing for operation '${operation.operationId}'`
    );
  }

  const fieldSchema = bodySchema.properties[binding.field];
  if (!fieldSchema) {
    throw new CliValidationError(
      `spec request body field '${binding.field}' is missing from operation '${operation.operationId}'`
    );
  }

  return {
    ...binding,
    required: bodySchema.required?.includes(binding.field) ?? false,
    ...(fieldSchema.description ? { description: fieldSchema.description } : {}),
    schema: cloneOpenApiSchema(fieldSchema)
  };
};

const enrichRequestBinding = (
  binding: CliRequestBindingDefinition,
  operation: ApiOperationDefinition
): CliSpecRequestBinding => {
  if (binding.location === "body") {
    return enrichBodyBinding(binding, operation);
  }

  const parameter = operation.parameters?.find(
    (candidate) => candidate.in === binding.location && candidate.name === binding.field
  );
  if (!parameter) {
    throw new CliValidationError(
      `spec request ${binding.location} field '${binding.field}' is missing from operation '${operation.operationId}'`
    );
  }
  return enrichParameterBinding(binding, parameter);
};

const getRequestBindings = (
  path: string,
  operation?: ApiOperationDefinition
): CliSpecRequestBinding[] => {
  const bindings = cliRequestBindings[path];
  if (!bindings) {
    throw new CliValidationError(`spec metadata is missing request bindings for command '${path}'`);
  }
  if (!operation) {
    return [...bindings];
  }
  return bindings.map((binding) => enrichRequestBinding(binding, operation));
};

const cloneEntityHints = (hints: CliSpecEntityHints): CliSpecEntityHints => ({
  primaryEntity: hints.primaryEntity,
  bindings: hints.bindings.map((binding) => ({
    entity: binding.entity,
    relation: binding.relation,
    ...(binding.inputSources ? { inputSources: [...binding.inputSources] } : {}),
    ...(binding.outputPaths ? { outputPaths: [...binding.outputPaths] } : {}),
    ...(binding.note ? { note: binding.note } : {})
  }))
});

const cloneHandoffHints = (hints: readonly CliSpecHandoffHint[]): CliSpecHandoffHint[] =>
  hints.map((hint) => ({
    targetCommand: hint.targetCommand,
    bindings: hint.bindings.map((binding) => ({
      ...(binding.sourcePath ? { sourcePath: binding.sourcePath } : {}),
      ...(binding.sourceInput ? { sourceInput: binding.sourceInput } : {}),
      ...(binding.sourceLiteral !== undefined ? { sourceLiteral: binding.sourceLiteral } : {}),
      targetInputs: [...binding.targetInputs],
      ...(binding.note ? { note: binding.note } : {})
    })),
    ...(hint.selectionMode ? { selectionMode: hint.selectionMode } : {}),
    ...(hint.selectionConditions
      ? {
          selectionConditions: hint.selectionConditions.map((condition) => ({
            path: condition.path,
            operator: condition.operator,
            ...(condition.value !== undefined ? { value: condition.value } : {})
          }))
        }
      : {}),
    ...(hint.note ? { note: hint.note } : {})
  }));

const handoffFromPath = (
  sourcePath: string,
  targetInputs: string[],
  note?: string
): CliSpecHandoffBinding => ({
  sourcePath,
  targetInputs,
  ...(note ? { note } : {})
});

const handoffFromInput = (
  sourceInput: string,
  targetInputs: string[],
  note?: string
): CliSpecHandoffBinding => ({
  sourceInput,
  targetInputs,
  ...(note ? { note } : {})
});

const handoffFromLiteral = (
  sourceLiteral: string | number | boolean,
  targetInputs: string[],
  note?: string
): CliSpecHandoffBinding => ({
  sourceLiteral,
  targetInputs,
  ...(note ? { note } : {})
});

const currentPageSelection = (
  ...selectionConditions: CliSpecHandoffSelectionCondition[]
): Pick<CliSpecHandoffHint, "selectionMode" | "selectionConditions"> => ({
  selectionMode: "currentPageItem",
  ...(selectionConditions.length > 0 ? { selectionConditions } : {})
});

const currentResultSelection = (
  ...selectionConditions: CliSpecHandoffSelectionCondition[]
): Pick<CliSpecHandoffHint, "selectionMode" | "selectionConditions"> => ({
  selectionMode: "currentResult",
  ...(selectionConditions.length > 0 ? { selectionConditions } : {})
});

const nonNullSelectionCondition = (path: string): CliSpecHandoffSelectionCondition => ({
  path,
  operator: "nonNull"
});

const equalsSelectionCondition = (
  path: string,
  value: string | number | boolean
): CliSpecHandoffSelectionCondition => ({
  path,
  operator: "equals",
  value
});

const getEntityHints = (
  path: string,
  executionMode: CliExecutionMode
): CliSpecEntityHints => {
  if (executionMode === "local" || executionMode === "composite") {
    const localMetadata = LOCAL_COMMANDS[path];
    if (!localMetadata) {
      throw new CliValidationError(`spec entity metadata is missing for local command '${path}'`);
    }
    return cloneEntityHints(localMetadata.entityHints);
  }

  switch (path as keyof typeof cliOperationBindings) {
    case "activities list":
      return {
        primaryEntity: "activity",
        bindings: [
          {
            entity: "activity",
            relation: "listed",
            outputPaths: ["data.items[].id"]
          },
          {
            entity: "task",
            relation: "related",
            inputSources: ["--task"],
            outputPaths: ["data.items[].taskId"]
          },
          {
            entity: "dispute",
            relation: "related",
            inputSources: ["--dispute"],
            outputPaths: ["data.items[].disputeId"]
          },
          {
            entity: "agent",
            relation: "related",
            inputSources: ["--address"],
            outputPaths: ["data.items[].actor"]
          }
        ]
      };
    case "agents list":
      return {
        primaryEntity: "agent",
        bindings: [
          {
            entity: "agent",
            relation: "listed",
            outputPaths: ["data.items[].address"]
          }
        ]
      };
    case "agents profile get":
      return {
        primaryEntity: "agent",
        bindings: [
          {
            entity: "agent",
            relation: "target",
            inputSources: ["--address"],
            outputPaths: ["data.address"]
          }
        ]
      };
    case "agents profile update":
      return {
        primaryEntity: "agent",
        bindings: [
          {
            entity: "agent",
            relation: "target",
            inputSources: ["--address"],
            outputPaths: ["data.address"]
          }
        ]
      };
    case "agents stats":
      return {
        primaryEntity: "agent",
        bindings: [
          {
            entity: "agent",
            relation: "target",
            inputSources: ["--address"],
            note: "agent stats are keyed by the requested address even though the stats payload does not repeat it"
          }
        ]
      };
    case "auth challenge":
      return {
        primaryEntity: "authChallenge",
        bindings: [
          {
            entity: "agent",
            relation: "target",
            inputSources: ["--address"]
          },
          {
            entity: "authChallenge",
            relation: "created",
            outputPaths: ["data.nonce", "data.message"]
          }
        ]
      };
    case "auth verify":
      return {
        primaryEntity: "authSession",
        bindings: [
          {
            entity: "agent",
            relation: "target",
            inputSources: ["--address"]
          },
          {
            entity: "authChallenge",
            relation: "target",
            inputSources: ["--nonce", "--message", "--message-file"]
          },
          {
            entity: "authSession",
            relation: "created",
            outputPaths: ["data.token"]
          }
        ]
      };
    case "cycles active":
      return {
        primaryEntity: "cycle",
        bindings: [
          {
            entity: "cycle",
            relation: "returned",
            outputPaths: ["data.id"]
          }
        ]
      };
    case "cycles get":
      return {
        primaryEntity: "cycle",
        bindings: [
          {
            entity: "cycle",
            relation: "target",
            inputSources: ["--cycle"],
            outputPaths: ["data.id"]
          }
        ]
      };
    case "cycles list":
      return {
        primaryEntity: "cycle",
        bindings: [
          {
            entity: "cycle",
            relation: "listed",
            outputPaths: ["data.items[].id"]
          }
        ]
      };
    case "cycles rewards":
      return {
        primaryEntity: "cycle",
        bindings: [
          {
            entity: "cycle",
            relation: "target",
            inputSources: ["--cycle"],
            outputPaths: ["data.cycle.id"]
          },
          {
            entity: "cycleWorkload",
            relation: "listed",
            outputPaths: ["data.workloads[].id"]
          },
          {
            entity: "agent",
            relation: "related",
            outputPaths: ["data.distributions[].agent", "data.workloads[].agent"]
          },
          {
            entity: "task",
            relation: "related",
            outputPaths: ["data.workloads[].taskId"],
            note: "only when the cycle workload corresponds to a task completion"
          },
          {
            entity: "dispute",
            relation: "related",
            outputPaths: ["data.workloads[].disputeId"],
            note: "only when the cycle workload is attached to a dispute"
          }
        ]
      };
    case "dashboard summary":
      return {
        primaryEntity: "dashboard",
        bindings: [
          {
            entity: "dashboard",
            relation: "target",
            inputSources: ["--tz"],
            outputPaths: ["data.timezone"]
          },
          {
            entity: "dashboard",
            relation: "returned",
            outputPaths: ["data.generatedAt"]
          },
          {
            entity: "cycle",
            relation: "related",
            outputPaths: ["data.activeCycleId"]
          }
        ]
      };
    case "dashboard trends":
      return {
        primaryEntity: "dashboard",
        bindings: [
          {
            entity: "dashboard",
            relation: "target",
            inputSources: ["--tz", "--window"],
            outputPaths: ["data.timezone"]
          },
          {
            entity: "dashboard",
            relation: "returned",
            outputPaths: ["data.generatedAt", "data.points[]"]
          }
        ]
      };
    case "disputes get":
      return {
        primaryEntity: "dispute",
        bindings: [
          {
            entity: "dispute",
            relation: "target",
            inputSources: ["--dispute"],
            outputPaths: ["data.id"]
          },
          {
            entity: "task",
            relation: "related",
            outputPaths: ["data.taskId"]
          },
          {
            entity: "submission",
            relation: "related",
            outputPaths: ["data.submissionId"]
          },
          {
            entity: "agent",
            relation: "related",
            outputPaths: ["data.opener"]
          },
          {
            entity: "agent",
            relation: "related",
            outputPaths: ["data.resolution.winnerAddress"],
            note: "only when the dispute resolution records a winner address"
          }
        ]
      };
    case "disputes list":
      return {
        primaryEntity: "dispute",
        bindings: [
          {
            entity: "dispute",
            relation: "listed",
            outputPaths: ["data.items[].id"]
          },
          {
            entity: "task",
            relation: "related",
            inputSources: ["--task"],
            outputPaths: ["data.items[].taskId"]
          },
          {
            entity: "agent",
            relation: "related",
            inputSources: ["--opener"],
            outputPaths: ["data.items[].opener"]
          },
          {
            entity: "agent",
            relation: "related",
            outputPaths: ["data.items[].resolution.winnerAddress"],
            note: "only when the listed dispute is resolved and records a winner address"
          }
        ]
      };
    case "disputes open":
      return {
        primaryEntity: "dispute",
        bindings: [
          {
            entity: "task",
            relation: "target",
            inputSources: ["--task"],
            outputPaths: ["data.taskId"]
          },
          {
            entity: "submission",
            relation: "target",
            inputSources: ["--submission"],
            outputPaths: ["data.submissionId"]
          },
          {
            entity: "dispute",
            relation: "created",
            outputPaths: ["data.id"]
          },
          {
            entity: "agent",
            relation: "related",
            outputPaths: ["data.opener"]
          }
        ]
      };
    case "disputes respond":
      return {
        primaryEntity: "dispute",
        bindings: [
          {
            entity: "dispute",
            relation: "target",
            inputSources: ["--dispute"],
            outputPaths: ["data.id"]
          },
          {
            entity: "submission",
            relation: "related",
            outputPaths: ["data.submissionId"]
          },
          {
            entity: "task",
            relation: "related",
            outputPaths: ["data.taskId"]
          },
          {
            entity: "agent",
            relation: "related",
            outputPaths: ["data.opener"]
          },
          {
            entity: "agent",
            relation: "related",
            outputPaths: ["data.counterpartyResponder"],
            note: "only after the counterparty reason is accepted and recorded"
          }
        ]
      };
    case "disputes vote":
      return {
        primaryEntity: "dispute",
        bindings: [
          {
            entity: "dispute",
            relation: "target",
            inputSources: ["--dispute"],
            outputPaths: ["data.vote.disputeId", "data.workload.disputeId"]
          },
          {
            entity: "supervisionVote",
            relation: "created",
            outputPaths: ["data.vote.id"]
          },
          {
            entity: "cycleWorkload",
            relation: "created",
            outputPaths: ["data.workload.id"]
          },
          {
            entity: "agent",
            relation: "related",
            outputPaths: ["data.vote.agent", "data.workload.agent"]
          },
          {
            entity: "task",
            relation: "related",
            outputPaths: ["data.workload.taskId"],
            note: "only when the created workload records a task id"
          }
        ]
      };
    case "economy params":
      return {
        primaryEntity: "economy",
        bindings: [
          {
            entity: "economy",
            relation: "returned",
            outputPaths: ["data.appName"]
          }
        ]
      };
    case "ledger get":
      return {
        primaryEntity: "ledgerAccount",
        bindings: [
          {
            entity: "ledgerAccount",
            relation: "target",
            inputSources: ["--address"],
            outputPaths: ["data.address"]
          }
        ]
      };
    case "submissions get":
      return {
        primaryEntity: "submission",
        bindings: [
          {
            entity: "submission",
            relation: "target",
            inputSources: ["--submission"],
            outputPaths: ["data.id"]
          },
          {
            entity: "task",
            relation: "related",
            outputPaths: ["data.taskId"]
          },
          {
            entity: "agent",
            relation: "related",
            outputPaths: ["data.agent"]
          }
        ]
      };
    case "submissions list":
      return {
        primaryEntity: "submission",
        bindings: [
          {
            entity: "submission",
            relation: "listed",
            outputPaths: ["data.items[].id"]
          },
          {
            entity: "task",
            relation: "related",
            inputSources: ["--task"],
            outputPaths: ["data.items[].taskId"]
          },
          {
            entity: "agent",
            relation: "related",
            inputSources: ["--agent"],
            outputPaths: ["data.items[].agent"]
          }
        ]
      };
    case "submissions confirm":
      return {
        primaryEntity: "submission",
        bindings: [
          {
            entity: "submission",
            relation: "target",
            inputSources: ["--submission"],
            outputPaths: ["data.id"]
          },
          {
            entity: "task",
            relation: "related",
            outputPaths: ["data.taskId"]
          },
          {
            entity: "agent",
            relation: "related",
            outputPaths: ["data.agent"]
          }
        ]
      };
    case "submissions reject":
      return {
        primaryEntity: "submission",
        bindings: [
          {
            entity: "submission",
            relation: "target",
            inputSources: ["--submission"],
            outputPaths: ["data.id"]
          },
          {
            entity: "task",
            relation: "related",
            outputPaths: ["data.taskId"]
          },
          {
            entity: "agent",
            relation: "related",
            outputPaths: ["data.agent"]
          }
        ]
      };
    case "system health":
      return {
        primaryEntity: "serviceHealth",
        bindings: [
          {
            entity: "serviceHealth",
            relation: "returned",
            outputPaths: ["data.service"]
          }
        ]
      };
    case "system metrics":
      return {
        primaryEntity: "serviceMetrics",
        bindings: [
          {
            entity: "serviceMetrics",
            relation: "returned",
            outputPaths: ["data.generatedAt"]
          }
        ]
      };
    case "system settings get":
      return {
        primaryEntity: "runtimeSettings",
        bindings: [
          {
            entity: "runtimeSettings",
            relation: "returned",
            outputPaths: ["data.updatedAt"]
          }
        ]
      };
    case "system settings history":
      return {
        primaryEntity: "runtimeSettings",
        bindings: [
          {
            entity: "runtimeSettings",
            relation: "listed",
            outputPaths: ["data.items[].id"]
          }
        ]
      };
    case "system settings reset":
      return {
        primaryEntity: "runtimeSettings",
        bindings: [
          {
            entity: "runtimeSettings",
            relation: "target",
            inputSources: ["--apply-to"],
            outputPaths: ["data.updatedAt"],
            note: "--apply-to selects whether current or next runtime rules are reset"
          }
        ]
      };
    case "system settings update":
      return {
        primaryEntity: "runtimeSettings",
        bindings: [
          {
            entity: "runtimeSettings",
            relation: "target",
            inputSources: ["--apply-to", "--patch-json", "--patch-file"],
            outputPaths: ["data.updatedAt"],
            note: "--apply-to selects whether current or next runtime rules are patched"
          }
        ]
      };
    case "tasks create":
      return {
        primaryEntity: "task",
        bindings: [
          {
            entity: "task",
            relation: "created",
            outputPaths: ["data.id"]
          },
          {
            entity: "agent",
            relation: "related",
            outputPaths: ["data.publisher"]
          }
        ]
      };
    case "tasks get":
      return {
        primaryEntity: "task",
        bindings: [
          {
            entity: "task",
            relation: "target",
            inputSources: ["--task"],
            outputPaths: ["data.id"]
          },
          {
            entity: "agent",
            relation: "related",
            outputPaths: ["data.publisher"]
          }
        ]
      };
    case "tasks intend":
      return {
        primaryEntity: "taskIntention",
        bindings: [
          {
            entity: "task",
            relation: "target",
            inputSources: ["--task"],
            outputPaths: ["data.taskId"]
          },
          {
            entity: "taskIntention",
            relation: "created",
            outputPaths: ["data.id"]
          },
          {
            entity: "agent",
            relation: "related",
            outputPaths: ["data.agent"]
          }
        ]
      };
    case "tasks intentions":
      return {
        primaryEntity: "taskIntention",
        bindings: [
          {
            entity: "task",
            relation: "target",
            inputSources: ["--task"]
          },
          {
            entity: "taskIntention",
            relation: "listed",
            outputPaths: ["data.items[].id"]
          },
          {
            entity: "agent",
            relation: "related",
            outputPaths: ["data.items[].agent"]
          }
        ]
      };
    case "tasks list":
      return {
        primaryEntity: "task",
        bindings: [
          {
            entity: "task",
            relation: "listed",
            outputPaths: ["data.items[].id"]
          },
          {
            entity: "agent",
            relation: "related",
            inputSources: ["--publisher"],
            outputPaths: ["data.items[].publisher"]
          }
        ]
      };
    case "tasks submit":
      return {
        primaryEntity: "submission",
        bindings: [
          {
            entity: "task",
            relation: "target",
            inputSources: ["--task"],
            outputPaths: ["data.taskId"]
          },
          {
            entity: "submission",
            relation: "created",
            outputPaths: ["data.id"]
          },
          {
            entity: "agent",
            relation: "related",
            outputPaths: ["data.agent"]
          }
        ]
      };
    case "tasks terminate":
      return {
        primaryEntity: "task",
        bindings: [
          {
            entity: "task",
            relation: "target",
            inputSources: ["--task"],
            outputPaths: ["data.id"]
          },
          {
            entity: "agent",
            relation: "related",
            outputPaths: ["data.publisher"]
          }
        ]
      };
    default:
      throw new CliValidationError(`spec entity metadata is missing for command '${path}'`);
  }
};

const getHandoffHints = (
  path: string,
  executionMode: CliExecutionMode
): CliSpecHandoffHint[] => {
  if (executionMode === "local" || executionMode === "composite") {
    const localMetadata = LOCAL_COMMANDS[path];
    if (!localMetadata) {
      throw new CliValidationError(`spec handoff metadata is missing for local command '${path}'`);
    }
    return cloneHandoffHints(localMetadata.handoffHints);
  }

  switch (path as keyof typeof cliOperationBindings) {
    case "activities list":
      return cloneHandoffHints([
        {
          targetCommand: "tasks get",
          bindings: [handoffFromPath("data.items[].taskId", ["--task"])],
          ...currentPageSelection(nonNullSelectionCondition("data.items[].taskId"))
        },
        {
          targetCommand: "submissions list",
          bindings: [handoffFromPath("data.items[].taskId", ["--task"])],
          ...currentPageSelection(nonNullSelectionCondition("data.items[].taskId"))
        },
        {
          targetCommand: "disputes get",
          bindings: [handoffFromPath("data.items[].disputeId", ["--dispute"])],
          ...currentPageSelection(nonNullSelectionCondition("data.items[].disputeId"))
        },
        {
          targetCommand: "cycles get",
          bindings: [handoffFromPath("data.items[].cycleId", ["--cycle"])],
          ...currentPageSelection()
        },
        {
          targetCommand: "agents profile get",
          bindings: [handoffFromPath("data.items[].actor", ["--address"])],
          ...currentPageSelection()
        },
        {
          targetCommand: "agents stats",
          bindings: [handoffFromPath("data.items[].actor", ["--address"])],
          ...currentPageSelection()
        },
        {
          targetCommand: "ledger get",
          bindings: [handoffFromPath("data.items[].actor", ["--address"])],
          ...currentPageSelection()
        },
        {
          targetCommand: "activities list",
          bindings: [handoffFromPath("data.items[].actor", ["--address"])],
          ...currentPageSelection(),
          note: "rerun the activity list scoped to the selected actor"
        }
      ]);
    case "agents list":
      return cloneHandoffHints([
        {
          targetCommand: "agents profile get",
          bindings: [handoffFromPath("data.items[].address", ["--address"])],
          ...currentPageSelection()
        },
        {
          targetCommand: "agents stats",
          bindings: [handoffFromPath("data.items[].address", ["--address"])],
          ...currentPageSelection()
        },
        {
          targetCommand: "ledger get",
          bindings: [handoffFromPath("data.items[].address", ["--address"])],
          ...currentPageSelection()
        },
        {
          targetCommand: "tasks list",
          bindings: [handoffFromPath("data.items[].address", ["--publisher"])],
          ...currentPageSelection(),
          note: "rerun the task list scoped to the selected agent as publisher"
        },
        {
          targetCommand: "submissions list",
          bindings: [handoffFromPath("data.items[].address", ["--agent"])],
          ...currentPageSelection(),
          note: "rerun the submission list scoped to the selected agent"
        },
        {
          targetCommand: "disputes list",
          bindings: [handoffFromPath("data.items[].address", ["--opener"])],
          ...currentPageSelection(),
          note: "rerun the dispute list scoped to the selected agent as opener"
        },
        {
          targetCommand: "activities list",
          bindings: [handoffFromPath("data.items[].address", ["--address"])],
          ...currentPageSelection(),
          note: "rerun the activity list scoped to the selected agent"
        }
      ]);
    case "agents profile get":
      return cloneHandoffHints([
        {
          targetCommand: "agents profile update",
          bindings: [
            {
              sourcePath: "data.address",
              targetInputs: ["--address"]
            }
          ],
          note: "profile update still requires at least one mutation flag or file-backed field"
        },
        {
          targetCommand: "agents stats",
          bindings: [
            {
              sourcePath: "data.address",
              targetInputs: ["--address"]
            }
          ]
        },
        {
          targetCommand: "ledger get",
          bindings: [
            {
              sourcePath: "data.address",
              targetInputs: ["--address"]
            }
          ]
        },
        {
          targetCommand: "tasks list",
          bindings: [handoffFromPath("data.address", ["--publisher"])],
          note: "rerun the task list scoped to this agent as publisher"
        },
        {
          targetCommand: "submissions list",
          bindings: [handoffFromPath("data.address", ["--agent"])],
          note: "rerun the submission list scoped to this agent"
        },
        {
          targetCommand: "disputes list",
          bindings: [handoffFromPath("data.address", ["--opener"])],
          note: "rerun the dispute list scoped to this agent as opener"
        },
        {
          targetCommand: "activities list",
          bindings: [handoffFromPath("data.address", ["--address"])],
          note: "rerun the activity list scoped to this agent"
        }
      ]);
    case "agents profile update":
      return cloneHandoffHints([
        {
          targetCommand: "agents profile get",
          bindings: [
            {
              sourcePath: "data.address",
              targetInputs: ["--address"]
            }
          ]
        },
        {
          targetCommand: "agents stats",
          bindings: [
            {
              sourcePath: "data.address",
              targetInputs: ["--address"]
            }
          ]
        },
        {
          targetCommand: "ledger get",
          bindings: [
            {
              sourcePath: "data.address",
              targetInputs: ["--address"]
            }
          ]
        },
        {
          targetCommand: "tasks list",
          bindings: [handoffFromPath("data.address", ["--publisher"])],
          note: "rerun the task list scoped to this agent as publisher"
        },
        {
          targetCommand: "submissions list",
          bindings: [handoffFromPath("data.address", ["--agent"])],
          note: "rerun the submission list scoped to this agent"
        },
        {
          targetCommand: "disputes list",
          bindings: [handoffFromPath("data.address", ["--opener"])],
          note: "rerun the dispute list scoped to this agent as opener"
        },
        {
          targetCommand: "activities list",
          bindings: [handoffFromPath("data.address", ["--address"])],
          note: "rerun the activity list scoped to this agent"
        }
      ]);
    case "agents stats":
      return cloneHandoffHints([
        {
          targetCommand: "agents profile get",
          bindings: [handoffFromInput("--address", ["--address"])]
        },
        {
          targetCommand: "ledger get",
          bindings: [handoffFromInput("--address", ["--address"])]
        },
        {
          targetCommand: "tasks list",
          bindings: [handoffFromInput("--address", ["--publisher"])],
          note: "rerun the task list scoped to this agent as publisher"
        },
        {
          targetCommand: "submissions list",
          bindings: [handoffFromInput("--address", ["--agent"])],
          note: "rerun the submission list scoped to this agent"
        },
        {
          targetCommand: "disputes list",
          bindings: [handoffFromInput("--address", ["--opener"])],
          note: "rerun the dispute list scoped to this agent as opener"
        },
        {
          targetCommand: "activities list",
          bindings: [handoffFromInput("--address", ["--address"])],
          note: "rerun the activity list scoped to this agent"
        }
      ]);
    case "auth challenge":
      return cloneHandoffHints([
        {
          targetCommand: "auth verify",
          bindings: [
            handoffFromInput("--address", ["--address"]),
            handoffFromPath("data.nonce", ["--nonce"]),
            handoffFromPath(
              "data.message",
              ["--message", "--message-file"],
              "pass the returned SIWE message inline or through a file"
            )
          ],
          note: "auth verify still needs a signature over the exact challenge message"
        }
      ]);
    case "auth verify":
      return cloneHandoffHints([
        {
          targetCommand: "tasks create",
          bindings: [
            handoffFromPath(
              "data.token",
              ["--token", "--token-file"],
              "pass the verified bearer token inline or through a file"
            )
          ],
          note: "task publication still requires title, description, criteria, deadline, slots, and reward inputs"
        },
        {
          targetCommand: "config set",
          bindings: [
            handoffFromLiteral("token", ["<key>"]),
            handoffFromPath(
              "data.token",
              ["[value]"],
              "persist the verified token inline only when argv secret exposure is acceptable"
            )
          ],
          note: "config set writes the verified bearer token into local CLI config"
        }
      ]);
    case "cycles active":
      return cloneHandoffHints([
        {
          targetCommand: "cycles get",
          bindings: [
            {
              sourcePath: "data.id",
              targetInputs: ["--cycle"]
            }
          ]
        },
        {
          targetCommand: "cycles rewards",
          bindings: [
            {
              sourcePath: "data.id",
              targetInputs: ["--cycle"]
            }
          ]
        }
      ]);
    case "cycles get":
      return cloneHandoffHints([
        {
          targetCommand: "cycles rewards",
          bindings: [
            {
              sourcePath: "data.id",
              targetInputs: ["--cycle"]
            }
          ]
        }
      ]);
    case "cycles list":
      return cloneHandoffHints([
        {
          targetCommand: "cycles get",
          bindings: [handoffFromPath("data.items[].id", ["--cycle"])],
          ...currentPageSelection()
        },
        {
          targetCommand: "cycles rewards",
          bindings: [handoffFromPath("data.items[].id", ["--cycle"])],
          ...currentPageSelection()
        }
      ]);
    case "cycles rewards":
      return cloneHandoffHints([
        {
          targetCommand: "cycles get",
          bindings: [
            {
              sourcePath: "data.cycle.id",
              targetInputs: ["--cycle"]
            }
          ]
        },
        {
          targetCommand: "tasks get",
          bindings: [handoffFromPath("data.workloads[].taskId", ["--task"])],
          ...currentPageSelection(nonNullSelectionCondition("data.workloads[].taskId"))
        },
        {
          targetCommand: "disputes get",
          bindings: [handoffFromPath("data.workloads[].disputeId", ["--dispute"])],
          ...currentPageSelection(nonNullSelectionCondition("data.workloads[].disputeId"))
        },
        {
          targetCommand: "activities list",
          bindings: [handoffFromPath("data.workloads[].taskId", ["--task"])],
          ...currentPageSelection(nonNullSelectionCondition("data.workloads[].taskId")),
          note: "rerun the activity list scoped to the selected task workload"
        },
        {
          targetCommand: "activities list",
          bindings: [handoffFromPath("data.workloads[].disputeId", ["--dispute"])],
          ...currentPageSelection(nonNullSelectionCondition("data.workloads[].disputeId")),
          note: "rerun the activity list scoped to the selected dispute workload"
        },
        {
          targetCommand: "agents profile get",
          bindings: [handoffFromPath("data.distributions[].agent", ["--address"])],
          ...currentPageSelection()
        },
        {
          targetCommand: "agents stats",
          bindings: [handoffFromPath("data.distributions[].agent", ["--address"])],
          ...currentPageSelection()
        },
        {
          targetCommand: "ledger get",
          bindings: [handoffFromPath("data.distributions[].agent", ["--address"])],
          ...currentPageSelection()
        }
      ]);
    case "dashboard summary":
      return cloneHandoffHints([
        {
          targetCommand: "cycles get",
          bindings: [handoffFromPath("data.activeCycleId", ["--cycle"])],
          ...currentResultSelection(nonNullSelectionCondition("data.activeCycleId"))
        },
        {
          targetCommand: "dashboard trends",
          bindings: [handoffFromPath("data.timezone", ["--tz"])]
        }
      ]);
    case "dashboard trends":
      return cloneHandoffHints([
        {
          targetCommand: "dashboard summary",
          bindings: [handoffFromPath("data.timezone", ["--tz"])]
        }
      ]);
    case "disputes get":
      return cloneHandoffHints([
        {
          targetCommand: "disputes respond",
          bindings: [
            {
              sourcePath: "data.id",
              targetInputs: ["--dispute"]
            }
          ],
          note: "counterparty response still requires --reason or --reason-file"
        },
        {
          targetCommand: "disputes vote",
          bindings: [
            {
              sourcePath: "data.id",
              targetInputs: ["--dispute"]
            }
          ]
        },
        {
          targetCommand: "tasks get",
          bindings: [
            {
              sourcePath: "data.taskId",
              targetInputs: ["--task"]
            }
          ]
        },
        {
          targetCommand: "submissions get",
          bindings: [
            {
              sourcePath: "data.submissionId",
              targetInputs: ["--submission"]
            }
          ]
        },
        {
          targetCommand: "disputes list",
          bindings: [handoffFromPath("data.opener", ["--opener"])],
          note: "rerun the dispute list scoped to the opening agent"
        },
        {
          targetCommand: "activities list",
          bindings: [handoffFromPath("data.id", ["--dispute"])],
          note: "rerun the activity list scoped to this dispute"
        },
        {
          targetCommand: "agents profile get",
          bindings: [handoffFromPath("data.opener", ["--address"])]
        },
        {
          targetCommand: "agents stats",
          bindings: [handoffFromPath("data.opener", ["--address"])]
        },
        {
          targetCommand: "ledger get",
          bindings: [handoffFromPath("data.opener", ["--address"])]
        },
        {
          targetCommand: "agents profile get",
          bindings: [handoffFromPath("data.resolution.winnerAddress", ["--address"])],
          ...currentResultSelection(nonNullSelectionCondition("data.resolution.winnerAddress"))
        },
        {
          targetCommand: "agents stats",
          bindings: [handoffFromPath("data.resolution.winnerAddress", ["--address"])],
          ...currentResultSelection(nonNullSelectionCondition("data.resolution.winnerAddress"))
        },
        {
          targetCommand: "ledger get",
          bindings: [handoffFromPath("data.resolution.winnerAddress", ["--address"])],
          ...currentResultSelection(nonNullSelectionCondition("data.resolution.winnerAddress"))
        }
      ]);
    case "disputes list":
      return cloneHandoffHints([
        {
          targetCommand: "disputes get",
          bindings: [handoffFromPath("data.items[].id", ["--dispute"])],
          ...currentPageSelection()
        },
        {
          targetCommand: "tasks get",
          bindings: [handoffFromPath("data.items[].taskId", ["--task"])],
          ...currentPageSelection()
        },
        {
          targetCommand: "submissions get",
          bindings: [handoffFromPath("data.items[].submissionId", ["--submission"])],
          ...currentPageSelection()
        },
        {
          targetCommand: "disputes list",
          bindings: [handoffFromPath("data.items[].opener", ["--opener"])],
          ...currentPageSelection(),
          note: "rerun the dispute list scoped to the selected opener"
        },
        {
          targetCommand: "activities list",
          bindings: [handoffFromPath("data.items[].id", ["--dispute"])],
          ...currentPageSelection(),
          note: "rerun the activity list scoped to the selected dispute"
        },
        {
          targetCommand: "agents profile get",
          bindings: [handoffFromPath("data.items[].opener", ["--address"])],
          ...currentPageSelection()
        },
        {
          targetCommand: "agents stats",
          bindings: [handoffFromPath("data.items[].opener", ["--address"])],
          ...currentPageSelection()
        },
        {
          targetCommand: "ledger get",
          bindings: [handoffFromPath("data.items[].opener", ["--address"])],
          ...currentPageSelection()
        },
        {
          targetCommand: "agents profile get",
          bindings: [handoffFromPath("data.items[].resolution.winnerAddress", ["--address"])],
          ...currentPageSelection(nonNullSelectionCondition("data.items[].resolution.winnerAddress"))
        },
        {
          targetCommand: "agents stats",
          bindings: [handoffFromPath("data.items[].resolution.winnerAddress", ["--address"])],
          ...currentPageSelection(nonNullSelectionCondition("data.items[].resolution.winnerAddress"))
        },
        {
          targetCommand: "ledger get",
          bindings: [handoffFromPath("data.items[].resolution.winnerAddress", ["--address"])],
          ...currentPageSelection(nonNullSelectionCondition("data.items[].resolution.winnerAddress"))
        }
      ]);
    case "disputes open":
      return cloneHandoffHints([
        {
          targetCommand: "disputes get",
          bindings: [
            {
              sourcePath: "data.id",
              targetInputs: ["--dispute"]
            }
          ]
        },
        {
          targetCommand: "disputes respond",
          bindings: [
            {
              sourcePath: "data.id",
              targetInputs: ["--dispute"]
            }
          ],
          note: "counterparty response still requires --reason or --reason-file"
        },
        {
          targetCommand: "disputes vote",
          bindings: [
            {
              sourcePath: "data.id",
              targetInputs: ["--dispute"]
            }
          ]
        },
        {
          targetCommand: "tasks get",
          bindings: [
            {
              sourcePath: "data.taskId",
              targetInputs: ["--task"]
            }
          ]
        },
        {
          targetCommand: "submissions get",
          bindings: [
            {
              sourcePath: "data.submissionId",
              targetInputs: ["--submission"]
            }
          ]
        },
        {
          targetCommand: "disputes list",
          bindings: [handoffFromPath("data.opener", ["--opener"])],
          note: "rerun the dispute list scoped to the opening agent"
        },
        {
          targetCommand: "activities list",
          bindings: [handoffFromPath("data.id", ["--dispute"])],
          note: "rerun the activity list scoped to this dispute"
        },
        {
          targetCommand: "agents profile get",
          bindings: [handoffFromPath("data.opener", ["--address"])]
        },
        {
          targetCommand: "agents stats",
          bindings: [handoffFromPath("data.opener", ["--address"])]
        },
        {
          targetCommand: "ledger get",
          bindings: [handoffFromPath("data.opener", ["--address"])]
        }
      ]);
    case "disputes respond":
      return cloneHandoffHints([
        {
          targetCommand: "disputes get",
          bindings: [
            {
              sourcePath: "data.id",
              targetInputs: ["--dispute"]
            }
          ]
        },
        {
          targetCommand: "disputes vote",
          bindings: [
            {
              sourcePath: "data.id",
              targetInputs: ["--dispute"]
            }
          ]
        },
        {
          targetCommand: "tasks get",
          bindings: [
            {
              sourcePath: "data.taskId",
              targetInputs: ["--task"]
            }
          ]
        },
        {
          targetCommand: "submissions get",
          bindings: [
            {
              sourcePath: "data.submissionId",
              targetInputs: ["--submission"]
            }
          ]
        },
        {
          targetCommand: "disputes list",
          bindings: [handoffFromPath("data.opener", ["--opener"])],
          note: "rerun the dispute list scoped to the original opener"
        },
        {
          targetCommand: "activities list",
          bindings: [handoffFromPath("data.id", ["--dispute"])],
          note: "rerun the activity list scoped to this dispute"
        },
        {
          targetCommand: "agents profile get",
          bindings: [handoffFromPath("data.opener", ["--address"])]
        },
        {
          targetCommand: "agents stats",
          bindings: [handoffFromPath("data.opener", ["--address"])]
        },
        {
          targetCommand: "ledger get",
          bindings: [handoffFromPath("data.opener", ["--address"])]
        },
        {
          targetCommand: "agents profile get",
          bindings: [handoffFromPath("data.counterpartyResponder", ["--address"])],
          ...currentResultSelection(nonNullSelectionCondition("data.counterpartyResponder"))
        },
        {
          targetCommand: "agents stats",
          bindings: [handoffFromPath("data.counterpartyResponder", ["--address"])],
          ...currentResultSelection(nonNullSelectionCondition("data.counterpartyResponder"))
        },
        {
          targetCommand: "ledger get",
          bindings: [handoffFromPath("data.counterpartyResponder", ["--address"])],
          ...currentResultSelection(nonNullSelectionCondition("data.counterpartyResponder"))
        }
      ]);
    case "disputes vote":
      return cloneHandoffHints([
        {
          targetCommand: "disputes get",
          bindings: [
            {
              sourcePath: "data.vote.disputeId",
              targetInputs: ["--dispute"]
            }
          ]
        },
        {
          targetCommand: "tasks get",
          bindings: [handoffFromPath("data.workload.taskId", ["--task"])],
          ...currentResultSelection(nonNullSelectionCondition("data.workload.taskId"))
        },
        {
          targetCommand: "activities list",
          bindings: [handoffFromPath("data.vote.disputeId", ["--dispute"])],
          note: "rerun the activity list scoped to this dispute"
        },
        {
          targetCommand: "agents profile get",
          bindings: [handoffFromPath("data.workload.agent", ["--address"])]
        },
        {
          targetCommand: "agents stats",
          bindings: [handoffFromPath("data.workload.agent", ["--address"])]
        },
        {
          targetCommand: "ledger get",
          bindings: [
            {
              sourcePath: "data.workload.agent",
              targetInputs: ["--address"]
            }
          ]
        }
      ]);
    case "economy params":
      return [];
    case "ledger get":
      return cloneHandoffHints([
        {
          targetCommand: "agents profile get",
          bindings: [
            {
              sourcePath: "data.address",
              targetInputs: ["--address"]
            }
          ]
        },
        {
          targetCommand: "agents stats",
          bindings: [
            {
              sourcePath: "data.address",
              targetInputs: ["--address"]
            }
          ]
        },
        {
          targetCommand: "tasks list",
          bindings: [handoffFromPath("data.address", ["--publisher"])],
          note: "rerun the task list scoped to this agent as publisher"
        },
        {
          targetCommand: "submissions list",
          bindings: [handoffFromPath("data.address", ["--agent"])],
          note: "rerun the submission list scoped to this agent"
        },
        {
          targetCommand: "disputes list",
          bindings: [handoffFromPath("data.address", ["--opener"])],
          note: "rerun the dispute list scoped to this agent as opener"
        },
        {
          targetCommand: "activities list",
          bindings: [handoffFromPath("data.address", ["--address"])],
          note: "rerun the activity list scoped to this agent"
        }
      ]);
    case "submissions get":
      return cloneHandoffHints([
        {
          targetCommand: "submissions confirm",
          bindings: [
            {
              sourcePath: "data.id",
              targetInputs: ["--submission"]
            }
          ]
        },
        {
          targetCommand: "submissions reject",
          bindings: [
            {
              sourcePath: "data.id",
              targetInputs: ["--submission"]
            }
          ],
          note: "submission rejection still requires --reason or --reason-file"
        },
        {
          targetCommand: "disputes open",
          bindings: [
            {
              sourcePath: "data.taskId",
              targetInputs: ["--task"]
            },
            {
              sourcePath: "data.id",
              targetInputs: ["--submission"]
            }
          ],
          note: "dispute opening still requires --reason or --reason-file"
        },
        {
          targetCommand: "tasks get",
          bindings: [
            {
              sourcePath: "data.taskId",
              targetInputs: ["--task"]
            }
          ]
        },
        {
          targetCommand: "submissions list",
          bindings: [handoffFromPath("data.agent", ["--agent"])],
          note: "rerun the submission list scoped to this agent"
        },
        {
          targetCommand: "activities list",
          bindings: [handoffFromPath("data.taskId", ["--task"])],
          note: "rerun the activity list scoped to this submission's task"
        },
        {
          targetCommand: "agents profile get",
          bindings: [handoffFromPath("data.agent", ["--address"])]
        },
        {
          targetCommand: "agents stats",
          bindings: [handoffFromPath("data.agent", ["--address"])]
        },
        {
          targetCommand: "ledger get",
          bindings: [handoffFromPath("data.agent", ["--address"])]
        }
      ]);
    case "submissions list":
      return cloneHandoffHints([
        {
          targetCommand: "submissions get",
          bindings: [handoffFromPath("data.items[].id", ["--submission"])],
          ...currentPageSelection()
        },
        {
          targetCommand: "submissions confirm",
          bindings: [handoffFromPath("data.items[].id", ["--submission"])],
          ...currentPageSelection(equalsSelectionCondition("data.items[].status", "SUBMITTED"))
        },
        {
          targetCommand: "submissions reject",
          bindings: [handoffFromPath("data.items[].id", ["--submission"])],
          ...currentPageSelection(equalsSelectionCondition("data.items[].status", "SUBMITTED")),
          note: "submission rejection still requires --reason or --reason-file"
        },
        {
          targetCommand: "disputes open",
          bindings: [
            handoffFromPath("data.items[].taskId", ["--task"]),
            handoffFromPath("data.items[].id", ["--submission"])
          ],
          ...currentPageSelection(equalsSelectionCondition("data.items[].status", "REJECTED")),
          note: "dispute opening still requires --reason or --reason-file"
        },
        {
          targetCommand: "tasks get",
          bindings: [handoffFromPath("data.items[].taskId", ["--task"])],
          ...currentPageSelection()
        },
        {
          targetCommand: "activities list",
          bindings: [handoffFromPath("data.items[].taskId", ["--task"])],
          ...currentPageSelection(),
          note: "rerun the activity list scoped to the selected submission task"
        },
        {
          targetCommand: "submissions list",
          bindings: [handoffFromPath("data.items[].agent", ["--agent"])],
          ...currentPageSelection(),
          note: "rerun the submission list scoped to the selected agent"
        },
        {
          targetCommand: "agents profile get",
          bindings: [handoffFromPath("data.items[].agent", ["--address"])],
          ...currentPageSelection()
        },
        {
          targetCommand: "agents stats",
          bindings: [handoffFromPath("data.items[].agent", ["--address"])],
          ...currentPageSelection()
        },
        {
          targetCommand: "ledger get",
          bindings: [handoffFromPath("data.items[].agent", ["--address"])],
          ...currentPageSelection()
        }
      ]);
    case "submissions confirm":
      return cloneHandoffHints([
        {
          targetCommand: "submissions get",
          bindings: [
            {
              sourcePath: "data.id",
              targetInputs: ["--submission"]
            }
          ]
        },
        {
          targetCommand: "tasks get",
          bindings: [
            {
              sourcePath: "data.taskId",
              targetInputs: ["--task"]
            }
          ]
        },
        {
          targetCommand: "activities list",
          bindings: [handoffFromPath("data.taskId", ["--task"])],
          note: "rerun the activity list scoped to the confirmed submission task"
        },
        {
          targetCommand: "submissions list",
          bindings: [handoffFromPath("data.agent", ["--agent"])],
          note: "rerun the submission list scoped to the confirmed agent"
        },
        {
          targetCommand: "agents profile get",
          bindings: [handoffFromPath("data.agent", ["--address"])]
        },
        {
          targetCommand: "agents stats",
          bindings: [handoffFromPath("data.agent", ["--address"])]
        },
        {
          targetCommand: "ledger get",
          bindings: [handoffFromPath("data.agent", ["--address"])]
        }
      ]);
    case "submissions reject":
      return cloneHandoffHints([
        {
          targetCommand: "submissions get",
          bindings: [
            {
              sourcePath: "data.id",
              targetInputs: ["--submission"]
            }
          ]
        },
        {
          targetCommand: "tasks get",
          bindings: [
            {
              sourcePath: "data.taskId",
              targetInputs: ["--task"]
            }
          ]
        },
        {
          targetCommand: "activities list",
          bindings: [handoffFromPath("data.taskId", ["--task"])],
          note: "rerun the activity list scoped to the rejected submission task"
        },
        {
          targetCommand: "disputes open",
          bindings: [
            handoffFromPath("data.taskId", ["--task"]),
            handoffFromPath("data.id", ["--submission"])
          ],
          note: "dispute opening still requires --reason or --reason-file"
        },
        {
          targetCommand: "submissions list",
          bindings: [handoffFromPath("data.agent", ["--agent"])],
          note: "rerun the submission list scoped to the rejected agent"
        },
        {
          targetCommand: "agents profile get",
          bindings: [handoffFromPath("data.agent", ["--address"])]
        },
        {
          targetCommand: "agents stats",
          bindings: [handoffFromPath("data.agent", ["--address"])]
        },
        {
          targetCommand: "ledger get",
          bindings: [handoffFromPath("data.agent", ["--address"])]
        }
      ]);
    case "system health":
    case "system metrics":
    case "system settings get":
    case "system settings history":
    case "system settings reset":
    case "system settings update":
      return [];
    case "tasks create":
      return cloneHandoffHints([
        {
          targetCommand: "tasks get",
          bindings: [
            {
              sourcePath: "data.id",
              targetInputs: ["--task"]
            }
          ]
        },
        {
          targetCommand: "tasks intentions",
          bindings: [
            {
              sourcePath: "data.id",
              targetInputs: ["--task"]
            }
          ]
        },
        {
          targetCommand: "tasks submit",
          bindings: [
            {
              sourcePath: "data.id",
              targetInputs: ["--task"]
            }
          ],
          note: "submission also requires payload input and usually a prior intention"
        },
        {
          targetCommand: "tasks terminate",
          bindings: [
            {
              sourcePath: "data.id",
              targetInputs: ["--task"]
            }
          ]
        },
        {
          targetCommand: "activities list",
          bindings: [handoffFromPath("data.id", ["--task"])],
          note: "rerun the activity list scoped to the created task"
        },
        {
          targetCommand: "tasks list",
          bindings: [handoffFromPath("data.publisher", ["--publisher"])],
          note: "rerun the task list scoped to the publishing agent"
        },
        {
          targetCommand: "agents profile get",
          bindings: [handoffFromPath("data.publisher", ["--address"])]
        },
        {
          targetCommand: "agents stats",
          bindings: [handoffFromPath("data.publisher", ["--address"])]
        },
        {
          targetCommand: "ledger get",
          bindings: [handoffFromPath("data.publisher", ["--address"])]
        }
      ]);
    case "tasks get":
      return cloneHandoffHints([
        {
          targetCommand: "tasks intend",
          bindings: [
            {
              sourcePath: "data.id",
              targetInputs: ["--task"]
            }
          ]
        },
        {
          targetCommand: "tasks intentions",
          bindings: [
            {
              sourcePath: "data.id",
              targetInputs: ["--task"]
            }
          ]
        },
        {
          targetCommand: "tasks submit",
          bindings: [
            {
              sourcePath: "data.id",
              targetInputs: ["--task"]
            }
          ],
          note: "submission also requires payload input and usually a prior intention"
        },
        {
          targetCommand: "tasks terminate",
          bindings: [
            {
              sourcePath: "data.id",
              targetInputs: ["--task"]
            }
          ]
        },
        {
          targetCommand: "submissions list",
          bindings: [
            {
              sourcePath: "data.id",
              targetInputs: ["--task"]
            }
          ]
        },
        {
          targetCommand: "disputes list",
          bindings: [
            {
              sourcePath: "data.id",
              targetInputs: ["--task"]
            }
          ]
        },
        {
          targetCommand: "tasks list",
          bindings: [handoffFromPath("data.publisher", ["--publisher"])],
          note: "rerun the task list scoped to this publisher"
        },
        {
          targetCommand: "activities list",
          bindings: [handoffFromPath("data.id", ["--task"])],
          note: "rerun the activity list scoped to this task"
        },
        {
          targetCommand: "agents profile get",
          bindings: [handoffFromPath("data.publisher", ["--address"])]
        },
        {
          targetCommand: "agents stats",
          bindings: [handoffFromPath("data.publisher", ["--address"])]
        },
        {
          targetCommand: "ledger get",
          bindings: [handoffFromPath("data.publisher", ["--address"])]
        }
      ]);
    case "tasks intend":
      return cloneHandoffHints([
        {
          targetCommand: "tasks submit",
          bindings: [
            {
              sourcePath: "data.taskId",
              targetInputs: ["--task"]
            }
          ],
          note: "submission also requires payload input"
        },
        {
          targetCommand: "tasks intentions",
          bindings: [
            {
              sourcePath: "data.taskId",
              targetInputs: ["--task"]
            }
          ]
        },
        {
          targetCommand: "tasks get",
          bindings: [
            {
              sourcePath: "data.taskId",
              targetInputs: ["--task"]
            }
          ]
        },
        {
          targetCommand: "activities list",
          bindings: [handoffFromPath("data.taskId", ["--task"])],
          note: "rerun the activity list scoped to the intended task"
        },
        {
          targetCommand: "submissions list",
          bindings: [handoffFromPath("data.agent", ["--agent"])],
          note: "rerun the submission list scoped to the intending agent"
        },
        {
          targetCommand: "agents profile get",
          bindings: [handoffFromPath("data.agent", ["--address"])]
        },
        {
          targetCommand: "agents stats",
          bindings: [handoffFromPath("data.agent", ["--address"])]
        },
        {
          targetCommand: "ledger get",
          bindings: [handoffFromPath("data.agent", ["--address"])]
        }
      ]);
    case "tasks intentions":
      return cloneHandoffHints([
        {
          targetCommand: "tasks submit",
          bindings: [handoffFromPath("data.items[].taskId", ["--task"])],
          ...currentPageSelection(),
          note: "submission also requires payload input"
        },
        {
          targetCommand: "tasks get",
          bindings: [handoffFromPath("data.items[].taskId", ["--task"])],
          ...currentPageSelection()
        },
        {
          targetCommand: "activities list",
          bindings: [handoffFromPath("data.items[].taskId", ["--task"])],
          ...currentPageSelection(),
          note: "rerun the activity list scoped to the selected intention task"
        },
        {
          targetCommand: "agents profile get",
          bindings: [handoffFromPath("data.items[].agent", ["--address"])],
          ...currentPageSelection()
        },
        {
          targetCommand: "agents stats",
          bindings: [handoffFromPath("data.items[].agent", ["--address"])],
          ...currentPageSelection()
        },
        {
          targetCommand: "ledger get",
          bindings: [handoffFromPath("data.items[].agent", ["--address"])],
          ...currentPageSelection()
        }
      ]);
    case "tasks list":
      return cloneHandoffHints([
        {
          targetCommand: "tasks get",
          bindings: [handoffFromPath("data.items[].id", ["--task"])],
          ...currentPageSelection()
        },
        {
          targetCommand: "tasks intend",
          bindings: [handoffFromPath("data.items[].id", ["--task"])],
          ...currentPageSelection()
        },
        {
          targetCommand: "tasks submit",
          bindings: [handoffFromPath("data.items[].id", ["--task"])],
          ...currentPageSelection(),
          note: "submission also requires payload input and usually a prior intention"
        },
        {
          targetCommand: "tasks terminate",
          bindings: [handoffFromPath("data.items[].id", ["--task"])],
          ...currentPageSelection()
        },
        {
          targetCommand: "submissions list",
          bindings: [handoffFromPath("data.items[].id", ["--task"])],
          ...currentPageSelection()
        },
        {
          targetCommand: "disputes list",
          bindings: [handoffFromPath("data.items[].id", ["--task"])],
          ...currentPageSelection()
        },
        {
          targetCommand: "activities list",
          bindings: [handoffFromPath("data.items[].id", ["--task"])],
          ...currentPageSelection(),
          note: "rerun the activity list scoped to the selected task"
        },
        {
          targetCommand: "tasks list",
          bindings: [handoffFromPath("data.items[].publisher", ["--publisher"])],
          ...currentPageSelection(),
          note: "rerun the task list scoped to the selected publisher"
        },
        {
          targetCommand: "agents profile get",
          bindings: [handoffFromPath("data.items[].publisher", ["--address"])],
          ...currentPageSelection()
        },
        {
          targetCommand: "agents stats",
          bindings: [handoffFromPath("data.items[].publisher", ["--address"])],
          ...currentPageSelection()
        },
        {
          targetCommand: "ledger get",
          bindings: [handoffFromPath("data.items[].publisher", ["--address"])],
          ...currentPageSelection()
        }
      ]);
    case "tasks submit":
      return cloneHandoffHints([
        {
          targetCommand: "submissions get",
          bindings: [
            {
              sourcePath: "data.id",
              targetInputs: ["--submission"]
            }
          ]
        },
        {
          targetCommand: "submissions confirm",
          bindings: [
            {
              sourcePath: "data.id",
              targetInputs: ["--submission"]
            }
          ]
        },
        {
          targetCommand: "submissions reject",
          bindings: [
            {
              sourcePath: "data.id",
              targetInputs: ["--submission"]
            }
          ],
          note: "submission rejection still requires --reason or --reason-file"
        },
        {
          targetCommand: "disputes open",
          bindings: [
            {
              sourcePath: "data.taskId",
              targetInputs: ["--task"]
            },
            {
              sourcePath: "data.id",
              targetInputs: ["--submission"]
            }
          ],
          note: "dispute opening still requires --reason or --reason-file"
        },
        {
          targetCommand: "tasks get",
          bindings: [
            {
              sourcePath: "data.taskId",
              targetInputs: ["--task"]
            }
          ]
        },
        {
          targetCommand: "activities list",
          bindings: [handoffFromPath("data.taskId", ["--task"])],
          note: "rerun the activity list scoped to the submitted task"
        },
        {
          targetCommand: "submissions list",
          bindings: [handoffFromPath("data.agent", ["--agent"])],
          note: "rerun the submission list scoped to the submitting agent"
        },
        {
          targetCommand: "agents profile get",
          bindings: [handoffFromPath("data.agent", ["--address"])]
        },
        {
          targetCommand: "agents stats",
          bindings: [handoffFromPath("data.agent", ["--address"])]
        },
        {
          targetCommand: "ledger get",
          bindings: [handoffFromPath("data.agent", ["--address"])]
        }
      ]);
    case "tasks terminate":
      return cloneHandoffHints([
        {
          targetCommand: "tasks get",
          bindings: [
            {
              sourcePath: "data.id",
              targetInputs: ["--task"]
            }
          ]
        },
        {
          targetCommand: "submissions list",
          bindings: [
            {
              sourcePath: "data.id",
              targetInputs: ["--task"]
            }
          ]
        },
        {
          targetCommand: "disputes list",
          bindings: [
            {
              sourcePath: "data.id",
              targetInputs: ["--task"]
            }
          ]
        },
        {
          targetCommand: "activities list",
          bindings: [handoffFromPath("data.id", ["--task"])],
          note: "rerun the activity list scoped to the terminated task"
        },
        {
          targetCommand: "tasks list",
          bindings: [handoffFromPath("data.publisher", ["--publisher"])],
          note: "rerun the task list scoped to the terminating publisher"
        },
        {
          targetCommand: "agents profile get",
          bindings: [handoffFromPath("data.publisher", ["--address"])]
        },
        {
          targetCommand: "agents stats",
          bindings: [handoffFromPath("data.publisher", ["--address"])]
        },
        {
          targetCommand: "ledger get",
          bindings: [handoffFromPath("data.publisher", ["--address"])]
        }
      ]);
    default:
      throw new CliValidationError(`spec handoff metadata is missing for command '${path}'`);
  }
};

const getWorkflowHints = (
  path: string,
  executionMode: CliExecutionMode
): CliSpecWorkflowHints => {
  if (executionMode === "local" || executionMode === "composite") {
    const localMetadata = LOCAL_COMMANDS[path];
    if (!localMetadata) {
      throw new CliValidationError(`spec workflow metadata is missing for local command '${path}'`);
    }
    return {
      phase: localMetadata.workflowHints.phase,
      actorRoles: [...localMetadata.workflowHints.actorRoles],
      prerequisiteCommands: [...localMetadata.workflowHints.prerequisiteCommands],
      nextCommands: [...localMetadata.workflowHints.nextCommands]
    };
  }

  switch (path as keyof typeof cliOperationBindings) {
    case "activities list":
      return {
        phase: "discover",
        actorRoles: ["any"],
        prerequisiteCommands: [],
        nextCommands: ["tasks get", "submissions list", "disputes get"]
      };
    case "agents list":
      return {
        phase: "discover",
        actorRoles: ["any"],
        prerequisiteCommands: [],
        nextCommands: ["agents profile get", "agents stats"]
      };
    case "agents profile get":
      return {
        phase: "profile",
        actorRoles: ["any"],
        prerequisiteCommands: [],
        nextCommands: ["agents profile update", "agents stats"]
      };
    case "agents profile update":
      return {
        phase: "profile",
        actorRoles: ["owner"],
        prerequisiteCommands: ["auth login", "agents profile get"],
        nextCommands: ["agents profile get", "agents stats"]
      };
    case "agents stats":
      return {
        phase: "profile",
        actorRoles: ["any"],
        prerequisiteCommands: ["agents profile get"],
        nextCommands: ["agents profile get"]
      };
    case "auth challenge":
      return {
        phase: "bootstrap",
        actorRoles: ["anonymous"],
        prerequisiteCommands: [],
        nextCommands: ["auth verify"]
      };
    case "auth verify":
      return {
        phase: "bootstrap",
        actorRoles: ["anonymous"],
        prerequisiteCommands: ["auth challenge"],
        nextCommands: ["config show", "config set", "tasks list", "tasks create"]
      };
    case "cycles active":
      return {
        phase: "settlement",
        actorRoles: ["any"],
        prerequisiteCommands: [],
        nextCommands: ["cycles rewards", "ledger get"]
      };
    case "cycles get":
      return {
        phase: "settlement",
        actorRoles: ["any"],
        prerequisiteCommands: ["cycles list"],
        nextCommands: ["cycles rewards", "ledger get"]
      };
    case "cycles list":
      return {
        phase: "settlement",
        actorRoles: ["any"],
        prerequisiteCommands: [],
        nextCommands: ["cycles get", "cycles rewards"]
      };
    case "cycles rewards":
      return {
        phase: "settlement",
        actorRoles: ["any"],
        prerequisiteCommands: ["cycles active"],
        nextCommands: ["ledger get", "tasks get"]
      };
    case "dashboard summary":
      return {
        phase: "discover",
        actorRoles: ["any"],
        prerequisiteCommands: [],
        nextCommands: ["dashboard trends", "cycles get", "tasks list"]
      };
    case "dashboard trends":
      return {
        phase: "discover",
        actorRoles: ["any"],
        prerequisiteCommands: ["dashboard summary"],
        nextCommands: ["dashboard summary", "activities list"]
      };
    case "disputes get":
      return {
        phase: "dispute",
        actorRoles: ["any"],
        prerequisiteCommands: ["disputes list"],
        nextCommands: ["disputes respond", "disputes vote"]
      };
    case "disputes list":
      return {
        phase: "dispute",
        actorRoles: ["any"],
        prerequisiteCommands: [],
        nextCommands: ["disputes get", "disputes open"]
      };
    case "disputes open":
      return {
        phase: "dispute",
        actorRoles: ["party"],
        prerequisiteCommands: ["tasks get", "submissions get"],
        nextCommands: ["disputes get", "disputes respond", "disputes vote"]
      };
    case "disputes respond":
      return {
        phase: "dispute",
        actorRoles: ["party"],
        prerequisiteCommands: ["disputes get"],
        nextCommands: ["disputes get", "disputes vote"]
      };
    case "disputes vote":
      return {
        phase: "supervision",
        actorRoles: ["supervisor"],
        prerequisiteCommands: ["disputes get"],
        nextCommands: ["disputes get", "cycles active", "ledger get"]
      };
    case "economy params":
      return {
        phase: "settlement",
        actorRoles: ["any"],
        prerequisiteCommands: [],
        nextCommands: ["tasks create", "cycles active"]
      };
    case "ledger get":
      return {
        phase: "settlement",
        actorRoles: ["any"],
        prerequisiteCommands: [],
        nextCommands: ["tasks create", "cycles rewards"]
      };
    case "submissions get":
      return {
        phase: "review",
        actorRoles: ["any"],
        prerequisiteCommands: ["submissions list"],
        nextCommands: ["submissions confirm", "submissions reject", "disputes open"]
      };
    case "submissions list":
      return {
        phase: "review",
        actorRoles: ["any"],
        prerequisiteCommands: ["tasks get"],
        nextCommands: ["submissions get", "submissions confirm", "submissions reject"]
      };
    case "submissions confirm":
      return {
        phase: "review",
        actorRoles: ["publisher"],
        prerequisiteCommands: ["tasks get", "submissions get"],
        nextCommands: ["submissions get", "tasks get", "cycles active", "ledger get"]
      };
    case "submissions reject":
      return {
        phase: "review",
        actorRoles: ["publisher"],
        prerequisiteCommands: ["tasks get", "submissions get"],
        nextCommands: ["submissions get", "tasks get", "disputes open"]
      };
    case "system health":
      return {
        phase: "system",
        actorRoles: ["any"],
        prerequisiteCommands: [],
        nextCommands: ["auth login", "tasks list"]
      };
    case "system metrics":
      return {
        phase: "system",
        actorRoles: ["operator"],
        prerequisiteCommands: ["auth login", "system health"],
        nextCommands: ["system settings get", "system settings history"]
      };
    case "system settings get":
      return {
        phase: "system",
        actorRoles: ["operator"],
        prerequisiteCommands: ["auth login", "system health"],
        nextCommands: ["system settings update", "system settings history"]
      };
    case "system settings history":
      return {
        phase: "system",
        actorRoles: ["operator"],
        prerequisiteCommands: ["auth login", "system settings get"],
        nextCommands: ["system settings get", "system settings update"]
      };
    case "system settings reset":
      return {
        phase: "system",
        actorRoles: ["operator"],
        prerequisiteCommands: ["auth login", "system settings get"],
        nextCommands: ["system settings get", "system settings history"]
      };
    case "system settings update":
      return {
        phase: "system",
        actorRoles: ["operator"],
        prerequisiteCommands: ["auth login", "system settings get"],
        nextCommands: ["system settings get", "system settings history"]
      };
    case "tasks create":
      return {
        phase: "publish",
        actorRoles: ["publisher"],
        prerequisiteCommands: ["system health", "ledger get"],
        nextCommands: ["tasks get", "tasks intentions"]
      };
    case "tasks get":
      return {
        phase: "discover",
        actorRoles: ["any"],
        prerequisiteCommands: ["tasks list"],
        nextCommands: ["tasks intend", "tasks submit", "tasks terminate", "submissions list"]
      };
    case "tasks intend":
      return {
        phase: "join",
        actorRoles: ["worker"],
        prerequisiteCommands: ["tasks get"],
        nextCommands: ["tasks intentions", "tasks submit"]
      };
    case "tasks intentions":
      return {
        phase: "join",
        actorRoles: ["any"],
        prerequisiteCommands: ["tasks get"],
        nextCommands: ["tasks submit", "submissions list"]
      };
    case "tasks list":
      return {
        phase: "discover",
        actorRoles: ["any"],
        prerequisiteCommands: [],
        nextCommands: ["tasks get", "tasks create", "tasks intend"]
      };
    case "tasks submit":
      return {
        phase: "deliver",
        actorRoles: ["worker"],
        prerequisiteCommands: ["tasks get", "tasks intentions"],
        nextCommands: ["submissions list", "submissions get"]
      };
    case "tasks terminate":
      return {
        phase: "terminate",
        actorRoles: ["publisher"],
        prerequisiteCommands: ["tasks get"],
        nextCommands: ["tasks get", "ledger get", "cycles active"]
      };
    default:
      throw new CliValidationError(`spec workflow metadata is missing for command '${path}'`);
  }
};

const getAutomationHints = (
  path: string,
  executionMode: CliExecutionMode,
  operation?: CliSpecOperation
): CliSpecAutomationHints => {
  if (executionMode === "local" || executionMode === "composite") {
    const localMetadata = LOCAL_COMMANDS[path];
    if (!localMetadata) {
      throw new CliValidationError(`spec automation metadata is missing for local command '${path}'`);
    }
    return {
      effect: localMetadata.automationHints.effect,
      retryMode: localMetadata.automationHints.retryMode,
      preflightCommands: [...localMetadata.automationHints.preflightCommands],
      verificationCommands: [...localMetadata.automationHints.verificationCommands]
    };
  }

  if (!operation) {
    throw new CliValidationError(`spec automation metadata is missing operation context for command '${path}'`);
  }

  const bindingPath = path as keyof typeof cliOperationBindings;
  const explicitHints = API_AUTOMATION_HINTS[bindingPath];
  if (explicitHints) {
    return {
      effect: explicitHints.effect,
      retryMode: explicitHints.retryMode,
      preflightCommands: [...explicitHints.preflightCommands],
      verificationCommands: [...explicitHints.verificationCommands]
    };
  }

  if (operation.method === "GET") {
    return {
      effect: READ_AUTOMATION_HINTS.effect,
      retryMode: READ_AUTOMATION_HINTS.retryMode,
      preflightCommands: [...READ_AUTOMATION_HINTS.preflightCommands],
      verificationCommands: [...READ_AUTOMATION_HINTS.verificationCommands]
    };
  }

  return {
    effect: "remoteWrite",
    retryMode: "retryableAfterVerification",
    preflightCommands: [],
    verificationCommands: []
  };
};

const getFailureHints = (
  path: string,
  executionMode: CliExecutionMode,
  auth: ApiAuthMode,
  automationHints: CliSpecAutomationHints
): CliSpecFailureHint[] => {
  if (executionMode === "local" || executionMode === "composite") {
    return getLocalFailureHints(path as keyof typeof LOCAL_COMMANDS);
  }

  return getApiFailureHints(path as keyof typeof cliOperationBindings, auth, automationHints);
};

const collectLeafCommands = (root: Command): Array<{ path: string; command: Command }> => {
  const leaves: Array<{ path: string; command: Command }> = [];

  const visit = (command: Command, segments: string[]): void => {
    if (command.commands.length === 0) {
      leaves.push({ path: segments.join(" "), command });
      return;
    }

    for (const child of command.commands) {
      visit(child, [...segments, child.name()]);
    }
  };

  for (const child of root.commands) {
    visit(child, [child.name()]);
  }

  return leaves;
};

const toCommandSpec = (path: string, command: Command): CliSpecCommand => {
  const localMetadata = LOCAL_COMMANDS[path];

  if (localMetadata) {
    const automationHints = getAutomationHints(path, localMetadata.executionMode);
    const workflowHints = getWorkflowHints(path, localMetadata.executionMode);
    const entityHints = getEntityHints(path, localMetadata.executionMode);
    const handoffHints = getHandoffHints(path, localMetadata.executionMode);
    return {
      path,
      description: command.description(),
      auth: localMetadata.auth,
      authRequirements: toAuthRequirements(localMetadata.auth),
      executionSteps: [...localMetadata.executionSteps],
      sideEffects: [...localMetadata.sideEffects],
      successFields: [...localMetadata.successFields],
      requestBindings: getRequestBindings(path),
      failureHints: getFailureHints(path, localMetadata.executionMode, localMetadata.auth, automationHints),
      workflowHints,
      entityHints,
      handoffHints,
      automationHints,
      executionMode: localMetadata.executionMode,
      arguments: getRegisteredArguments(command),
      options: command.options.filter((option) => !isHelpOption(option)).map(toOptionSpec),
      inputContract: [...getInputContractLines(command)],
      ...(localMetadata.operations
        ? { operations: localMetadata.operations.map(toOperationSpec) }
        : {})
    };
  }

  throw new CliValidationError(`spec metadata is missing for local command '${path}'`);
};

const resolveCommandSpec = (path: string, command: Command): CliSpecCommand => {
  if (path in LOCAL_COMMANDS) {
    return toCommandSpec(path, command);
  }

  const bindingPath = path as keyof typeof cliOperationBindings;
  const operationId = cliOperationBindings[bindingPath];
  if (!operationId) {
    throw new CliValidationError(`spec metadata is missing for command '${path}'`);
  }

  const apiOperation = getApiOperation(operationId);
  const operation = toOperationSpec(operationId);
  const automationHints = getAutomationHints(path, "api", operation);
  const workflowHints = getWorkflowHints(path, "api");
  const entityHints = getEntityHints(path, "api");
  const handoffHints = getHandoffHints(path, "api");
  return {
    path,
    description: command.description(),
    auth: operation.auth,
    authRequirements: toAuthRequirements(operation.auth),
    executionSteps: [],
    sideEffects: [],
    successFields: getApiSuccessFields(apiOperation),
    requestBindings: getRequestBindings(path, apiOperation),
    failureHints: getFailureHints(path, "api", operation.auth, automationHints),
    workflowHints,
    entityHints,
    handoffHints,
    automationHints,
    executionMode: "api",
    arguments: getRegisteredArguments(command),
    options: command.options.filter((option) => !isHelpOption(option)).map(toOptionSpec),
    inputContract: [...getInputContractLines(command)],
    operation
  };
};

const toDiscoverySpec = async (command: Command, commandQuery?: string): Promise<CliDiscoverySpec> => {
  const root = resolveRootCommand(command);
  const normalizedQuery = commandQuery?.trim() ? commandQuery.trim().replace(/\s+/g, " ") : undefined;
  const commands = collectLeafCommands(root)
    .map(({ path, command: leaf }) => resolveCommandSpec(path, leaf))
    .sort((left, right) => left.path.localeCompare(right.path));
  const filteredCommands = normalizedQuery
    ? commands.filter(
        (item) => item.path === normalizedQuery || item.path.startsWith(`${normalizedQuery} `)
      )
    : commands;

  if (normalizedQuery && filteredCommands.length === 0) {
    throw new CliValidationError(
      `unknown command query '${normalizedQuery}': use an exact leaf path like 'tasks create' or a group prefix like 'tasks'`
    );
  }

  return {
    binary: root.name(),
    version: root.version() ?? "0.0.0",
    commandQuery: normalizedQuery ?? null,
    commandCount: filteredCommands.length,
    discovery: {
      preferredCommand: "agentrade spec",
      helpPlainTextExceptions: ["--help", "--version"],
      nestedHelpRewrite: true,
      positionalHelpArgumentsUnaffected: true,
      opaquePaginationCursor: true,
      stdinFileAlias: STDIN_FILE_ALIAS,
      stdinSingleConsumerPerInvocation: true
    },
    runtimeConfig: {
      precedence: ["command flags", "persisted global config file", "built-in defaults"],
      configPathCandidates: [
        "$AGENTRADE_CLI_CONFIG_PATH",
        "$XDG_CONFIG_HOME/agentrade/config.json",
        "~/.agentrade/config.json"
      ],
      builtInDefaults: {
        baseUrl: CLI_DEFAULT_BASE_URL,
        timeoutMs: CLI_DEFAULT_TIMEOUT_MS,
        retries: CLI_DEFAULT_RETRIES
      }
    },
    outputContract: {
      successStdoutEnvelope: ["ok", "command", "data", "warnings?"],
      failureStderrEnvelope: [
        "type",
        "message",
        "httpStatus",
        "apiError",
        "issues",
        "retryable",
        "command"
      ],
      exitCodes: {
        success: 0,
        validation: 2,
        config: 3,
        api: 4,
        network: 5,
        unknown: 10
      }
    },
    globalOptions: root.options.filter((option) => !isDiscoveryOnlyOption(option)).map(toOptionSpec),
    dualChannelInputs: [
      { inline: "--token", file: "--token-file", stdinAlias: STDIN_FILE_ALIAS },
      { inline: "--admin-key", file: "--admin-key-file", stdinAlias: STDIN_FILE_ALIAS },
      { inline: "--private-key", file: "--private-key-file", stdinAlias: STDIN_FILE_ALIAS },
      { inline: "--message", file: "--message-file", stdinAlias: STDIN_FILE_ALIAS },
      { inline: "--desc", file: "--desc-file", stdinAlias: STDIN_FILE_ALIAS },
      { inline: "--criteria", file: "--criteria-file", stdinAlias: STDIN_FILE_ALIAS },
      { inline: "--payload", file: "--payload-file", stdinAlias: STDIN_FILE_ALIAS },
      { inline: "--patch-json", file: "--patch-file", stdinAlias: STDIN_FILE_ALIAS },
      { inline: "--reason", file: "--reason-file", stdinAlias: STDIN_FILE_ALIAS },
      { inline: "--name", file: "--name-file", stdinAlias: STDIN_FILE_ALIAS },
      { inline: "--bio", file: "--bio-file", stdinAlias: STDIN_FILE_ALIAS },
      { inline: "<value>", file: "--value-file", stdinAlias: STDIN_FILE_ALIAS }
    ],
    commands: filteredCommands
  };
};

export const registerSpecCommands = (program: Command): void => {
  program
    .command("spec")
    .description("Emit machine-readable CLI command spec for agent discovery")
    .option("--command <path>", "filter to one leaf path or command-group prefix")
    .action(async function (this: Command, options: { command?: string }) {
      try {
        const spec = await toDiscoverySpec(this, options.command);
        printSuccessJson(spec, resolvePretty(this), "spec");
      } catch (error) {
        attachCommandPath(error, "spec");
        throw error;
      }
    });
};
