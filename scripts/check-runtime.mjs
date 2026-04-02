const requiredNodeMajor = 22;
const requiredPnpmVersion = "9.12.1";

const parseUserAgent = () => {
  const userAgent = process.env.npm_config_user_agent ?? "";
  const match = userAgent.match(/pnpm\/([0-9.]+)/);
  return {
    userAgent,
    pnpmVersion: match?.[1] ?? null
  };
};

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const nodeMajor = Number(process.versions.node.split(".")[0] ?? "0");
if (nodeMajor !== requiredNodeMajor) {
  fail(
    [
      `Unsupported Node.js runtime: found ${process.versions.node}, expected 22.x.`,
      "Use `corepack enable` and a Node 22 runtime before running workspace commands."
    ].join("\n")
  );
}

const { userAgent, pnpmVersion } = parseUserAgent();
if (!userAgent.includes("pnpm/")) {
  fail(
    [
      "This repository must be installed and executed with pnpm.",
      "Run `corepack enable` then `corepack prepare pnpm@9.12.1 --activate`."
    ].join("\n")
  );
}

if (pnpmVersion !== requiredPnpmVersion) {
  fail(
    [
      `Unsupported pnpm runtime: found ${pnpmVersion ?? "unknown"}, expected ${requiredPnpmVersion}.`,
      "Run `corepack prepare pnpm@9.12.1 --activate` before installing dependencies."
    ].join("\n")
  );
}
