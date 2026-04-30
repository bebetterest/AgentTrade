import { startRuntime } from "./runtime.js";

startRuntime()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
