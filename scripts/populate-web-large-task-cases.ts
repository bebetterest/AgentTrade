import { AgentradeApiClient, ApiClientError } from "@agentrade/sdk";
import type { Address } from "@agentrade/types";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

interface Options {
  baseUrl: string;
  cases: number;
  participants: number;
  completions: number;
  slots: number;
  reward: number;
  deadlineHours: number;
  delayMs: number;
  timezone: string;
}

interface RegisteredAgent {
  address: Address;
  privateKey: `0x${string}`;
  client: AgentradeApiClient;
}

interface CaseSummary {
  index: number;
  taskId: string;
  taskTitle: string;
  intentCount: number;
  completedCount: number;
  status: string;
}

const DEFAULTS: Options = {
  baseUrl: process.env.AGENTRADE_API_BASE_URL ?? "http://127.0.0.1:3000",
  cases: 2,
  participants: 13,
  completions: 11,
  slots: 20,
  reward: 6,
  deadlineHours: 48,
  delayMs: 900,
  timezone: "UTC"
};

const toPositiveInt = (value: string, flag: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
};

const parseArgs = (): Options => {
  const args = process.argv.slice(2);
  const parsed: Options = { ...DEFAULTS };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }
    const next = args[index + 1];
    if (!arg.startsWith("--")) {
      throw new Error(`unknown argument: ${arg}`);
    }
    if (!next) {
      throw new Error(`missing value for ${arg}`);
    }

    if (arg === "--base-url") {
      parsed.baseUrl = next;
    } else if (arg === "--cases") {
      parsed.cases = toPositiveInt(next, "--cases");
    } else if (arg === "--participants") {
      parsed.participants = toPositiveInt(next, "--participants");
    } else if (arg === "--completions") {
      parsed.completions = toPositiveInt(next, "--completions");
    } else if (arg === "--slots") {
      parsed.slots = toPositiveInt(next, "--slots");
    } else if (arg === "--reward") {
      parsed.reward = toPositiveInt(next, "--reward");
    } else if (arg === "--deadline-hours") {
      parsed.deadlineHours = toPositiveInt(next, "--deadline-hours");
    } else if (arg === "--delay-ms") {
      parsed.delayMs = toPositiveInt(next, "--delay-ms");
    } else if (arg === "--timezone") {
      parsed.timezone = next;
    } else {
      throw new Error(`unknown flag: ${arg}`);
    }
    index += 1;
  }

  if (parsed.participants < 11) {
    throw new Error("--participants must be >= 11 (for 10+ UI case)");
  }
  if (parsed.completions < 11) {
    throw new Error("--completions must be >= 11 (for 10+ UI case)");
  }
  if (parsed.completions > parsed.participants) {
    throw new Error("--completions must be <= --participants");
  }
  if (parsed.completions > parsed.slots) {
    throw new Error("--slots must be >= --completions");
  }

  return parsed;
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const isRetryable = (error: unknown): boolean => {
  if (!(error instanceof ApiClientError)) {
    return false;
  }
  return error.httpStatus === 429 || (typeof error.httpStatus === "number" && error.httpStatus >= 500);
};

const isRateLimited = (error: unknown): boolean =>
  error instanceof ApiClientError && error.httpStatus === 429;

const formatError = (error: unknown): string => {
  if (error instanceof ApiClientError) {
    return `${error.message} (status=${error.httpStatus}, code=${error.apiError ?? "unknown"})`;
  }
  return error instanceof Error ? error.message : String(error);
};

const createCallPacer = (minGapMs: number) => {
  let lastCallAt = 0;
  return async <T>(label: string, run: () => Promise<T>): Promise<T> => {
    const now = Date.now();
    const waitMs = minGapMs - (now - lastCallAt);
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    lastCallAt = Date.now();

    let attempt = 0;
    while (attempt < 6) {
      attempt += 1;
      try {
        return await run();
      } catch (error) {
        if (!isRetryable(error) || attempt >= 6) {
          throw new Error(`${label} failed: ${formatError(error)}`);
        }
        const backoffMs = isRateLimited(error) ? 2000 * attempt : 600 * attempt;
        await sleep(backoffMs);
      }
    }
    throw new Error(`${label} exhausted retries`);
  };
};

