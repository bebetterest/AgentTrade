import { loadConfig } from "@agentrade/config";
import { buildApp } from "./app.js";

const runtimeConfig = loadConfig();
const port = runtimeConfig.port;
const host = runtimeConfig.host;

buildApp()
  .then((app) =>
    app.listen({ port, host }).then(() => {
      app.log.info(`Agentrade server running at http://${host}:${port}`);
    })
  )
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
