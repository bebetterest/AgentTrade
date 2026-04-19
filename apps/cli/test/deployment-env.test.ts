import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../../..");

const copyIntoWorkspace = (workspaceDir: string, relativePath: string): void => {
  const sourcePath = resolve(repoRoot, relativePath);
  const targetPath = resolve(workspaceDir, relativePath);
  mkdirSync(dirname(targetPath), { recursive: true });
  cpSync(sourcePath, targetPath, { recursive: true });
};

const createWorkspace = (): { dir: string; cleanup: () => void } => {
  const dir = mkdtempSync(join(tmpdir(), "agentrade-deploy-env-"));
  for (const relativePath of [
    "scripts/compose-stack.sh",
    "deploy/smoke.sh",
    "deploy/release.sh",
    "docker-compose.yml",
    "docker-compose.local.yml",
    "docker-compose.cloud.yml",
    ".env.example",
    ".env.example.local",
    ".env.example.cloud"
  ]) {
    copyIntoWorkspace(dir, relativePath);
  }

  return {
    dir,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
    }
  };
};

const installStubCommand = (workspaceDir: string, name: string, scriptBody: string): string => {
  const binDir = join(workspaceDir, ".test-bin");
  mkdirSync(binDir, { recursive: true });
  const commandPath = join(binDir, name);
  writeFileSync(commandPath, scriptBody, { mode: 0o755 });
  return binDir;
};

const runShell = async (
  workspaceDir: string,
  scriptRelativePath: string,
  args: string[],
  env: NodeJS.ProcessEnv = {}
): Promise<CommandResult> => {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("sh", [scriptRelativePath, ...args], {
      cwd: workspaceDir,
      env: {
        ...process.env,
        ...env
      }
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      resolvePromise({ code, stdout, stderr });
    });
  });
};

const copyRealEnvFiles = (workspaceDir: string, mode: "local" | "cloud"): void => {
  cpSync(resolve(workspaceDir, ".env.example"), resolve(workspaceDir, ".env"));
  if (mode === "local") {
    cpSync(resolve(workspaceDir, ".env.example.local"), resolve(workspaceDir, ".env.local"));
    return;
  }
  cpSync(resolve(workspaceDir, ".env.example.cloud"), resolve(workspaceDir, ".env.cloud"));
};

test("compose-stack fails fast when .env is missing", async () => {
  const { dir, cleanup } = createWorkspace();

  try {
    cpSync(resolve(dir, ".env.example.local"), resolve(dir, ".env.local"));

    const result = await runShell(dir, "scripts/compose-stack.sh", ["local", "config"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /\[compose-stack\] missing required shared env file: \.env/);
  } finally {
    cleanup();
  }
});

test("compose-stack fails fast when mode env file is missing", async () => {
  const { dir, cleanup } = createWorkspace();

  try {
    cpSync(resolve(dir, ".env.example"), resolve(dir, ".env"));

    const result = await runShell(dir, "scripts/compose-stack.sh", ["cloud", "config"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /\[compose-stack\] missing required mode env file: \.env\.cloud/);
  } finally {
    cleanup();
  }
});

test("compose-stack uses only real env files after templates are copied", async () => {
  const { dir, cleanup } = createWorkspace();

  try {
    copyRealEnvFiles(dir, "local");
    const dockerLog = join(dir, "docker.log");
    const binDir = installStubCommand(
      dir,
      "docker",
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "${dockerLog}"\nexit 0\n`
    );

    const result = await runShell(dir, "scripts/compose-stack.sh", ["local", "config"], {
      PATH: `${binDir}:${process.env.PATH ?? ""}`
    });

    assert.equal(result.code, 0, result.stderr);
    const dockerInvocation = readFileSync(dockerLog, "utf8");
    assert.match(
      dockerInvocation,
      /compose --env-file \.env --env-file \.env\.local -f docker-compose\.yml -f docker-compose\.local\.yml config/
    );
    assert.doesNotMatch(dockerInvocation, /\.env\.example/);
  } finally {
    cleanup();
  }
});

test("smoke fails fast when cloud mode env file is missing", async () => {
  const { dir, cleanup } = createWorkspace();

  try {
    cpSync(resolve(dir, ".env.example"), resolve(dir, ".env"));

    const result = await runShell(dir, "deploy/smoke.sh", ["cloud", "--skip-up", "--retries", "1"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /\[smoke\] missing required mode env file: \.env\.cloud/);
  } finally {
    cleanup();
  }
});

test("smoke local succeeds when real env files are created from templates", async () => {
  const { dir, cleanup } = createWorkspace();

  try {
    copyRealEnvFiles(dir, "local");
    const curlLog = join(dir, "curl.log");
    const binDir = installStubCommand(
      dir,
      "curl",
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "${curlLog}"\nexit 0\n`
    );

    const result = await runShell(
      dir,
      "deploy/smoke.sh",
      ["local", "--skip-up", "--retries", "1", "--interval", "1"],
      {
        PATH: `${binDir}:${process.env.PATH ?? ""}`
      }
    );

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Local smoke checks passed\./);

    const curlCalls = readFileSync(curlLog, "utf8");
    assert.match(curlCalls, /http:\/\/127\.0\.0\.1:3001\//);
    assert.match(curlCalls, /http:\/\/127\.0\.0\.1:3000\/v2\/system\/health/);
    assert.match(curlCalls, /http:\/\/127\.0\.0\.1:3000\/v2\/dashboard\/summary\?tz=UTC/);
  } finally {
    cleanup();
  }
});

test("release fails fast when .env is missing", async () => {
  const { dir, cleanup } = createWorkspace();

  try {
    cpSync(resolve(dir, ".env.example.local"), resolve(dir, ".env.local"));

    const result = await runShell(
      dir,
      "deploy/release.sh",
      ["local", "--skip-smoke", "--skip-verify"]
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /\[release\] missing required shared env file: \.env/);
  } finally {
    cleanup();
  }
});

test("release local succeeds when real env files are created from templates", async () => {
  const { dir, cleanup } = createWorkspace();

  try {
    copyRealEnvFiles(dir, "local");
    const dockerLog = join(dir, "docker-release.log");
    const binDir = installStubCommand(
      dir,
      "docker",
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "${dockerLog}"\nexit 0\n`
    );

    const result = await runShell(
      dir,
      "deploy/release.sh",
      ["local", "--skip-smoke", "--skip-verify"],
      {
        PATH: `${binDir}:${process.env.PATH ?? ""}`
      }
    );

    assert.equal(result.code, 0, result.stderr);
    const dockerInvocations = readFileSync(dockerLog, "utf8");
    assert.match(
      dockerInvocations,
      /compose --env-file \.env --env-file \.env\.local -f docker-compose\.yml -f docker-compose\.local\.yml build --pull --no-cache web/
    );
    assert.match(
      dockerInvocations,
      /compose --env-file \.env --env-file \.env\.local -f docker-compose\.yml -f docker-compose\.local\.yml up -d --build --force-recreate --remove-orphans/
    );
    assert.doesNotMatch(dockerInvocations, /\.env\.example/);
  } finally {
    cleanup();
  }
});
