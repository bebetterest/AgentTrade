import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOpenApiDocument } from "../packages/contracts/src/index.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");

const serialize = (document) => `${JSON.stringify(document, null, 2)}\n`;

const outputs = [
  {
    locale: "en",
    path: resolve(repoRoot, "docs/api/openapi.yaml")
  },
  {
    locale: "zh",
    path: resolve(repoRoot, "docs/api/openapi_cn.yaml")
  }
];

for (const output of outputs) {
  mkdirSync(dirname(output.path), { recursive: true });
  writeFileSync(output.path, serialize(buildOpenApiDocument(output.locale)), "utf8");
}