const registerAgent = async (
  publicClient: AgentradeApiClient,
  baseUrl: string,
  callApi: <T>(label: string, run: () => Promise<T>) => Promise<T>,
  index: number
): Promise<RegisteredAgent> => {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const address = account.address as Address;

  const challenge = await callApi(`auth challenge #${index}`, () =>
    publicClient.authChallenge({ address })
  );
  const signature = await account.signMessage({ message: challenge.message });
  const auth = await callApi(`auth verify #${index}`, () =>
    publicClient.authVerify({
      address,
      nonce: challenge.nonce,
      message: challenge.message,
      signature
    })
  );

  return {
    address,
    privateKey,
    client: new AgentradeApiClient({
      baseUrl,
      token: auth.token,
      timeoutMs: 20_000,
      retries: 2
    })
  };
};

const createDeadlineIso = (deadlineHours: number, caseIndex: number): string => {
  const date = new Date(Date.now() + deadlineHours * 3_600_000 + caseIndex * 60_000);
  return date.toISOString();
};

const main = async (): Promise<void> => {
  const options = parseArgs();
  const publicClient = new AgentradeApiClient({
    baseUrl: options.baseUrl,
    timeoutMs: 20_000,
    retries: 2
  });
  const callApi = createCallPacer(options.delayMs);

  console.log(`[seed] baseUrl=${options.baseUrl}`);
  console.log(
    `[seed] cases=${options.cases}, participants=${options.participants}, completions=${options.completions}, slots=${options.slots}, reward=${options.reward}, delayMs=${options.delayMs}`
  );

  const publisher = await registerAgent(publicClient, options.baseUrl, callApi, 0);
  await callApi("publisher profile bootstrap", () =>
    publisher.client.updateAgentProfile(publisher.address, {
      name: "ui-case-publisher",
      bio: "Creates high-density UI list cases for web rendering checks."
    })
  );

  const workers: RegisteredAgent[] = [];
  for (let index = 0; index < options.participants; index += 1) {
    workers.push(await registerAgent(publicClient, options.baseUrl, callApi, index + 1));
  }

  const summaries: CaseSummary[] = [];
  for (let caseIndex = 0; caseIndex < options.cases; caseIndex += 1) {
    const title = `UI Large Case ${caseIndex + 1}: ${options.participants} participants / ${options.completions} completed`;
    const task = await callApi(`create task #${caseIndex + 1}`, () =>
      publisher.client.createTask({
        title,
        descriptionMd: `# UI Large Task Case ${caseIndex + 1}\n\nThis task is generated for verifying web rendering with long participant/completed lists.`,
        acceptanceCriteria: `- Must keep ${options.participants}+ participant entries readable.\n- Must keep ${options.completions}+ completed entries readable.\n- Validate spacing/wrapping/scroll behavior.`,
        deadlineUtc: createDeadlineIso(options.deadlineHours, caseIndex),
        displayTimezone: options.timezone,
        slotsTotal: options.slots,
        rewardPerSlot: options.reward,
        allowRepeatCompletionsBySameAgent: false
      })
    );

    for (let workerIndex = 0; workerIndex < options.participants; workerIndex += 1) {
      const worker = workers[workerIndex];
      await callApi(`intend task ${task.id} worker ${workerIndex + 1}`, () =>
        worker.client.addTaskIntention(task.id)
      );
    }

    for (let workerIndex = 0; workerIndex < options.completions; workerIndex += 1) {
      const worker = workers[workerIndex];
      const submission = await callApi(`submit task ${task.id} worker ${workerIndex + 1}`, () =>
        worker.client.submitTask(task.id, {
          payloadMd: `submission from worker ${workerIndex + 1} for case ${caseIndex + 1}`
        })
      );
      await callApi(`confirm submission ${submission.id}`, () =>
        publisher.client.confirmSubmission(submission.id)
      );
    }

    const snapshot = await callApi(`read task ${task.id}`, () => publicClient.getTask(task.id));
    summaries.push({
      index: caseIndex + 1,
      taskId: snapshot.id,
      taskTitle: snapshot.title,
      intentCount: snapshot.intentCount,
      completedCount: snapshot.completedAgents.length,
      status: snapshot.status
    });
  }

  const output = {
    publisher: {
      address: publisher.address
    },
    createdAt: new Date().toISOString(),
    cases: summaries
  };

  console.log(JSON.stringify(output, null, 2));
};

main().catch((error) => {
  console.error("[seed] failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
