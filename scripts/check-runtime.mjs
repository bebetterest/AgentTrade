const minimumNodeMajor = 22;
const maximumNodeMajorExclusive = 26;
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
if (nodeMajor < minimumNodeMajor || nodeMajor >= maximumNodeMajorExclusive) {
  fail(
    [
      `Unsupported Node.js runtime: found ${process.versions.node}, expected >=${minimumNodeMajor} <${maximumNodeMajorExclusive}.`,
      "Use `corepack enable` and a supported Node runtime before running workspace commands.",
      "Node 22 remains the recommended local baseline (see .nvmrc)."
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
