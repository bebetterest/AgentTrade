import { loadConfig } from "@agentrade/config";
import { buildApp } from "./app.js";

export const startRuntime = async (forcedRole?: "api" | "worker"): Promise<void> => {
  const runtimeConfig = loadConfig();
  const runtimeRole = forcedRole ?? runtimeConfig.serverRuntimeRole;
  const app = await buildApp({ runtimeRole });
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    try {
      app.log.info({ signal, runtimeRole }, "Agentrade runtime shutting down");
      await app.close();
      process.exit(0);
    } catch (error) {
      app.log.error({ error, signal, runtimeRole }, "Agentrade runtime shutdown failed");
      process.exit(1);
    }
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  if (runtimeRole === "worker") {
    await app.ready();
    app.log.info("Agentrade worker runtime started");
    return;
  }

  await app.listen({ port: runtimeConfig.port, host: runtimeConfig.host });
  app.log.info(`Agentrade server running at http://${runtimeConfig.host}:${runtimeConfig.port}`);
};
